import type { FirecrawlConfig, FirecrawlExtract } from "./types.js";
import {
  FIRECRAWL_EXTRACT_SCHEMA,
  FIRECRAWL_EXTRACT_PROMPT,
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
      formats: ["json"],
      jsonOptions: {
        schema: FIRECRAWL_EXTRACT_SCHEMA,
        prompt: FIRECRAWL_EXTRACT_PROMPT,
      },
      timeout: Math.min(timeoutMs, 60000),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) return null;

  const body = (await response.json()) as Record<string, unknown>;
  if (!body["success"]) return null;

  const data = body["data"] as Record<string, unknown> | undefined;
  return ((data?.["json"] ?? data?.["extract"] ?? null) as FirecrawlExtract | null);
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
  } catch {
    return null;
  }
}
