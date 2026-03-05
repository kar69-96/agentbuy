import { firecrawlExtractAsync } from "./extract.js";
import { browserbaseExtract } from "./browserbase-extract.js";
import type { FirecrawlConfig, FirecrawlExtract } from "./types.js";

export interface QueryDiscoveryProviders {
  firecrawlExtract: (
    url: string,
    config: FirecrawlConfig,
    timeoutMs: number,
  ) => Promise<FirecrawlExtract | null>;
  browserbaseExtract: (url: string, timeoutMs: number) => Promise<FirecrawlExtract | null>;
}

export const defaultQueryDiscoveryProviders: QueryDiscoveryProviders = {
  async firecrawlExtract(url, config, timeoutMs) {
    const results = await firecrawlExtractAsync([url], config, timeoutMs);
    return results?.[0] ?? null;
  },
  async browserbaseExtract(url, timeoutMs) {
    return browserbaseExtract(url, timeoutMs);
  },
};
