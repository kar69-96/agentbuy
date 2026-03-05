/**
 * Browserbase fallback extraction: when Firecrawl's direct scrape fails
 * (bot-blocked), fetch rendered HTML via the Browserbase adapter, convert
 * to markdown, and extract product data using Gemini.
 */

import TurndownService from "turndown";
import { load } from "cheerio";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { ResponseSchema } from "@google/generative-ai";
import type { FirecrawlExtract } from "./types.js";
import {
  FIRECRAWL_EXTRACT_PROMPT,
  BLOCKED_PATTERNS,
  NOT_FOUND_PATTERNS,
  ProductNotFoundError,
  ProductBlockedError,
  MAIN_CONTENT_SELECTORS,
  BOILERPLATE_SELECTORS,
} from "./constants.js";

const ADAPTER_PORT = parseInt(process.env.ADAPTER_PORT ?? "3003", 10);
const ADAPTER_BASE = `http://localhost:${ADAPTER_PORT}`;

const MIN_HTML_LENGTH = 500;

// Limit concurrent Browserbase fallback extractions to avoid overwhelming the adapter.
// The adapter has its own rate limiter, but callers time out if queued too long.
const BB_EXTRACT_CONCURRENCY = parseInt(process.env.BB_EXTRACT_CONCURRENCY ?? "5", 10);
const BB_EXTRACT_QUEUE_TIMEOUT_MS = parseInt(
  process.env.BB_EXTRACT_QUEUE_TIMEOUT_MS ?? "15000",
  10,
);
const GEMINI_EXTRACT_TIMEOUT_MS = parseInt(
  process.env.GEMINI_EXTRACT_TIMEOUT_MS ?? "20000",
  10,
);
const GEMINI_EXTRACT_RETRIES = parseInt(
  process.env.GEMINI_EXTRACT_RETRIES ?? "2",
  10,
);
export type BrowserbaseFailureCode =
  | "blocked"
  | "not_found"
  | "render_timeout"
  | "adapter_502"
  | "extract_empty"
  | "transport_error";
let lastBrowserbaseFailure:
  | { code: BrowserbaseFailureCode; detail?: string }
  | null = null;

export function getLastBrowserbaseFailure():
  | { code: BrowserbaseFailureCode; detail?: string }
  | null {
  return lastBrowserbaseFailure;
}

let bbActive = 0;
const bbQueue: Array<{
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> = [];

function bbAcquire(): Promise<void> {
  if (bbActive < BB_EXTRACT_CONCURRENCY) {
    bbActive++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = bbQueue.findIndex((entry) => entry.reject === reject);
      if (idx >= 0) bbQueue.splice(idx, 1);
      reject(
        new Error(
          `browserbase-extract queue timeout after ${BB_EXTRACT_QUEUE_TIMEOUT_MS}ms`,
        ),
      );
    }, BB_EXTRACT_QUEUE_TIMEOUT_MS);
    bbQueue.push({ resolve, reject, timer });
  });
}

function bbRelease(): void {
  if (bbQueue.length > 0) {
    const next = bbQueue.shift()!;
    clearTimeout(next.timer);
    next.resolve();
  } else {
    bbActive--;
  }
}

// ---- Step 1: Fetch rendered HTML from Browserbase adapter ----

export async function fetchRenderedHtml(
  url: string,
  timeoutMs = 60_000,
): Promise<string> {
  lastBrowserbaseFailure = null;
  const response = await fetch(`${ADAPTER_BASE}/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, timeout: timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 5_000),
  });

  if (!response.ok) {
    lastBrowserbaseFailure = {
      code: response.status === 502 ? "adapter_502" : "transport_error",
      detail: `adapter HTTP ${response.status}`,
    };
    throw new Error(`Adapter returned ${response.status}`);
  }

  const body = (await response.json()) as {
    content: string;
    pageStatusCode: number;
    pageError?: string;
  };

  if (body.pageStatusCode === 404 || body.pageStatusCode === 410) {
    lastBrowserbaseFailure = {
      code: "not_found",
      detail: `browserbase page status ${body.pageStatusCode}`,
    };
    throw new ProductNotFoundError(`Page returned HTTP ${body.pageStatusCode}`);
  }
  if (body.pageStatusCode === 401 || body.pageStatusCode === 403 || body.pageStatusCode === 429) {
    lastBrowserbaseFailure = {
      code: "blocked",
      detail: `browserbase page status ${body.pageStatusCode}`,
    };
    throw new ProductBlockedError(`Page blocked with HTTP ${body.pageStatusCode}`);
  }
  if (body.pageStatusCode >= 400) {
    lastBrowserbaseFailure = {
      code: "transport_error",
      detail: `browserbase page status ${body.pageStatusCode}`,
    };
    throw new Error(`Page returned ${body.pageStatusCode}`);
  }

  const html = body.content ?? "";
  if (html.length < MIN_HTML_LENGTH) {
    lastBrowserbaseFailure = {
      code: "extract_empty",
      detail: `html too short (${html.length})`,
    };
    throw new Error(`HTML too short (${html.length} chars)`);
  }

  const lower = html.toLowerCase();

  // Treat anti-bot content as blocked before not-found to avoid false 404s.
  if (html.length < 5000 && BLOCKED_PATTERNS.some((p) => lower.includes(p))) {
    lastBrowserbaseFailure = {
      code: "blocked",
      detail: "blocked pattern detected in rendered html",
    };
    throw new ProductBlockedError("Page still bot-blocked after Browserbase render");
  }

  // Check for 404/discontinued content.
  if (html.length < 20000 && NOT_FOUND_PATTERNS.some((p) => lower.includes(p))) {
    lastBrowserbaseFailure = {
      code: "not_found",
      detail: "not_found pattern detected in rendered html",
    };
    throw new ProductNotFoundError("Page content indicates product not found or discontinued");
  }

  return html;
}

// ---- Step 2: HTML → Markdown ----

export function htmlToMarkdown(html: string): string {
  const $ = load(html);

  // Strip non-content tags
  $("script, style, noscript, svg, meta, link").remove();

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndown.remove(["img", "iframe"]);

  // Strategy 1: Try main-content selectors
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const $main = $(selector).first();
    if ($main.length) {
      const $clone = load($main.html()!);
      for (const bp of BOILERPLATE_SELECTORS) $clone(bp).remove();
      const md = turndown.turndown($clone.html()!);
      if (md.length >= 1_000) {
        return md.length > 30_000 ? md.slice(0, 30_000) : md;
      }
    }
  }

  // Strategy 2: Full page with boilerplate removed
  for (const bp of BOILERPLATE_SELECTORS) $(bp).remove();
  const md = turndown.turndown($.html()!);

  return md.length > 30_000 ? md.slice(0, 30_000) : md;
}

// ---- Step 3: Gemini extraction ----

function getGeminiApiKey(): string {
  const key = process.env.GOOGLE_API_KEY_QUERY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY_QUERY or GOOGLE_API_KEY is required");
  return key;
}

const GEMINI_EXTRACT_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    name: { type: SchemaType.STRING, description: "Product name or title" },
    price: { type: SchemaType.STRING, description: "Current selling price" },
    original_price: { type: SchemaType.STRING, description: "Original price before discount" },
    currency: { type: SchemaType.STRING, description: "Currency code, e.g. USD, EUR" },
    brand: { type: SchemaType.STRING, description: "Brand or manufacturer" },
    image_url: { type: SchemaType.STRING, description: "Main product image URL" },
    description: { type: SchemaType.STRING, description: "Short product description" },
    options: {
      type: SchemaType.ARRAY,
      description: "ALL product variant option groups (Color, Size, Style, Material, etc.)",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          values: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
      },
    },
    variant_urls: {
      type: SchemaType.ARRAY,
      description: "URLs for other variants of this same product",
      items: { type: SchemaType.STRING },
    },
  },
};

async function extractWithGemini(markdown: string): Promise<FirecrawlExtract | null> {
  const genAI = new GoogleGenerativeAI(getGeminiApiKey());
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_EXTRACT_SCHEMA,
    },
  });

  const prompt = `${FIRECRAWL_EXTRACT_PROMPT}\n\nPage content:\n${markdown}`;

  for (let attempt = 0; attempt <= GEMINI_EXTRACT_RETRIES; attempt++) {
    try {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Gemini extraction timeout")),
            GEMINI_EXTRACT_TIMEOUT_MS,
          ),
        ),
      ]);
      const text = result.response.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as FirecrawlExtract;
      } catch {
        return null;
      }
    } catch {
      if (attempt >= GEMINI_EXTRACT_RETRIES) return null;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

// ---- Orchestrator ----

export async function browserbaseExtract(
  url: string,
  timeoutMs = 90_000,
): Promise<FirecrawlExtract | null> {
  // Wait for a slot — this wait should NOT count against the extraction timeout
  await bbAcquire();
  try {
    console.log(`  [browserbase-extract] Fetching rendered HTML for ${url}`);
    const html = await fetchRenderedHtml(url, timeoutMs);

    console.log(`  [browserbase-extract] Converting HTML to markdown (${html.length} chars)`);
    const markdown = htmlToMarkdown(html);

    console.log(`  [browserbase-extract] Extracting product data via Gemini (${markdown.length} chars)`);
    const extract = await extractWithGemini(markdown);

    if (!extract?.name || !extract?.price) {
      lastBrowserbaseFailure = {
        code: "extract_empty",
        detail: "gemini returned no name/price",
      };
      console.log(`  [browserbase-extract] Gemini extraction returned no name/price`);
      return null;
    }

    console.log(`  [browserbase-extract] Success: ${extract.name} — ${extract.price}`);
    return extract;
  } catch (err) {
    if (err instanceof ProductNotFoundError || err instanceof ProductBlockedError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("timeout")) {
      lastBrowserbaseFailure = { code: "render_timeout", detail: message };
    } else if (message.includes("Adapter returned 502")) {
      lastBrowserbaseFailure = { code: "adapter_502", detail: message };
    } else if (!lastBrowserbaseFailure) {
      lastBrowserbaseFailure = { code: "transport_error", detail: message };
    }
    console.log(`  [browserbase-extract] Failed: ${message}`);
    return null;
  } finally {
    bbRelease();
  }
}
