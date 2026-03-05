import type { FirecrawlConfig, FirecrawlExtract } from "./types.js";
import {
  FIRECRAWL_EXTRACT_SCHEMA,
  FIRECRAWL_EXTRACT_PROMPT,
  BLOCKED_PATTERNS,
  NOT_FOUND_PATTERNS,
  ProductNotFoundError,
} from "./constants.js";

export type FirecrawlFailureCode =
  | "blocked"
  | "not_found"
  | "extract_empty"
  | "http_error"
  | "transport_error";

let lastFirecrawlFailure:
  | { code: FirecrawlFailureCode; detail?: string }
  | null = null;

export function getLastFirecrawlFailure():
  | { code: FirecrawlFailureCode; detail?: string }
  | null {
  return lastFirecrawlFailure;
}

async function firecrawlScrapeJson(
  url: string,
  config: FirecrawlConfig,
  timeoutMs: number,
): Promise<FirecrawlExtract | null> {
  lastFirecrawlFailure = null;
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

  if (!response.ok) {
    lastFirecrawlFailure = {
      code: "http_error",
      detail: `firecrawl response ${response.status}`,
    };
    return null;
  }

  const body = (await response.json()) as Record<string, unknown>;
  if (!body["success"]) {
    lastFirecrawlFailure = {
      code: "http_error",
      detail: "firecrawl body success=false",
    };
    return null;
  }

  const data = body["data"] as Record<string, unknown> | undefined;
  if (!data) {
    lastFirecrawlFailure = {
      code: "extract_empty",
      detail: "firecrawl body missing data",
    };
    return null;
  }

  // Reject non-2xx pages (403 Cloudflare, 404 not found)
  const metadata = data["metadata"] as Record<string, unknown> | undefined;
  const statusCode = metadata?.["statusCode"] as number | undefined;
  if (statusCode === 404 || statusCode === 410) {
    lastFirecrawlFailure = {
      code: "not_found",
      detail: `firecrawl status ${statusCode}`,
    };
    throw new ProductNotFoundError(`Page returned HTTP ${statusCode}`);
  }
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
    lastFirecrawlFailure = {
      code: "blocked",
      detail: `firecrawl status ${statusCode}`,
    };
    return null;
  }
  if (statusCode && statusCode >= 400) {
    lastFirecrawlFailure = {
      code: "http_error",
      detail: `firecrawl status ${statusCode}`,
    };
    return null;
  }

  // Reject empty/tiny content (page didn't render)
  const markdown = ((data["markdown"] as string) ?? "").trim();
  const lower = markdown.toLowerCase();

  // Classify challenge and not-found signals first, even for very short pages.
  if (markdown.length > 0 && BLOCKED_PATTERNS.some((p) => lower.includes(p))) {
    lastFirecrawlFailure = {
      code: "blocked",
      detail: "blocked pattern detected in markdown",
    };
    return null;
  }
  if (markdown.length > 0 && NOT_FOUND_PATTERNS.some((p) => lower.includes(p))) {
    lastFirecrawlFailure = {
      code: "not_found",
      detail: "not_found pattern detected in markdown",
    };
    throw new ProductNotFoundError("Page content indicates product not found or discontinued");
  }
  if (markdown.length < 50) {
    lastFirecrawlFailure = {
      code: "extract_empty",
      detail: `markdown too short (${markdown.length})`,
    };
    return null;
  }

  // Treat anti-bot content as blocked before not-found to avoid false 404s.
  if (markdown.length < 1500 && BLOCKED_PATTERNS.some((p) => lower.includes(p))) {
    lastFirecrawlFailure = {
      code: "blocked",
      detail: "blocked pattern detected in markdown",
    };
    return null;
  }

  // Detect 404/discontinued pages that return 200 status.
  if (markdown.length < 5000 && NOT_FOUND_PATTERNS.some((p) => lower.includes(p))) {
    lastFirecrawlFailure = {
      code: "not_found",
      detail: "not_found pattern detected in markdown",
    };
    throw new ProductNotFoundError("Page content indicates product not found or discontinued");
  }

  const extract = ((data["json"] ?? data["extract"] ?? null) as FirecrawlExtract | null);
  if (!extract || (!extract.name && !extract.price)) {
    lastFirecrawlFailure = {
      code: "extract_empty",
      detail: "firecrawl response missing usable json extract",
    };
    return null;
  }

  return extract;
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
    lastFirecrawlFailure = {
      code: "transport_error",
      detail: err instanceof Error ? err.message : String(err),
    };
    return null;
  }
}
