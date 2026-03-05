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
  MAIN_CONTENT_SELECTORS,
  BOILERPLATE_SELECTORS,
} from "./constants.js";

const ADAPTER_PORT = parseInt(process.env.ADAPTER_PORT ?? "3003", 10);
const ADAPTER_BASE = `http://localhost:${ADAPTER_PORT}`;

const MIN_HTML_LENGTH = 500;

// Limit concurrent Browserbase fallback extractions to avoid overwhelming the adapter.
// The adapter has its own rate limiter, but callers time out if queued too long.
const BB_EXTRACT_CONCURRENCY = parseInt(process.env.BB_EXTRACT_CONCURRENCY ?? "5", 10);
let bbActive = 0;
const bbQueue: Array<() => void> = [];

function bbAcquire(): Promise<void> {
  if (bbActive < BB_EXTRACT_CONCURRENCY) {
    bbActive++;
    return Promise.resolve();
  }
  return new Promise((resolve) => bbQueue.push(resolve));
}

function bbRelease(): void {
  if (bbQueue.length > 0) {
    bbQueue.shift()!();
  } else {
    bbActive--;
  }
}

// ---- Step 1: Fetch rendered HTML from Browserbase adapter ----

export async function fetchRenderedHtml(
  url: string,
  timeoutMs = 60_000,
): Promise<string> {
  const response = await fetch(`${ADAPTER_BASE}/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, timeout: timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 5_000),
  });

  if (!response.ok) {
    throw new Error(`Adapter returned ${response.status}`);
  }

  const body = (await response.json()) as {
    content: string;
    pageStatusCode: number;
    pageError?: string;
  };

  if (body.pageStatusCode === 404 || body.pageStatusCode === 410) {
    throw new ProductNotFoundError(`Page returned HTTP ${body.pageStatusCode}`);
  }
  if (body.pageStatusCode >= 400) {
    throw new Error(`Page returned ${body.pageStatusCode}`);
  }

  const html = body.content ?? "";
  if (html.length < MIN_HTML_LENGTH) {
    throw new Error(`HTML too short (${html.length} chars)`);
  }

  const lower = html.toLowerCase();

  // Check for 404/discontinued content
  if (html.length < 20000 && NOT_FOUND_PATTERNS.some((p) => lower.includes(p))) {
    throw new ProductNotFoundError("Page content indicates product not found or discontinued");
  }

  // Check for bot-challenge content in short pages
  if (html.length < 5000 && BLOCKED_PATTERNS.some((p) => lower.includes(p))) {
    throw new Error("Page still bot-blocked after Browserbase render");
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

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  if (!text) return null;

  try {
    return JSON.parse(text) as FirecrawlExtract;
  } catch {
    return null;
  }
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
      console.log(`  [browserbase-extract] Gemini extraction returned no name/price`);
      return null;
    }

    console.log(`  [browserbase-extract] Success: ${extract.name} — ${extract.price}`);
    return extract;
  } catch (err) {
    if (err instanceof ProductNotFoundError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  [browserbase-extract] Failed: ${message}`);
    return null;
  } finally {
    bbRelease();
  }
}
