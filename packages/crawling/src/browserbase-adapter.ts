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
const MAX_CONCURRENT = parseInt(process.env.ADAPTER_CONCURRENCY ?? "8", 10);
const BROWSERBASE_API_URL = "https://api.browserbase.com/v1/sessions";
const SESSION_TIMEOUT_S = 300;

// Rate limit: max N session creations per second to avoid thundering herd
const SESSION_CREATE_RATE = parseInt(process.env.ADAPTER_SESSION_RATE ?? "4", 10);
const ADAPTER_QUEUE_TIMEOUT_MS = parseInt(
  process.env.ADAPTER_QUEUE_TIMEOUT_MS ?? "15000",
  10,
);
const ADAPTER_RATE_QUEUE_TIMEOUT_MS = parseInt(
  process.env.ADAPTER_RATE_QUEUE_TIMEOUT_MS ?? "12000",
  10,
);

// Retry config for transient failures in handleScrape
const SCRAPE_RETRIES = 2;
const SCRAPE_RETRY_BASE_MS = 2000;

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

// ---- Concurrency semaphore ----

let activeCount = 0;
const waiting: Array<{
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  enqueuedAt: number;
}> = [];
let queueTimeouts = 0;
let scrapeRetriesTriggered = 0;
let sessionRetriesTriggered = 0;

function acquire(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const enqueuedAt = Date.now();
    const timer = setTimeout(() => {
      const idx = waiting.findIndex((entry) => entry.reject === reject);
      if (idx >= 0) waiting.splice(idx, 1);
      queueTimeouts++;
      reject(
        new Error(
          `adapter concurrency queue timeout after ${ADAPTER_QUEUE_TIMEOUT_MS}ms`,
        ),
      );
    }, ADAPTER_QUEUE_TIMEOUT_MS);
    waiting.push({ resolve, reject, timer, enqueuedAt });
  });
}

function release(): void {
  if (waiting.length > 0) {
    const next = waiting.shift()!;
    clearTimeout(next.timer);
    next.resolve();
  } else {
    activeCount--;
  }
}

// ---- Session creation rate limiter ----
// Ensures we don't slam Browserbase API with N simultaneous createSession calls.
// Uses a token-bucket approach: refills SESSION_CREATE_RATE tokens per second.

let rateBucket = SESSION_CREATE_RATE;
let lastRefill = Date.now();
const rateQueue: Array<{
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  enqueuedAt: number;
}> = [];

function refillBucket(): void {
  const now = Date.now();
  const elapsed = now - lastRefill;
  if (elapsed >= 1000) {
    const tokens = Math.floor(elapsed / 1000) * SESSION_CREATE_RATE;
    rateBucket = Math.min(rateBucket + tokens, SESSION_CREATE_RATE);
    lastRefill = now;
  }
}

function acquireRateToken(): Promise<void> {
  refillBucket();
  if (rateBucket > 0) {
    rateBucket--;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const enqueuedAt = Date.now();
    const timer = setTimeout(() => {
      const idx = rateQueue.findIndex((entry) => entry.reject === reject);
      if (idx >= 0) rateQueue.splice(idx, 1);
      queueTimeouts++;
      reject(
        new Error(
          `adapter rate queue timeout after ${ADAPTER_RATE_QUEUE_TIMEOUT_MS}ms`,
        ),
      );
    }, ADAPTER_RATE_QUEUE_TIMEOUT_MS);
    rateQueue.push({ resolve, reject, timer, enqueuedAt });
  });
}

// Drain the rate queue periodically
setInterval(() => {
  refillBucket();
  while (rateBucket > 0 && rateQueue.length > 0) {
    rateBucket--;
    const next = rateQueue.shift()!;
    clearTimeout(next.timer);
    next.resolve();
  }
}, 250);

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

  // Wait for rate limiter before hitting the API
  await acquireRateToken();

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
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const delay = 1000 * attempt + Math.random() * 500;
      sessionRetriesTriggered++;
      console.log(`  [adapter] Session create ${response.status} — retry ${attempt + 1}/${retries} in ${Math.round(delay)}ms`);
      await sleep(delay);
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

async function waitForChallengeResolution(
  page: import("playwright-core").Page,
): Promise<void> {
  const isChallenge = await page
    .evaluate(() => {
      const title = document.title.toLowerCase();
      const body = document.body?.innerText?.toLowerCase() ?? "";
      if (title.includes("just a moment") || title.includes("attention required")) return true;
      if (document.querySelector("#challenge-running, #challenge-stage, #cf-challenge-running")) return true;
      if (title.includes("access denied") || body.includes("automated access")) return true;
      if (body.includes("please verify you are a human") || body.includes("checking your browser")) return true;
      return false;
    })
    .catch(() => false);

  if (!isChallenge) return;

  const startUrl = page.url();
  console.log(`  [adapter] Challenge detected on ${startUrl} — waiting for Browserbase to solve`);

  await Promise.race([
    page.waitForURL((url) => url.toString() !== startUrl, { timeout: 20_000 }).catch(() => {}),
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

  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
}

// ---- Wait for content readiness ----

async function waitForContent(page: import("playwright-core").Page): Promise<void> {
  await Promise.race([
    page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {}),
    page.waitForSelector(PRODUCT_SELECTORS, { timeout: 5_000 }).catch(() => {}),
  ]);
}

// ---- Scrape handler (single attempt) ----

class AdapterError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "AdapterError";
    this.retryable = retryable;
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

async function scrapeOnce(req: ScrapeRequest): Promise<ScrapeResponse> {
  let sessionId: string | undefined;
  let browser: import("playwright-core").Browser | undefined;
  try {
    const session = await createSession();
    sessionId = session.id;

    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    const timeoutMs = req.timeout ?? 30_000;
    const response = await page.goto(req.url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    await waitForChallengeResolution(page);
    await waitForContent(page);

    if (req.check_selector) {
      await page
        .waitForSelector(req.check_selector, { timeout: 5000 })
        .catch(() => {});
    }

    const content = await page.content();
    const statusCode = response?.status() ?? 200;

    await browser.close();
    browser = undefined;

    return {
      content,
      pageStatusCode: statusCode,
      contentType: "text/html",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Retry on transport and browser/session infra errors.
    const retryable = message.includes("timeout")
      || message.includes("Timeout")
      || message.includes("ECONNREFUSED")
      || message.includes("ECONNRESET")
      || message.includes("session failed")
      || message.includes("queue timeout")
      || message.includes("Target closed")
      || message.includes("browser has been closed");
    throw new AdapterError(message, retryable);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (sessionId) {
      await destroySession(sessionId);
    }
  }
}

// ---- Scrape with retry ----

async function handleScrape(req: ScrapeRequest): Promise<ScrapeResponse> {
  let lastError: AdapterError | undefined;

  for (let attempt = 0; attempt <= SCRAPE_RETRIES; attempt++) {
    try {
      return await scrapeOnce(req);
    } catch (err) {
      if (!(err instanceof AdapterError)) throw err;
      lastError = err;

      if (!err.retryable || attempt >= SCRAPE_RETRIES) break;

      const delay = SCRAPE_RETRY_BASE_MS * (attempt + 1) + Math.random() * 1000;
      scrapeRetriesTriggered++;
      console.log(`  [adapter] Scrape retry ${attempt + 1}/${SCRAPE_RETRIES} for ${req.url} in ${Math.round(delay)}ms (${err.message.slice(0, 60)})`);
      await sleep(delay);
    }
  }

  throw lastError!;
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
    jsonResponse(res, 200, {
      status: "healthy",
      active: activeCount,
      maxConcurrent: MAX_CONCURRENT,
      rateQueue: rateQueue.length,
      waitQueue: waiting.length,
      queueTimeouts,
      scrapeRetriesTriggered,
      sessionRetriesTriggered,
      oldestWaitQueueMs:
        waiting.length > 0 ? Date.now() - waiting[0]!.enqueuedAt : 0,
      oldestRateQueueMs:
        rateQueue.length > 0 ? Date.now() - rateQueue[0]!.enqueuedAt : 0,
    });
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
  console.log(`  Session creation rate: ${SESSION_CREATE_RATE}/s`);
  console.log(`  Scrape retries: ${SCRAPE_RETRIES}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
});
