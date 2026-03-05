import type { FirecrawlConfig, FirecrawlExtract } from "./types.js";
import {
  FIRECRAWL_EXTRACT_SCHEMA,
  FIRECRAWL_EXTRACT_PROMPT,
  BLOCKED_PATTERNS,
  NOT_FOUND_PATTERNS,
  ProductNotFoundError,
} from "./constants.js";

async function firecrawlScrapeJson(
  url: string,
  config: FirecrawlConfig,
  timeoutMs: number,
): Promise<FirecrawlExtract | null> {
  const response = await fetch(`${config.baseUrl}/v1/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["json", "markdown"],
      jsonOptions: {
        schema: FIRECRAWL_EXTRACT_SCHEMA,
        prompt: FIRECRAWL_EXTRACT_PROMPT,
      },
      timeout: Math.min(timeoutMs, 90000),
      waitFor: 0, // Adapter handles all waiting (smart 3-phase wait)
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) return null;

  const body = (await response.json()) as Record<string, unknown>;
  if (!body["success"]) return null;

  const data = body["data"] as Record<string, unknown> | undefined;
  if (!data) return null;

  // Reject non-2xx pages (403 Cloudflare, 404 not found)
  const metadata = data["metadata"] as Record<string, unknown> | undefined;
  const statusCode = metadata?.["statusCode"] as number | undefined;
  if (statusCode === 404 || statusCode === 410) {
    throw new ProductNotFoundError(`Page returned HTTP ${statusCode}`);
  }
  if (statusCode && statusCode >= 400) return null;

  // Reject empty/tiny content (page didn't render)
  const markdown = ((data["markdown"] as string) ?? "").trim();
  if (markdown.length < 50) return null;

  const lower = markdown.toLowerCase();

  // Detect 404/discontinued pages that return 200 status
  if (markdown.length < 5000 && NOT_FOUND_PATTERNS.some((p) => lower.includes(p))) {
    throw new ProductNotFoundError("Page content indicates product not found or discontinued");
  }

  // Reject known bot-challenge pages with 200 status
  if (markdown.length < 1500 && BLOCKED_PATTERNS.some((p) => lower.includes(p)))
    return null;

  return ((data["json"] ?? data["extract"] ?? null) as FirecrawlExtract | null);
}

export async function firecrawlExtractAsync(
  urls: string[],
  config: FirecrawlConfig,
  timeoutMs: number,
): Promise<FirecrawlExtract[] | null> {
  try {
    const results: FirecrawlExtract[] = [];
    for (const url of urls) {
      const extract = await firecrawlScrapeJson(url, config, timeoutMs);
      if (extract) results.push(extract);
    }
    return results.length > 0 ? results : null;
  } catch (err) {
    if (err instanceof ProductNotFoundError) throw err;
    return null;
  }
}
