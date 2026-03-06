import { firecrawlScrapeJson, type FirecrawlFailure } from "./extract.js";
import { browserbaseExtractWithFailure, type BrowserbaseFailure } from "./browserbase-extract.js";
import type { FirecrawlConfig, FirecrawlExtract } from "./types.js";

export interface FirecrawlExtractResult {
  extract: FirecrawlExtract | null;
  failure: FirecrawlFailure | null;
}

export interface BrowserbaseExtractResult {
  extract: FirecrawlExtract | null;
  failure: BrowserbaseFailure | null;
}

export interface QueryDiscoveryProviders {
  firecrawlExtract: (
    url: string,
    config: FirecrawlConfig,
    timeoutMs: number,
  ) => Promise<FirecrawlExtractResult>;
  browserbaseExtract: (url: string, timeoutMs: number) => Promise<BrowserbaseExtractResult>;
}

export const defaultQueryDiscoveryProviders: QueryDiscoveryProviders = {
  async firecrawlExtract(url, config, timeoutMs) {
    return firecrawlScrapeJson(url, config, timeoutMs);
  },
  async browserbaseExtract(url, timeoutMs) {
    return browserbaseExtractWithFailure(url, timeoutMs);
  },
};
