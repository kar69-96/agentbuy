// ---- Checkout orchestration ----
export { runCheckout, CHECKOUT_STEPS } from "./task.js";
export type { CheckoutResult, CheckoutInput, CheckoutStep } from "./task.js";

// ---- Price discovery ----
export {
  discoverPrice,
  scrapePrice,
  discoverViaCart,
  extractJsonLd,
  extractMetaTag,
  discoverProduct,
  scrapePriceWithOptions,
  discoverViaBrowser,
  extractVariantsFromJsonLd,
  fetchVariantPriceBrowser,
  resolveVariantPricesViaBrowser,
  sanitizeVariantValue,
  dismissPopupsOnPage,
} from "./discover.js";
export type {
  DiscoveryResult,
  DiscoveryResultWithOptions,
} from "./discover.js";

// Re-export Firecrawl discovery from @bloon/crawling
export { discoverViaFirecrawl } from "@bloon/crawling";
export type { FullDiscoveryResult } from "@bloon/crawling";

// ---- Concurrency pool ----
export { concurrencyPool } from "./concurrency-pool.js";

// ---- Cost tracking ----
export { CostTracker } from "./cost-tracker.js";

// ---- Confirmation detection ----
export { verifyConfirmationPage } from "./confirm.js";
export type { ConfirmationResult } from "./confirm.js";

// ---- Credentials ----
export {
  buildCredentials,
  isCdpField,
  sanitizeShipping,
  getStagehandVariables,
  getCdpCredentials,
} from "./credentials.js";

// ---- Session management ----
export {
  createSession,
  destroySession,
  getBrowserbaseConfig,
  getModelApiKey,
  getQueryModelApiKey,
} from "./session.js";
export type { BrowserbaseSession, SessionOptions } from "./session.js";

// ---- Domain cache ----
export {
  extractDomainCache,
  injectDomainCache,
  loadDomainCache,
  saveDomainCache,
  isSafeCookie,
  extractDomain,
} from "./cache.js";

// ---- Card fills ----
export {
  fillCardField,
  fillAllCardFields,
  mapFieldToCredential,
} from "./fill.js";
export type { ObservedField } from "./fill.js";
