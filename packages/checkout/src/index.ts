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
} from "./discover.js";
export type { DiscoveryResult } from "./discover.js";

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
