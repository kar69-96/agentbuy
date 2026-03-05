/**
 * Browserbase adapter that speaks Firecrawl's Playwright microservice protocol.
 *
 * Firecrawl's engine fallback checks PLAYWRIGHT_MICROSERVICE_URL. When set,
 * the `playwright` engine (quality: 20) sends POST /scrape requests here.
 * This adapter routes those through Browserbase's cloud infrastructure which
 * has CAPTCHA solving, stealth proxies, and anti-bot capabilities built in.
 *
 * Start: npx tsx packages/crawling/src/browserbase-adapter.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chromium } from "playwright-core";

// ---- Config ----

const PORT = parseInt(process.env.ADAPTER_PORT ?? "3003", 10);
const MAX_CONCURRENT = parseInt(process.env.ADAPTER_CONCURRENCY ?? "24", 10);
const BROWSERBASE_API_URL = "https://api.browserbase.com/v1/sessions";
const SESSION_TIMEOUT_S = 300;

// ---- Product selectors for content readiness ----

const PRODUCT_SELECTORS = [
  '[itemprop="name"]', '[itemprop="price"]',
  '[data-product-title]', '[data-product]',
  '.product-title', '.product-name', '.product__title', '.pdp-title',
  'h1.title',
  '[class*="productTitle"]', '[class*="product-title"]', '[class*="ProductName"]',
  '[data-testid="product-title"]',
  '.price', '[data-price]', '[class*="productPrice"]',
].join(", ");

// ---- Semaphore for concurrency control ----

let activeCount = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release(): void {
  if (waiting.length > 0) {
    const next = waiting.shift()!;
    next();
  } else {
    activeCount--;
  }
}

// ---- Browserbase session helpers ----

function getBrowserbaseConfig(): { apiKey: string; projectId: string } {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY is required");
  if (!projectId) throw new Error("BROWSERBASE_PROJECT_ID is required");
  return { apiKey, projectId };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createSession(
  retries = 5,
): Promise<{ id: string; connectUrl: string }> {
  const { apiKey, projectId } = getBrowserbaseConfig();

  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(BROWSERBASE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bb-api-key": apiKey },
      body: JSON.stringify({
        projectId,
        proxies: true,
        browserSettings: {
          solveCaptchas: true,
          stealth: true,
        },
        timeout: SESSION_TIMEOUT_S,
      }),
    });
    if (response.ok) {
      return (await response.json()) as { id: string; connectUrl: string };
    }
    const body = await response.text();
    if (response.status === 429 && attempt < retries) {
      console.log(`  429 Too Many Requests — retry ${attempt + 1}/${retries}`);
      await sleep(1000 * attempt);
      continue;
    }
    throw new Error(`Browserbase session failed (${response.status}): ${body}`);
  }
  throw new Error("createSession: exhausted retries");
}

async function destroySession(sessionId: string): Promise<void> {
  try {
    const { apiKey, projectId } = getBrowserbaseConfig();
    await fetch(`${BROWSERBASE_API_URL}/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bb-api-key": apiKey },
      body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
    });
  } catch {
    // Never throw from cleanup
  }
}

// ---- Challenge detection + wait ----

/**
 * Detect if the current page is a bot challenge (Cloudflare, Akamai, etc.)
 * and wait for Browserbase's solveCaptchas to resolve it.
 *
 * When Browserbase solves a Cloudflare challenge, it triggers a navigation
 * to the real page. We wait for that navigation instead of polling DOM elements.
 */
async function waitForChallengeResolution(
  page: import("playwright-core").Page,
): Promise<void> {
  const isChallenge = await page
    .evaluate(() => {
      const title = document.title.toLowerCase();
      const body = document.body?.innerText?.toLowerCase() ?? "";
      // Cloudflare
      if (title.includes("just a moment") || title.includes("attention required")) return true;
      if (document.querySelector("#challenge-running, #challenge-stage, #cf-challenge-running")) return true;
      // Akamai / PerimeterX
      if (title.includes("access denied") || body.includes("automated access")) return true;
      // Generic
      if (body.includes("please verify you are a human") || body.includes("checking your browser")) return true;
      return false;
    })
    .catch(() => false);

  if (!isChallenge) return;

  const startUrl = page.url();
  console.log(`  [adapter] Challenge detected on ${startUrl} — waiting for Browserbase to solve`);

  // Browserbase solveCaptchas triggers a navigation after solving.
  // Wait for either: URL change (navigation) or challenge elements gone.
  await Promise.race([
    // Option A: Page navigates to the real URL after challenge
    page.waitForURL((url) => url.toString() !== startUrl, { timeout: 20_000 }).catch(() => {}),
    // Option B: Challenge elements disappear (same-page resolution)
    page.waitForFunction(
      () => {
        const title = document.title.toLowerCase();
        return !title.includes("just a moment")
          && !title.includes("attention required")
          && !document.querySelector("#challenge-running, #challenge-stage");
      },
      { timeout: 20_000 },
    ).catch(() => {}),
  ]);

  // After challenge resolves, wait for the real page to load
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
}

// ---- Wait for content readiness ----

/**
 * Race: networkidle vs product selector — whichever comes first.
 * This replaces the old sequential 3-phase wait.
 */
async function waitForContent(page: import("playwright-core").Page): Promise<void> {
  await Promise.race([
    page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {}),
    page.waitForSelector(PRODUCT_SELECTORS, { timeout: 5_000 }).catch(() => {}),
  ]);
}

// ---- Scrape handler ----

class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterError";
  }
}

interface ScrapeRequest {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  headers?: Record<string, string>;
  check_selector?: string;
}

interface ScrapeResponse {
  content: string;
  pageStatusCode: number;
  pageError?: string;
  contentType?: string;
}

async function handleScrape(req: ScrapeRequest): Promise<ScrapeResponse> {
  let sessionId: string | undefined;
  try {
    const session = await createSession();
    sessionId = session.id;

    const browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    const timeoutMs = req.timeout ?? 30_000;
    const response = await page.goto(req.url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    // If we hit a challenge page, wait for Browserbase to solve it
    await waitForChallengeResolution(page);

    // Wait for real content to appear (race: networkidle vs product selector)
    await waitForContent(page);

    // Wait for optional selector
    if (req.check_selector) {
      await page
        .waitForSelector(req.check_selector, { timeout: 5000 })
        .catch(() => {});
    }

    const content = await page.content();
    const statusCode = response?.status() ?? 200;

    await browser.close();

    return {
      content,
      pageStatusCode: statusCode,
      contentType: "text/html",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AdapterError(message);
  } finally {
    if (sessionId) {
      await destroySession(sessionId);
    }
  }
}

// ---- HTTP helpers ----

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// ---- Server ----

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // GET /health
  if (req.method === "GET" && url.pathname === "/health") {
    jsonResponse(res, 200, { status: "healthy" });
    return;
  }

  // POST /scrape
  if (req.method === "POST" && url.pathname === "/scrape") {
    try {
      const body = await readBody(req);
      const scrapeReq = JSON.parse(body) as ScrapeRequest;

      if (!scrapeReq.url) {
        jsonResponse(res, 400, { error: "url is required" });
        return;
      }

      await acquire();
      try {
        const result = await handleScrape(scrapeReq);
        jsonResponse(res, 200, result);
      } catch (err) {
        if (err instanceof AdapterError) {
          jsonResponse(res, 502, {
            content: "",
            pageStatusCode: 502,
            pageError: err.message,
          });
        } else {
          throw err;
        }
      } finally {
        release();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, {
        content: "",
        pageStatusCode: 500,
        pageError: message,
      });
    }
    return;
  }

  jsonResponse(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`Browserbase adapter listening on port ${PORT}`);
  console.log(`  Max concurrent sessions: ${MAX_CONCURRENT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
});
