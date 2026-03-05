// ---- Firecrawl discovery pipeline ----
export { discoverViaFirecrawl } from "./discover.js";
export type { FullDiscoveryResult } from "./discover.js";

// ---- Client config ----
export { getFirecrawlConfig } from "./client.js";

// ---- Types ----
export type { FirecrawlExtract, FirecrawlConfig } from "./types.js";
export {
  chooseBestCandidate,
  rankCandidate,
  type CandidateInput,
  type RankedCandidate,
} from "./parser-ensemble.js";
export {
  defaultQueryDiscoveryProviders,
  type QueryDiscoveryProviders,
} from "./providers.js";

// ---- Browserbase fallback extraction ----
export { browserbaseExtract } from "./browserbase-extract.js";

// ---- Constants ----
export {
  FIRECRAWL_EXTRACT_SCHEMA,
  FIRECRAWL_EXTRACT_PROMPT,
  BLOCKED_PATTERNS,
  NOT_FOUND_PATTERNS,
  ProductNotFoundError,
  MAX_VARIANT_EXTRACT,
  CRAWL_PAGE_LIMIT,
  VARIANT_EXTRACT_CONCURRENCY,
  FIRECRAWL_POLL_INTERVAL_MS,
  classifyContent,
} from "./constants.js";

// ---- Shopify ----
export { fetchShopifyOptions } from "./shopify.js";

// ---- Helpers (also used by checkout for scrape code) ----
export {
  stripCurrencySymbol,
  extractPriceFromString,
  mapOptions,
  computeWordOverlap,
  isValidPrice,
} from "./helpers.js";

// ---- Lower-level functions ----
export { pollFirecrawlJob } from "./poll.js";
export { firecrawlExtractAsync } from "./extract.js";
export { firecrawlCrawlAsync } from "./crawl.js";
export {
  resolveVariantPricesViaFirecrawl,
  resolveVariantPricesViaCrawl,
} from "./variant.js";
