/**
 * Browserbase adapter that speaks Firecrawl's Playwright microservice protocol.
 *
 * Firecrawl's engine fallback checks PLAYWRIGHT_MICROSERVICE_URL. When set,
 * the `playwright` engine (quality: 20) sends POST /scrape requests here.
 * This adapter routes those through Browserbase's cloud infrastructure which
 * has CAPTCHA solving, stealth proxies, and anti-bot capabilities built in.
 *
 * Smart 3-phase wait (networkidle → product selectors → DOM stability)
 * replaces the fixed 5s waitForTimeout for better SPA rendering.
 *
 * Start: npx tsx packages/crawling/src/browserbase-adapter.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chromium } from "playwright-core";

// ---- Config ----

const PORT = parseInt(process.env.ADAPTER_PORT ?? "3003", 10);
const MAX_CONCURRENT = parseInt(process.env.ADAPTER_CONCURRENCY ?? "1", 10);
const BROWSERBASE_API_URL = "https://api.browserbase.com/v1/sessions";
const SESSION_TIMEOUT_S = 300; // 5 minutes per scrape session

// ---- Product selectors for smart wait ----

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

// ---- Browserbase session helpers (inlined to avoid circular dep) ----

function getBrowserbaseConfig(): { apiKey: string; projectId: string } {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY is required");
  if (!projectId) throw new Error("BROWSERBASE_PROJECT_ID is required");
  return { apiKey, projectId };
}

const SESSION_COOLDOWN_MS = 2000; // Wait after releasing a session before creating next

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
      console.log(`  429 Too Many Requests — waiting ${SESSION_COOLDOWN_MS * attempt}ms before retry ${attempt + 1}/${retries}`);
      await sleep(SESSION_COOLDOWN_MS * attempt);
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

// ---- Smart wait strategy ----

/**
 * 3-phase smart wait replaces fixed 5s waitForTimeout:
 *   Phase A: networkidle (catches SPA API calls) — 10s timeout
 *   Phase B: Product selector race — 3s timeout
 *   Phase C: DOM stability (MutationObserver) — 3s timeout
 */
async function smartWait(page: import("playwright-core").Page): Promise<void> {
  // Phase A: Wait for network to go idle (no requests for 500ms)
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => { /* timeout is fine — move on */ });

  // Phase B: Race for any product selector to appear
  await page
    .waitForSelector(PRODUCT_SELECTORS, { timeout: 3000 })
    .catch(() => { /* no selector found — move on */ });

  // Phase C: DOM stability — wait for no mutations for 500ms
  await page
    .evaluate(() => {
      return new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, 500);
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        // Start the initial timer (resolves if no mutations at all)
        timer = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 500);
      });
    })
    .catch(() => { /* evaluate failed — move on */ });
}

// ---- Scrape handler ----

/** Adapter-level error (session creation, CDP, timeout) — distinct from page errors */
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

    // Smart 3-phase wait (replaces fixed 5s waitForTimeout)
    await smartWait(page);

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
      await sleep(SESSION_COOLDOWN_MS);
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
        // Page result (even if page returned 403/404) — HTTP 200 so Firecrawl
        // treats it as a valid playwright result
        jsonResponse(res, 200, result);
      } catch (err) {
        if (err instanceof AdapterError) {
          // Adapter-level failure — HTTP 502 so Firecrawl's robustFetch throws
          // and the engine waterfall falls back to fetch
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
