import { Stagehand } from "@browserbasehq/stagehand";
import type { Page } from "@browserbasehq/stagehand";
import type { Order, ShippingInfo } from "@bloon/core";
import {
  buildCredentials,
  getStagehandVariables,
  getCdpCredentials,
} from "./credentials.js";
import { verifyConfirmationPage } from "./confirm.js";
import {
  extractDomain,
  loadDomainCache,
  saveDomainCache,
  extractDomainCache,
  injectDomainCache,
  injectLocalStorage,
} from "./cache.js";
import { createSession, destroySession, getModelApiKey } from "./session.js";
import type { SessionOptions } from "./session.js";
import {
  scriptedDismissPopups,
  scriptedFillShipping,
  scriptedFillCardFields,
  scriptedFillBilling,
  scriptedUncheckBillingSameAsShipping,
  scriptedClickButton,
  scriptedSelectOption,
  scriptedFillVerificationCode,
  scriptedDismissExpressPay,
  scriptedCheckRequiredCheckboxes,
  scriptedSelectShippingMethod,
  detectPageType,
  extractConfirmationData,
  extractVisibleTotal,
  extractErrorMessage,
} from "./scripted-actions.js";
import type { PageType } from "./scripted-actions.js";
import { scriptedSelectVariants, shopifyAjaxAddToCart, scriptedDismissInterstitial, validatePostAtcDestination } from "./scripted-checkout-helpers.js";
import { injectStealth } from "./stealth/index.js";
import { getOrCreateInbox, getAgentEmail, pollForVerificationCode } from "./agentmail.js";

// ---- Checkout steps ----

export const CHECKOUT_STEPS = {
  NAVIGATE: "navigate",
  ADD_TO_CART: "add-to-cart",
  PROCEED_TO_CHECKOUT: "proceed-to-checkout",
  DISMISS_POPUPS: "dismiss-popups",
  FILL_SHIPPING: "fill-shipping",
  SELECT_SHIPPING: "select-shipping",
  AVOID_EXPRESS_PAY: "avoid-express-pay",
  OBSERVE_CARD_FIELDS: "observe-card-fields",
  FILL_CARD: "fill-card",
  FILL_BILLING: "fill-billing",
  VERIFY_EMAIL: "verify-email",
  VERIFY_PRICE: "verify-price",
  PLACE_ORDER: "place-order",
  VERIFY_CONFIRMATION: "verify-confirmation",
  CHECKOUT_ERROR: "checkout-error",
} as const;

export type CheckoutStep = (typeof CHECKOUT_STEPS)[keyof typeof CHECKOUT_STEPS];

// ---- Types ----

export interface CheckoutCheckpoints {
  cart?: string;
  shipping?: string;
  payment?: string;
  confirmation?: string;
}

export interface CheckoutResult {
  success: boolean;
  orderNumber?: string;
  finalTotal?: string;
  sessionId: string;
  replayUrl: string;
  failedStep?: CheckoutStep;
  errorMessage?: string;
  errorCategory?: import("@bloon/core").CheckoutErrorCategory;
  diagnosticScreenshotPath?: string;
  checkpoints?: CheckoutCheckpoints;
  durationMs?: number;
}

export interface CheckoutInput {
  order: Order;
  shipping: ShippingInfo;
  selections?: Record<string, string>;
  dryRun?: boolean;
  sessionOptions?: SessionOptions;
}

// ---- Price tolerance ----

function isPriceAcceptable(expected: string, actual: string): boolean {
  const exp = parseFloat(expected);
  const act = parseFloat(actual);
  if (isNaN(exp) || isNaN(act)) return true; // can't verify, proceed
  if (exp === 0) return true; // dry-run / no expected price
  const diff = Math.abs(act - exp);
  return diff <= 1 || diff / exp <= 0.05;
}

// ---- Max pages & LLM budget ----

const MAX_PAGES = 20;
const MAX_LLM_CALLS = 25;

// ---- Page loop state ----

interface LoopState {
  currentStep: CheckoutStep;
  addedToCart: boolean;
  shippingFilled: boolean;
  cardFilled: boolean;
  billingFilled: boolean;
  selectionsApplied: boolean;
  llmCalls: number;
  pagesVisited: number;
  lastUrl: string;
  lastPageType: PageType | null;
  lastContentHash: string;
  stallCount: number;
  verificationCode?: string;
  confirmationData?: { orderNumber?: string; total?: string };
  cartRecoveryAttempted: boolean;
  opaquePageRecoveryAttempted: boolean;
  accountCreated: boolean;
}

// ---- Map page type → checkout step for reporting ----

function pageTypeToStep(pageType: PageType): CheckoutStep {
  switch (pageType) {
    case "donation-landing":
    case "product":
      return "add-to-cart";
    case "cart":
    case "cart-drawer":
    case "interstitial":
      return "proceed-to-checkout";
    case "login-gate":
      return "proceed-to-checkout";
    case "email-verification":
      return "verify-email";
    case "shipping-form":
      return "fill-shipping";
    case "payment-form":
    case "payment-gateway":
    case "review":
      return "fill-card";
    case "confirmation":
      return "verify-confirmation";
    case "error":
      return "checkout-error";
    default:
      return "navigate";
  }
}

// ---- Build contextual LLM fallback instruction ----

function buildPageInstruction(
  pageType: PageType,
  input: CheckoutInput,
  state: LoopState,
  isStalled = false,
): string {
  const price = input.order.product.price;
  const dryRun = input.dryRun;
  const selections = input.selections;
  const domain = extractDomain(input.order.product.url);

  // Context prefix for the LLM
  const done: string[] = [];
  if (state.shippingFilled) done.push("shipping filled");
  if (state.cardFilled) done.push("card filled");
  if (state.billingFilled) done.push("billing filled");
  const ctx = done.length > 0
    ? `[${domain}] Already done: ${done.join(", ")}. `
    : `[${domain}] `;
  const stallHint = isStalled
    ? "Previous action didn't advance the page. Try a different approach — scroll down, look for alternative buttons, or try clicking directly. "
    : "";

  switch (pageType) {
    case "donation-landing":
      if (isStalled) {
        return `${ctx}${stallHint}Do NOT click the payment method button yet. First find and click the donation amount closest to $${price}. Look for radio buttons, amount cards, or clickable elements showing dollar amounts. After selecting the amount, select "one-time" if available, then click "Continue", "Donate", or "Give now".`;
      }
      return `${ctx}First select the $${price} donation amount — look for radio buttons, amount cards, or clickable dollar amounts. Then select one-time (not recurring). Then click "Continue", "Donate by card", "Donate", or "Give now" to proceed to payment. Do NOT click the payment method button before selecting the amount.`;

    case "product": {
      // Buy endpoint: selections come from the order (set at query time).
      // Checkout should ONLY apply known selections, never explore/discover variants.

      // Item already in cart — navigate to checkout
      if (state.addedToCart) {
        return `${ctx}${stallHint}The item is already in the cart. Click the "Checkout" button to proceed. If you see a cart drawer/sidebar, click "Checkout" inside it. Do NOT click "Add to Cart" again.`;
      }

      if (selections && Object.keys(selections).length > 0) {
        if (state.selectionsApplied) {
          // Selections applied — click Add to Cart
          return `${ctx}${stallHint}Product options are already selected. Click the "Add to Cart", "Add to Bag", or "Buy Now" button NOW. Do NOT re-select any options.`;
        }
        // First attempt: select options
        return `${ctx}Select exactly these options: ${Object.entries(selections).map(([k, v]) => `${k}: ${v}`).join(", ")}. After selecting, click "Add to Cart" or "Add to Bag".`;
      }
      // No selections — just add to cart.
      return `${ctx}Click "Add to Cart", "Add to Bag", or "Buy Now". Do NOT browse or select any product options.`;
    }

    case "cart":
      return `${ctx}${stallHint}Click "Checkout", "Proceed to Checkout", or "Continue to Checkout" to advance to the checkout page.`;

    case "cart-drawer":
      return `${ctx}${stallHint}A cart drawer/sidebar is open. Click "Checkout", "Go to Checkout", or "Proceed to Checkout" inside the cart drawer. If no checkout button, close the drawer and navigate to /checkout.`;

    case "interstitial":
      return `${ctx}${stallHint}This is a warranty/upsell/protection plan page. Click "No thanks", "Skip", "Continue without", "Not now", or "Decline" to dismiss it and proceed to checkout.`;

    case "login-gate": {
      if (state.accountCreated) {
        return `${ctx}${stallHint}Sign in with email=%x_shipping_email% and password="${process.env.AGENT_ACCOUNT_PASSWORD ?? "BloonAgent1!"}". Fill the email and password fields, then click "Sign In" or "Log In".`;
      }
      return `${ctx}${stallHint}Try guest checkout first: click "Guest Checkout", "Continue as Guest", or "No thanks". If no guest option is available, click "Create Account" or "Sign Up" to create a new account with email=%x_shipping_email% and password="${process.env.AGENT_ACCOUNT_PASSWORD ?? "BloonAgent1!"}".`;
    }

    case "email-verification":
      return `${ctx}${stallHint}Enter the verification code that was sent to the email address. The code is: ${state.verificationCode ?? "still being retrieved"}. If you see a code input field, enter it and click Verify/Submit/Continue.`;

    case "shipping-form": {
      if (!state.shippingFilled) {
        return `${ctx}${stallHint}Fill the shipping/contact form with: email=%x_shipping_email%, name=%x_shipping_name%, address=%x_shipping_street%, city=%x_shipping_city%, state=%x_shipping_state%, zip=%x_shipping_zip%, phone=%x_shipping_phone%. Then click "Continue" or "Continue to payment".`;
      }
      return `${ctx}${stallHint}Shipping is already filled. Click "Continue", "Continue to payment", "Next", or "Save and continue" to proceed.`;
    }

    case "payment-form":
    case "payment-gateway":
      if (state.cardFilled) {
        return dryRun
          ? `${ctx}${stallHint}Payment fields are already filled. Find the order total and report it. Do NOT click Place Order.`
          : `${ctx}${stallHint}Payment fields are already filled. Click "Place Order", "Complete Purchase", "Submit Order", "Pay Now", or "Donate" to finalize.`;
      }
      return `${ctx}${stallHint}Fill the credit card payment fields, then ${dryRun ? "stop — do NOT place the order" : "click Place Order to finalize"}.`;

    case "review":
      return dryRun
        ? `${ctx}${stallHint}This is the order review page. Find the order total and report it. Do NOT place the order.`
        : `${ctx}${stallHint}This is the order review page. Review the details and click "Place Order", "Confirm Order", "Complete Purchase", or "Submit Order" to finalize.`;

    case "confirmation":
      return `${ctx}Extract the order/confirmation number and final total from this confirmation page.`;

    default:
      if (state.addedToCart) {
        return `${ctx}${stallHint}Navigate to checkout. Look for a "Checkout" button (maybe inside a cart drawer), or click the cart icon and then "Checkout". Do NOT add items again.`;
      }
      return `${ctx}${stallHint}Navigate towards checkout completion. Look for checkout, cart, or payment links. Scroll down if needed.`;
  }
}

// ---- Session health check ----

async function isSessionAlive(page: Page): Promise<boolean> {
  try {
    await Promise.race([
      page.evaluate(() => document.readyState),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("health timeout")), 5000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

// ---- Platform detection ----

type CheckoutPlatform = "shopify" | "woocommerce" | "bigcommerce" | "magento" | "unknown";

async function detectPlatform(page: Page): Promise<CheckoutPlatform> {
  return page.evaluate(() => {
    // Shopify
    if (
      document.querySelector('meta[name="shopify-checkout-api-token"]') ||
      document.querySelector('link[href*="cdn.shopify.com"]') ||
      document.querySelector('script[src*="cdn.shopify.com"]') ||
      (window as any).Shopify
    ) {
      return "shopify" as const;
    }
    // WooCommerce
    if (
      document.body.classList.contains("woocommerce") ||
      document.body.classList.contains("woocommerce-checkout") ||
      document.querySelector('#wc-stripe-elements-form') ||
      document.querySelector('.woocommerce-checkout')
    ) {
      return "woocommerce" as const;
    }
    // BigCommerce
    if (
      document.querySelector('meta[name="platform"][content="BigCommerce"]') ||
      (window as any).BCData
    ) {
      return "bigcommerce" as const;
    }
    // Magento
    if (
      document.body.classList.contains("checkout-index-index") ||
      document.querySelector('#checkout') && document.querySelector('script[src*="mage"]')
    ) {
      return "magento" as const;
    }
    return "unknown" as const;
  });
}

// ---- Full checkout orchestration ----

export async function runCheckout(
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const { order, shipping } = input;
  const url = order.product.url;
  const domain = extractDomain(url);

  // 1. Build credentials
  const creds = buildCredentials(shipping);
  const stagehandVars = getStagehandVariables(creds);
  const cdpCreds = getCdpCredentials(creds);

  // 2. Prepare shipping data for scripted fill
  const nameParts = (stagehandVars.x_shipping_name ?? "").split(" ");
  const shippingData = {
    email: stagehandVars.x_shipping_email ?? "",
    firstName: nameParts[0] ?? "",
    lastName: nameParts.slice(1).join(" ") || "",
    street: stagehandVars.x_shipping_street ?? "",
    apartment: stagehandVars.x_shipping_apartment ?? "",
    city: stagehandVars.x_shipping_city ?? "",
    state: stagehandVars.x_shipping_state ?? "",
    zip: stagehandVars.x_shipping_zip ?? "",
    country: stagehandVars.x_shipping_country ?? "",
    phone: stagehandVars.x_shipping_phone ?? "",
  };

  // 3. Billing data
  const billingData = {
    street: stagehandVars.x_billing_street ?? "",
    city: stagehandVars.x_billing_city ?? "",
    state: stagehandVars.x_billing_state ?? "",
    zip: stagehandVars.x_billing_zip ?? "",
    country: stagehandVars.x_billing_country ?? "",
  };

  // 3b. AgentMail — replace shipping email with agent inbox for verification support
  let agentInboxId: string | null = null;
  if (process.env.AGENTMAIL_API_KEY) {
    try {
      const inbox = await getOrCreateInbox();
      agentInboxId = inbox.inboxId;
      shippingData.email = inbox.email;
      stagehandVars.x_shipping_email = inbox.email;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [agentmail] init failed, using original email: ${msg.slice(0, 100)}`);
    }
  }

  // 4. Validate keys early (fail fast with clear error)
  const modelApiKey = getModelApiKey();

  // 5. Create Browserbase session
  const session = await createSession(input.sessionOptions);
  let stagehand: InstanceType<typeof Stagehand> | undefined;
  const startMs = Date.now();

  try {
    // 6. Init Stagehand
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      model: {
        modelName: "google/gemini-2.5-flash",
        apiKey: modelApiKey,
      },
      browserbaseSessionID: session.id,
      experimental: true,
    });

    await stagehand.init();
    const page: Page = stagehand.context.activePage()!;

    // 7a. Inject stealth patches (before any navigation)
    await injectStealth(page);

    // 7b. Inject domain cache cookies (before navigation)
    const existingCache = loadDomainCache(domain);
    if (existingCache) {
      await injectDomainCache(page, existingCache);
    }

    // 8. Navigate to product URL
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeoutMs: 60000,
    });
    await Promise.race([
      page.waitForLoadState("networkidle").catch(() => {}),
      page.waitForTimeout(5000),
    ]);

    // 8a-verify. Redirect verification (with retry for chrome-error pages)
    let finalUrl = page.url();
    const origDomain = extractDomain(url);
    let finalDomain = extractDomain(finalUrl);

    // Retry navigation if we landed on a Chrome error page (bot-block, DNS failure, etc.)
    // Strategy: first retry direct, then try via Google search referrer (more trusted)
    if (finalDomain === "chromewebdata" || finalUrl.startsWith("chrome-error://")) {
      console.log(`  [navigate] Chrome error page detected, trying warm-up navigation...`);

      // Attempt 1: Direct retry with delay
      await page.waitForTimeout(3000);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 60000 });
        await Promise.race([
          page.waitForLoadState("networkidle").catch(() => {}),
          page.waitForTimeout(8000),
        ]);
      } catch { /* check URL below */ }
      finalUrl = page.url();
      finalDomain = extractDomain(finalUrl);

      // Attempt 2: Navigate via Google search referrer (builds trust score)
      if (finalDomain === "chromewebdata" || finalUrl.startsWith("chrome-error://")) {
        console.log(`  [navigate] direct retry failed, trying Google search referrer...`);
        try {
          // Visit Google first to establish a warm TLS session + referrer
          await page.goto("https://www.google.com", { waitUntil: "domcontentloaded", timeoutMs: 30000 });
          await page.waitForTimeout(2000);

          // Navigate to the product URL (now has google.com referrer)
          await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 60000 });
          await Promise.race([
            page.waitForLoadState("networkidle").catch(() => {}),
            page.waitForTimeout(8000),
          ]);
        } catch { /* check URL below */ }
        finalUrl = page.url();
        finalDomain = extractDomain(finalUrl);

        if (finalDomain !== "chromewebdata" && !finalUrl.startsWith("chrome-error://")) {
          console.log(`  [navigate] Google referrer approach succeeded: ${finalUrl.slice(0, 80)}`);
        } else {
          console.log(`  [navigate] all retry strategies exhausted — site blocks automation`);
        }
      } else {
        console.log(`  [navigate] direct retry succeeded: ${finalUrl.slice(0, 80)}`);
      }
    }

    try {
      if (origDomain !== finalDomain) {
        return {
          success: false,
          sessionId: session.id,
          replayUrl: session.replayUrl,
          failedStep: "navigate" as CheckoutStep,
          errorMessage: `Redirect to different domain: ${origDomain} → ${finalDomain}`,
          durationMs: Date.now() - startMs,
        };
      }
      const finalUrlObj = new URL(finalUrl);
      const isSearchPage =
        ["/search", "/find"].some(s => finalUrlObj.pathname.toLowerCase().includes(s)) ||
        ["q=", "query="].some(s => finalUrlObj.search.toLowerCase().includes(s));
      if (isSearchPage) {
        return {
          success: false,
          sessionId: session.id,
          replayUrl: session.replayUrl,
          failedStep: "navigate" as CheckoutStep,
          errorMessage: `Product URL redirected to search page — product may no longer exist at original URL`,
          durationMs: Date.now() - startMs,
        };
      }
      if (finalUrl !== url) {
        console.log(`  [redirect] ${url.slice(0, 80)} → ${finalUrl.slice(0, 80)}`);
      }
    } catch { /* URL parsing failed — continue */ }

    // 8a-bot. Bot-block detection — minimal page content signals bot-blocked site
    try {
      const bodyText = await page.evaluate(() => document.body.textContent || "");
      const wordCount = bodyText.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
      const charCount = bodyText.trim().length;
      if (charCount < 500 || wordCount < 50) {
        console.log(`  [bot-blocked] page content too small: ${charCount} chars, ${wordCount} words`);
        return {
          success: false,
          sessionId: session.id,
          replayUrl: session.replayUrl,
          failedStep: "navigate" as CheckoutStep,
          errorMessage: `bot_blocked: page rendered minimal content (${charCount} chars, ${wordCount} words) — site likely blocks automated browsers`,
          durationMs: Date.now() - startMs,
        };
      }
    } catch {
      // Page evaluation failed — continue; we'll discover issues in the loop
    }

    // 8a-platform. Detect checkout platform for tuning
    let platform: CheckoutPlatform = "unknown";
    try {
      platform = await detectPlatform(page);
      if (platform !== "unknown") {
        console.log(`  [platform] detected: ${platform}`);
      }
    } catch { /* continue without platform info */ }

    // 8b. Inject localStorage (must happen after navigating to target domain)
    if (existingCache) {
      try {
        await injectLocalStorage(page, existingCache);
      } catch {
        // localStorage injection is best-effort
      }
    }

    // 8c. DOM pruning — strip non-functional elements to reduce token count
    //     IMPORTANT: do NOT remove aria-hidden elements — Shopify uses aria-hidden
    //     on responsive product forms/ATC buttons, which breaks page detection.
    await page.evaluate(() => {
      document.querySelectorAll("noscript").forEach(e => e.remove());
      document.querySelectorAll("img").forEach(img => { img.removeAttribute("srcset"); });
    });

    // 8d. Initial scripted popup dismissal
    await scriptedDismissPopups(page);

    // 9. Page-based loop
    const state: LoopState = {
      currentStep: "navigate",
      addedToCart: false,
      shippingFilled: false,
      cardFilled: false,
      billingFilled: false,
      selectionsApplied: false,
      llmCalls: 0,
      pagesVisited: 0,
      lastUrl: page.url(),
      lastPageType: null,
      lastContentHash: "",
      stallCount: 0,
      confirmationData: undefined,
      cartRecoveryAttempted: false,
      opaquePageRecoveryAttempted: false,
      accountCreated: false,
    };

    for (let pageIdx = 0; pageIdx < MAX_PAGES; pageIdx++) {
      try {
      state.pagesVisited = pageIdx;

      // 9a. Wait for page to settle
      await Promise.race([
        page.waitForLoadState("networkidle").catch(() => {}),
        page.waitForTimeout(2000),
      ]);

      // 9b. Dismiss popups
      await scriptedDismissPopups(page);

      // 9c. Detect page type — with URL-based login-gate pre-check
      let pageType: PageType;
      const detectUrl = page.url().toLowerCase();
      const isAuthRedirect = [
        '/identity/', '/auth/', '/signin', '/sign-in', '/login',
        '/account/login', '/ap/signin', '/sso/',
      ].some(p => detectUrl.includes(p));

      if (isAuthRedirect) {
        pageType = "login-gate";
      } else {
        try {
          pageType = await detectPageType(page);
        } catch {
          console.log(`  [detect-error] detectPageType threw, treating as unknown`);
          pageType = "unknown";
        }
      }
      state.currentStep = pageTypeToStep(pageType);
      console.log(`[page ${pageIdx}] type=${pageType} url=${page.url().slice(0, 80)}`);

      // 9d. Run page-type handler (all scripted, 0 LLM)
      let advanced = false;

      switch (pageType) {
        case "donation-landing": {
          // 3-step scripted handler: select amount → one-time → click payment button
          console.log(`  [donation] entering scripted handler, price=${input.order.product.price}`);
          const price = input.order.product.price;
          let amountSelected = false;

          // Step 1: Select donation amount matching order price
          if (price) {
            const priceNum = parseFloat(price);
            const variants = [
              `$${priceNum}`, `$${priceNum.toFixed(2)}`, `${priceNum}`, `${priceNum.toFixed(2)}`,
            ];

            // Try radio buttons with matching value
            for (const v of variants) {
              if (await scriptedSelectOption(page, v, "radio")) {
                amountSelected = true;
                console.log(`  [donation] selected amount via radio: ${v}`);
                break;
              }
            }

            // Try data-amount or clickable elements containing price text
            if (!amountSelected) {
              amountSelected = await page.evaluate((vars: string[]) => {
                // data-amount attributes
                for (const v of vars) {
                  const plain = v.replace("$", "");
                  const el = document.querySelector(`[data-amount="${plain}"], [data-amount="${v}"]`);
                  if (el) { (el as HTMLElement).click(); return true; }
                }
                // Buttons/labels containing the price text
                const clickables = document.querySelectorAll(
                  'button, label, [role="button"], [class*="amount" i], [class*="option" i]',
                );
                for (const el of clickables) {
                  const text = (el.textContent || "").trim();
                  if (vars.some(v => text === v || text.includes(v))) {
                    (el as HTMLElement).click();
                    return true;
                  }
                }
                return false;
              }, variants);
              if (amountSelected) console.log(`  [donation] selected amount via DOM click`);
            }
          }

          // Step 2: Select one-time (not recurring)
          if (amountSelected) {
            await page.waitForTimeout(500);
            const oneTimeSelected =
              await scriptedSelectOption(page, "one-time", "radio") ||
              await scriptedSelectOption(page, "one time", "radio") ||
              await scriptedSelectOption(page, "just once", "radio");
            if (oneTimeSelected) console.log(`  [donation] selected one-time frequency`);
          }

          // Step 3: Click payment button (only if amount was selected)
          if (amountSelected) {
            await page.waitForTimeout(500);
            advanced =
              await scriptedClickButton(page, "donate by credit") ||
              await scriptedClickButton(page, "donate by card") ||
              await scriptedClickButton(page, "credit card") ||
              await scriptedClickButton(page, "credit/debit card") ||
              await scriptedClickButton(page, "donate now") ||
              await scriptedClickButton(page, "continue") ||
              await scriptedClickButton(page, "donate") ||
              await scriptedClickButton(page, "give now");
            if (advanced) console.log(`  [donation] clicked payment button`);
          }

          // If amount selection failed → advanced stays false → LLM fallback
          if (!amountSelected && price) {
            console.log(`  [donation] scripted amount selection failed for $${price}`);
          }
          break;
        }

        case "product": {
          if (input.selections && Object.keys(input.selections).length > 0 && !state.selectionsApplied) {
            // Try scripted variant selection first
            const { selected, failed } = await scriptedSelectVariants(page, input.selections);
            if (selected.length > 0) {
              console.log(`  [product] scripted variant selection: ${selected.join(", ")}`);
            }
            if (failed.length > 0) {
              console.log(`  [product] variant selection failed for: ${failed.join(", ")} — deferring to LLM`);
              // Don't mark as applied — LLM fallback will handle remaining
              break;
            }
            state.selectionsApplied = true;
            await page.waitForTimeout(500);
            // Fall through to ATC below
          }

          // If already added to cart, navigate to /checkout directly
          if (state.addedToCart) {
            console.log(`  [product] already in cart, navigating to /checkout`);
            try {
              const checkoutUrl = new URL(page.url());
              checkoutUrl.pathname = "/checkout";
              checkoutUrl.search = "";
              await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeoutMs: 15000 });
              advanced = true;
            } catch {
              // Fall through to LLM
            }
            break;
          }

          // Check for out-of-stock / unavailable variant before trying ATC
          const isUnavailable = await page.evaluate(() => {
            const unavailableTexts = [
              "option not available", "sold out", "out of stock",
              "unavailable", "notify me", "coming soon", "not available",
              "currently out", "temporarily out",
            ];
            // Check VISIBLE buttons and submit inputs for unavailable signals
            // Skip visually-hidden elements to avoid false positives from back-in-stock notifiers
            const allButtons = document.querySelectorAll('button, input[type="submit"]');
            let hasVisibleAtc = false;
            for (const btn of allButtons) {
              const style = window.getComputedStyle(btn);
              // Skip hidden, zero-size, or visually-hidden buttons
              if (
                style.display === "none" ||
                style.visibility === "hidden" ||
                style.opacity === "0" ||
                btn.classList.contains("visually-hidden") ||
                btn.getAttribute("aria-hidden") === "true" ||
                (btn as HTMLElement).offsetWidth === 0
              ) continue;

              const text = (btn.textContent || "").trim().toLowerCase();
              const value = ((btn as HTMLInputElement).value || "").toLowerCase();
              const combined = `${text} ${value}`;

              // Track if we see a visible ATC-like button (even if disabled)
              if (/add to cart|add to bag|buy now|ship it/i.test(combined)) {
                hasVisibleAtc = true;
                // Only flag as unavailable if the ATC button itself says sold out
                if ((btn as HTMLButtonElement).disabled) {
                  return text || value || "unavailable";
                }
                continue; // ATC button exists and is enabled — not out of stock
              }

              if (unavailableTexts.some(s => combined.includes(s))) {
                return text || value || "unavailable";
              }
            }
            // If we found a visible, enabled ATC button, not out of stock
            if (hasVisibleAtc) return null;
            return null;
          });
          if (isUnavailable) {
            console.log(`  [product] ATC button unavailable: "${isUnavailable}"`);
            return {
              success: false,
              sessionId: session.id,
              replayUrl: session.replayUrl,
              failedStep: "add-to-cart" as CheckoutStep,
              errorMessage: `out_of_stock: ${isUnavailable}`,
              durationMs: Date.now() - startMs,
            };
          }

          // No selections needed, or selections already applied — try scripted add-to-cart
          // Prefer "buy now" (goes directly to checkout, skips cart drawer)
          let addedToCart =
            await scriptedClickButton(page, "buy now") ||
            await scriptedClickButton(page, "add to cart") ||
            await scriptedClickButton(page, "add to bag") ||
            await scriptedClickButton(page, "add to basket") ||
            await scriptedClickButton(page, "ship it") ||
            await scriptedClickButton(page, "deliver it");
          // Shopify AJAX cart fallback: if scripted buttons fail on Shopify, use /cart/add.js
          if (!addedToCart && platform === "shopify") {
            console.log(`  [shopify] scripted ATC buttons failed, trying AJAX cart API`);
            try {
              const ajaxResult = await shopifyAjaxAddToCart(page, input.selections);
              if (ajaxResult.success) {
                addedToCart = true;
                console.log(`  [shopify] AJAX cart API succeeded (variant ${ajaxResult.variantId})`);
              } else {
                console.log(`  [shopify] AJAX cart API failed: ${ajaxResult.error}`);
              }
            } catch (err) {
              console.log(`  [shopify] AJAX cart API error: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          if (addedToCart) {
            state.addedToCart = true;
            console.log(`  [product] added to cart via ${platform === "shopify" ? "AJAX API or" : ""} scripted click`);

            // Shopify fast path: skip cart page, go directly to /checkout
            if (platform === "shopify") {
              console.log(`  [shopify] fast path: navigating directly to /checkout`);
              try {
                const checkoutUrl = new URL(page.url());
                checkoutUrl.pathname = "/checkout";
                checkoutUrl.search = "";
                await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeoutMs: 15000 });
                advanced = true;
              } catch {
                // Fall through to post-ATC validation
              }
              if (advanced) break;
            }

            // Validate post-ATC destination (handles interstitials, cart drawers, navigation)
            const postAtc = await validatePostAtcDestination(
              page, detectPageType, scriptedDismissInterstitial,
            );
            console.log(`  [post-atc] destination=${postAtc.pageType} advanced=${postAtc.advanced}`);
            advanced = postAtc.advanced;

            // If destination is cart-drawer, try checkout buttons
            if (postAtc.pageType === "cart-drawer") {
              const wentToCheckout =
                await scriptedClickButton(page, "checkout") ||
                await scriptedClickButton(page, "proceed to checkout") ||
                await scriptedClickButton(page, "go to checkout") ||
                await scriptedClickButton(page, "secure checkout");
              if (wentToCheckout) {
                console.log(`  [post-atc] clicked checkout in cart drawer`);
                advanced = true;
              }
            }
          }
          break;
        }

        case "interstitial": {
          console.log(`  [interstitial] detected warranty/upsell page, dismissing`);
          const dismissResult = await scriptedDismissInterstitial(page);
          if (dismissResult.dismissed) {
            console.log(`  [interstitial] dismissed via decline button`);
            advanced = true;
          } else {
            console.log(`  [interstitial] no decline button found, pressing Escape`);
            // Escape was already pressed by dismissFn — wait and re-detect
            await page.waitForTimeout(1000);
          }
          break;
        }

        case "cart": {
          advanced =
            await scriptedClickButton(page, "checkout") ||
            await scriptedClickButton(page, "proceed to checkout") ||
            await scriptedClickButton(page, "continue to checkout") ||
            await scriptedClickButton(page, "secure checkout") ||
            await scriptedClickButton(page, "go to checkout") ||
            await scriptedClickButton(page, "start checkout") ||
            await scriptedClickButton(page, "begin checkout");
          // Fallback: navigate directly to /checkout if buttons didn't work
          if (!advanced) {
            console.log(`  [cart] no checkout button found, navigating to /checkout`);
            try {
              const checkoutUrl = new URL(page.url());
              checkoutUrl.pathname = "/checkout";
              checkoutUrl.search = "";
              await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeoutMs: 15000 });
              advanced = true;
            } catch {
              // Fall through to LLM
            }
          }
          break;
        }

        case "cart-drawer": {
          // Click checkout button inside the cart drawer
          advanced =
            await scriptedClickButton(page, "checkout") ||
            await scriptedClickButton(page, "go to checkout") ||
            await scriptedClickButton(page, "proceed to checkout") ||
            await scriptedClickButton(page, "secure checkout");
          // If no drawer checkout button, navigate directly
          if (!advanced) {
            try {
              const checkoutUrl = new URL(page.url());
              checkoutUrl.pathname = "/checkout";
              checkoutUrl.search = "";
              await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeoutMs: 15000 });
              advanced = true;
            } catch {
              // Fall through to LLM
            }
          }
          break;
        }

        case "login-gate": {
          // Check for guest checkout option first
          const loginPageInfo = await page.evaluate(() => {
            const url = window.location.href.toLowerCase();
            // Check both main page and dialog content
            const bodyText = (document.body.textContent || "").toLowerCase();
            const dialog = document.querySelector('dialog, [role="dialog"]');
            const dialogText = dialog ? (dialog.textContent || "").toLowerCase() : "";
            const text = bodyText + " " + dialogText;

            const guestOptions = [
              "guest checkout", "continue as guest", "checkout as guest",
              "continue without account", "without signing in", "skip sign in",
              "shop as guest", "no thanks", "without account",
            ];
            const hasGuest = guestOptions.some(g => text.includes(g));
            const hasSignInForm = !!document.querySelector(
              'input[type="password"], input[name*="password" i]'
            );
            // Also check inside dialogs
            const hasSignInFormInDialog = dialog ? !!dialog.querySelector(
              'input[type="password"], input[name*="password" i]'
            ) : false;
            const hasCreateAccount = !!document.querySelector(
              'a[href*="create" i], a[href*="register" i], a[href*="sign-up" i], a[href*="signup" i]'
            ) || ["create account", "create an account", "create your",
              "sign up", "register", "new customer"].some(s => text.includes(s));
            return {
              hasGuest,
              hasSignInForm: hasSignInForm || hasSignInFormInDialog,
              hasCreateAccount,
              url,
              hasDialog: !!dialog,
            };
          });

          // Path 1: Guest checkout available — use it
          if (loginPageInfo.hasGuest) {
            advanced =
              await scriptedClickButton(page, "guest checkout") ||
              await scriptedClickButton(page, "continue as guest") ||
              await scriptedClickButton(page, "continue without account") ||
              await scriptedClickButton(page, "guest") ||
              await scriptedClickButton(page, "checkout as guest") ||
              await scriptedClickButton(page, "continue without signing in") ||
              await scriptedClickButton(page, "skip sign in") ||
              await scriptedClickButton(page, "shop as guest") ||
              await scriptedClickButton(page, "checkout without an account") ||
              await scriptedClickButton(page, "no thanks");
            if (advanced) break;
          }

          // Path 2: Already created an account — sign in
          if (state.accountCreated) {
            const checkoutEmail = shippingData.email;
            const accountPassword = process.env.AGENT_ACCOUNT_PASSWORD ?? "BloonAgent1!";
            console.log(`  [login-gate] signing in with account: ${checkoutEmail}`);

            // Try scripted fill for email + password
            const signInFilled = await page.evaluate(({ email, password }: { email: string; password: string }) => {
              let filled = 0;
              const emailInputs = document.querySelectorAll<HTMLInputElement>(
                'input[type="email"], input[name*="email" i], input[id*="email" i], ' +
                'input[autocomplete="email"], input[autocomplete="username"], ' +
                'input[name*="username" i], input[id*="username" i]'
              );
              for (const inp of emailInputs) {
                const style = getComputedStyle(inp);
                if (style.display === "none" || style.visibility === "hidden") continue;
                inp.focus();
                inp.value = email;
                inp.dispatchEvent(new Event("input", { bubbles: true }));
                inp.dispatchEvent(new Event("change", { bubbles: true }));
                filled++;
                break;
              }
              const passInputs = document.querySelectorAll<HTMLInputElement>(
                'input[type="password"], input[name*="password" i]'
              );
              for (const inp of passInputs) {
                const style = getComputedStyle(inp);
                if (style.display === "none" || style.visibility === "hidden") continue;
                inp.focus();
                inp.value = password;
                inp.dispatchEvent(new Event("input", { bubbles: true }));
                inp.dispatchEvent(new Event("change", { bubbles: true }));
                filled++;
                break;
              }
              return filled;
            }, { email: checkoutEmail, password: accountPassword });

            if (signInFilled >= 2) {
              console.log(`  [login-gate] filled email + password, clicking sign in`);
              await page.waitForTimeout(500);
              advanced =
                await scriptedClickButton(page, "sign in") ||
                await scriptedClickButton(page, "log in") ||
                await scriptedClickButton(page, "submit") ||
                await scriptedClickButton(page, "continue");
            } else if (signInFilled === 1 && !loginPageInfo.hasSignInForm) {
              // 2-step auth: email-only first step (Best Buy pattern)
              console.log(`  [login-gate] 2-step auth — submitting email first`);
              await page.waitForTimeout(500);
              const clicked =
                await scriptedClickButton(page, "continue") ||
                await scriptedClickButton(page, "next") ||
                await scriptedClickButton(page, "submit");
              if (clicked) {
                await page.waitForTimeout(3000);
                // Re-check for password field on second step
                const hasPass = await page.evaluate(() =>
                  !!document.querySelector('input[type="password"]')
                );
                if (hasPass) {
                  await page.evaluate((pw: string) => {
                    const inp = document.querySelector<HTMLInputElement>('input[type="password"]');
                    if (inp) {
                      inp.focus();
                      inp.value = pw;
                      inp.dispatchEvent(new Event("input", { bubbles: true }));
                      inp.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                  }, accountPassword);
                  await page.waitForTimeout(500);
                  advanced =
                    await scriptedClickButton(page, "sign in") ||
                    await scriptedClickButton(page, "continue") ||
                    await scriptedClickButton(page, "submit");
                }
              }
            } else {
              console.log(`  [login-gate] scripted sign-in fill got ${signInFilled}/2, deferring to LLM`);
            }
            break;
          }

          // Path 3: No guest option — create an account using shipping email
          if (!state.accountCreated) {
            const checkoutEmail = shippingData.email;
            const accountPassword = process.env.AGENT_ACCOUNT_PASSWORD ?? "BloonAgent1!";
            console.log(`  [login-gate] no guest checkout — creating account with ${checkoutEmail}`);

            // Try to find and click "Create Account" / "Sign Up" / "Register"
            const clickedCreate =
              await scriptedClickButton(page, "create account") ||
              await scriptedClickButton(page, "create an account") ||
              await scriptedClickButton(page, "sign up") ||
              await scriptedClickButton(page, "register") ||
              await scriptedClickButton(page, "new customer");

            if (clickedCreate) {
              console.log(`  [login-gate] navigated to account creation form`);
              await page.waitForTimeout(2000);
            }

            // Use LLM to fill the account creation form
            if (state.llmCalls < MAX_LLM_CALLS) {
              try {
                await stagehand.act(
                  `Create a new account. Fill the registration form with: ` +
                  `email=%x_shipping_email%, ` +
                  `first name=%x_shipping_name% (use only the first word as first name), ` +
                  `last name=(use the second word of %x_shipping_name% as last name, or "Agent" if only one word), ` +
                  `password="${accountPassword}", confirm password="${accountPassword}". ` +
                  `Then click "Create Account", "Sign Up", "Register", or "Submit". ` +
                  `If you see a "sign in" link next to a "create account" link, click "create account" first.`,
                  { variables: stagehandVars },
                );
                state.llmCalls++;
                state.accountCreated = true;
                console.log(`  [login-gate] account creation LLM call completed`);

                // Wait for account creation to process
                await page.waitForTimeout(3000);

                // Check for email verification after account creation
                const postCreateType = await detectPageType(page);
                if (postCreateType === "email-verification") {
                  if (agentInboxId) {
                    console.log(`  [login-gate] email verification required — polling AgentMail`);
                    const pollStart = new Date().toISOString();
                    const code = await pollForVerificationCode(agentInboxId, pollStart, 60_000);
                    if (code) {
                      state.verificationCode = code;
                      const filled = await scriptedFillVerificationCode(page, code);
                      if (filled) {
                        console.log(`  [login-gate] filled verification code: ${code}`);
                        await page.waitForTimeout(1000);
                        await scriptedClickButton(page, "verify") ||
                          await scriptedClickButton(page, "submit") ||
                          await scriptedClickButton(page, "continue") ||
                          await scriptedClickButton(page, "confirm");
                      }
                    }
                  } else {
                    console.log(`  [login-gate] email verification required but no AgentMail — deferring to LLM`);
                  }
                }

                advanced = true;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`  [login-gate] account creation failed: ${msg.slice(0, 100)}`);
                state.llmCalls++;
              }
            }
          }
          break;
        }

        case "email-verification": {
          // Poll AgentMail for verification code
          if (agentInboxId) {
            const pollStart = new Date().toISOString();
            const code = await pollForVerificationCode(agentInboxId, pollStart, 60_000);

            if (code) {
              state.verificationCode = code;
              const filled = await scriptedFillVerificationCode(page, code);
              if (filled) {
                console.log(`  [email-verification] filled code: ${code}`);
                await page.waitForTimeout(1000);
                advanced =
                  await scriptedClickButton(page, "verify") ||
                  await scriptedClickButton(page, "submit") ||
                  await scriptedClickButton(page, "continue") ||
                  await scriptedClickButton(page, "confirm");
              }
            } else {
              console.log("  [email-verification] timed out waiting for code");
            }
          } else {
            console.log("  [email-verification] no AgentMail inbox available");
          }
          break;
        }

        case "shipping-form": {
          let filled = await scriptedFillShipping(page, shippingData);
          state.shippingFilled = filled.length > 0;
          if (filled.length > 0) {
            console.log(`  [shipping] filled ${filled.length} fields: ${filled.join(", ")}`);
          }

          // Opaque checkout page recovery: if 0 fields filled on a checkout URL,
          // the page may not have rendered (React SPA, bot protection).
          // Runs once — reload then try auth paths, or fail fast.
          if (filled.length === 0 && !state.opaquePageRecoveryAttempted) {
            const checkoutUrl = page.url().toLowerCase();
            if (checkoutUrl.includes("/checkout")) {
              const hasAnyInputs = await page.evaluate(() => {
                const inputs = document.querySelectorAll('input:not([type="hidden"])');
                return Array.from(inputs).filter(el => {
                  const rect = (el as HTMLElement).getBoundingClientRect();
                  return rect.width > 0 && rect.height > 0;
                }).length;
              });
              if (hasAnyInputs === 0) {
                state.opaquePageRecoveryAttempted = true;
                const pageOrigin = new URL(page.url()).origin;

                // Step 1: Try reload — SPA may need full page load
                console.log(`  [opaque-page] 0 visible inputs on checkout, trying reload`);
                try {
                  await page.goto(page.url(), { waitUntil: "domcontentloaded", timeoutMs: 30000 });
                  await page.waitForTimeout(5000);
                  const reloaded = await scriptedFillShipping(page, shippingData);
                  if (reloaded.length > 0) {
                    filled = reloaded;
                    state.shippingFilled = true;
                    console.log(`  [opaque-page] after reload, filled ${reloaded.length} fields`);
                  }
                } catch {
                  console.log(`  [opaque-page] reload failed`);
                }

                // Step 2: If still blank, try auth paths
                if (filled.length === 0) {
                  console.log(`  [opaque-page] still blank, trying auth navigation`);
                  try {
                    for (const authPath of ["/login", "/account/login", "/signin", "/sign-in"]) {
                      await page.goto(`${pageOrigin}${authPath}`, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
                      await page.waitForTimeout(3000);
                      const hasLoginForm = await page.evaluate(() => {
                        const inputs = document.querySelectorAll('input:not([type="hidden"])');
                        return Array.from(inputs).filter(el => {
                          const rect = (el as HTMLElement).getBoundingClientRect();
                          return rect.width > 0 && rect.height > 0;
                        }).length > 0;
                      });
                      if (hasLoginForm) {
                        console.log(`  [opaque-page] found login form at ${authPath}`);
                        advanced = true;
                        break;
                      }
                    }
                    if (!advanced) {
                      console.log(`  [opaque-page] no login form found, site likely bot-blocked`);
                      state.stallCount = 5; // fail fast
                    }
                  } catch {
                    console.log(`  [opaque-page] auth navigation failed`);
                    state.stallCount = 5;
                  }
                }
              }
            }
          }

          // Email-first checkout flow: some sites (Best Buy, etc.) show only email first,
          // then reveal the full shipping form after clicking "Continue"/"Next".
          // If we only filled 0-1 fields, try advancing past the email-only step.
          if (filled.length <= 1) {
            const isEmailFirst = await page.evaluate(() => {
              const visibleInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')).filter(el => {
                const rect = (el as HTMLElement).getBoundingClientRect();
                const style = window.getComputedStyle(el as HTMLElement);
                return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
              });
              // Email-first: page has few visible inputs (1-3) and at least one is email-like
              const emailInputs = visibleInputs.filter(el => {
                const name = ((el as HTMLInputElement).name || "").toLowerCase();
                const type = ((el as HTMLInputElement).type || "").toLowerCase();
                const auto = ((el as HTMLInputElement).autocomplete || "").toLowerCase();
                return type === "email" || name.includes("email") || auto.includes("email");
              });
              return visibleInputs.length <= 3 && emailInputs.length >= 1;
            });

            if (isEmailFirst) {
              console.log(`  [shipping] email-first checkout detected, clicking Continue to reveal full form`);
              const clicked =
                await scriptedClickButton(page, "continue") ||
                await scriptedClickButton(page, "continue as guest") ||
                await scriptedClickButton(page, "next") ||
                await scriptedClickButton(page, "continue to shipping") ||
                await scriptedClickButton(page, "proceed");
              if (clicked) {
                await page.waitForTimeout(3000);
                // Re-fill now that full form should be visible
                const refilled = await scriptedFillShipping(page, shippingData);
                if (refilled.length > filled.length) {
                  filled = refilled;
                  state.shippingFilled = true;
                  console.log(`  [shipping] after continue, filled ${refilled.length} fields: ${refilled.join(", ")}`);
                }
              }
            }
          }

          // If scripted fill got < 3 fields, supplement with LLM using variables
          if (filled.length < 3 && state.llmCalls < MAX_LLM_CALLS) {
            console.log(`  [shipping] only ${filled.length} fields via script, supplementing with LLM`);
            try {
              await stagehand.act(
                `Fill the shipping/contact form: email=%x_shipping_email%, name=%x_shipping_name%, address=%x_shipping_street%, city=%x_shipping_city%, state=%x_shipping_state%, zip=%x_shipping_zip%, phone=%x_shipping_phone%. Skip any fields already filled.`,
                { variables: stagehandVars },
              );
              state.llmCalls++;
              state.shippingFilled = true;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.log(`  [shipping llm error] ${msg.slice(0, 100)}`);
              state.llmCalls++;
            }
          }

          if (state.shippingFilled || filled.length > 0) {
            await page.waitForTimeout(1000);
            advanced =
              await scriptedClickButton(page, "continue") ||
              await scriptedClickButton(page, "continue to payment") ||
              await scriptedClickButton(page, "next") ||
              await scriptedClickButton(page, "save and continue") ||
              await scriptedClickButton(page, "continue to shipping");
            // Also try selecting shipping method (some pages show it on same page)
            await scriptedSelectShippingMethod(page);
          }
          break;
        }

        case "payment-form":
        case "payment-gateway": {
          // Combined checkout pages (Glossier, etc.) show shipping + payment on same page.
          // Fill shipping first if not done yet.
          if (!state.shippingFilled) {
            const shippingFilled = await scriptedFillShipping(page, shippingData);
            state.shippingFilled = shippingFilled.length > 0;
            if (shippingFilled.length > 0) {
              console.log(`  [payment-page shipping] filled ${shippingFilled.length} fields: ${shippingFilled.join(", ")}`);
            }
            // Supplement with LLM if scripted got < 3 fields
            if (shippingFilled.length < 3 && state.llmCalls < MAX_LLM_CALLS) {
              console.log(`  [payment-page shipping] only ${shippingFilled.length} fields via script, supplementing with LLM`);
              try {
                await stagehand.act(
                  `Fill the shipping/contact form fields on this page: email=%x_shipping_email%, name=%x_shipping_name%, address=%x_shipping_street%, city=%x_shipping_city%, state=%x_shipping_state%, zip=%x_shipping_zip%, phone=%x_shipping_phone%. Skip any fields already filled.`,
                  { variables: stagehandVars },
                );
                state.llmCalls++;
                state.shippingFilled = true;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`  [payment-page shipping llm error] ${msg.slice(0, 100)}`);
                state.llmCalls++;
              }
            }
            // Click continue if there's a shipping-to-payment transition button
            await page.waitForTimeout(1000);
            await scriptedClickButton(page, "continue") ||
              await scriptedClickButton(page, "continue to payment") ||
              await scriptedClickButton(page, "next") ||
              await scriptedClickButton(page, "save and continue");
            await page.waitForTimeout(2000);
          }

          // Dismiss express pay overlays before attempting card fill
          const expressPayDismissed = await scriptedDismissExpressPay(page);
          if (expressPayDismissed) {
            console.log(`  [payment] dismissed express pay overlay`);
            await page.waitForTimeout(1000);
          }

          // Early price verification — bail if visible total is way off
          if (!state.cardFilled) {
            const visibleTotal = await extractVisibleTotal(page);
            const expectedPrice = input.order.product.price;
            if (visibleTotal && expectedPrice && !isPriceAcceptable(expectedPrice, visibleTotal)) {
              console.log(`  [price-mismatch] expected=${expectedPrice} visible=${visibleTotal}`);
              try {
                const newCache = await extractDomainCache(page, domain);
                saveDomainCache(newCache);
              } catch { /* best-effort */ }
              return {
                success: false,
                sessionId: session.id,
                replayUrl: session.replayUrl,
                failedStep: CHECKOUT_STEPS.VERIFY_PRICE as CheckoutStep,
                errorMessage: `price_mismatch: expected $${expectedPrice}, got $${visibleTotal}`,
                errorCategory: "price_mismatch" as import("@bloon/core").CheckoutErrorCategory,
                durationMs: Date.now() - startMs,
              };
            }
          }

          // Session health check before card fill
          if (!await isSessionAlive(page)) {
            console.log(`  [session] session dropped before card fill`);
            return {
              success: false,
              sessionId: session.id,
              replayUrl: session.replayUrl,
              failedStep: state.currentStep,
              errorMessage: "session_timeout: Browserbase session dropped",
              durationMs: Date.now() - startMs,
            };
          }

          if (!state.cardFilled) {
            // Uncheck billing same as shipping
            await scriptedUncheckBillingSameAsShipping(page);
            await page.waitForTimeout(500);

            // Fill card fields
            const cardResult = await scriptedFillCardFields(page, cdpCreds);
            state.cardFilled = cardResult.filled > 0;
            console.log(`  [card] filled ${cardResult.filled} fields via ${cardResult.method}`);

            // Wait longer for form validation after card fill
            if (state.cardFilled) {
              await page.waitForTimeout(2000);
            }

            // Fill billing if available
            if (billingData.street) {
              const billingFilled = await scriptedFillBilling(page, billingData);
              state.billingFilled = billingFilled.length > 0;
              if (billingFilled.length > 0) {
                console.log(`  [billing] filled ${billingFilled.length} fields: ${billingFilled.join(", ")}`);
              }
            }
          }

          if (input.dryRun) {
            // Dry run: extract total and stop
            const total = await extractVisibleTotal(page);
            state.confirmationData = { total };
            console.log(`  [dry-run] total=${total ?? "(not found)"}`);
            advanced = true; // Signal completion
            // Return early for dry run — don't place order
            const durationMs = Date.now() - startMs;
            // Save domain cache before returning
            try {
              const newCache = await extractDomainCache(page, domain);
              saveDomainCache(newCache);
            } catch { /* best-effort */ }

            return {
              success: true,
              finalTotal: total,
              sessionId: session.id,
              replayUrl: session.replayUrl,
              durationMs,
            };
          }

          // Check terms/conditions checkboxes before placing order
          const paymentTermsChecked = await scriptedCheckRequiredCheckboxes(page);
          if (paymentTermsChecked.length > 0) {
            console.log(`  [payment] checked ${paymentTermsChecked.length} required checkboxes: ${paymentTermsChecked.join(", ")}`);
          }

          // Live: click place order — try multiple common button labels
          advanced =
            await scriptedClickButton(page, "place order") ||
            await scriptedClickButton(page, "complete purchase") ||
            await scriptedClickButton(page, "submit order") ||
            await scriptedClickButton(page, "donate") ||
            await scriptedClickButton(page, "pay now") ||
            await scriptedClickButton(page, "complete order") ||
            await scriptedClickButton(page, "confirm order") ||
            await scriptedClickButton(page, "pay") ||
            await scriptedClickButton(page, "submit payment");

          // Post-submit: check for inline validation errors (async merchant responses)
          if (advanced) {
            await page.waitForTimeout(3000);

            // 3DS authentication check — look for auth iframe/challenge
            const has3ds = await page.evaluate(() => {
              const iframes = document.querySelectorAll("iframe");
              for (const iframe of iframes) {
                const src = (iframe.src || "").toLowerCase();
                if (/3ds|authenticate|secure|verify|challenge/.test(src)) return true;
              }
              // Check for new popup window indicators
              return false;
            });

            if (has3ds) {
              console.log(`  [3ds] detected 3DS authentication challenge`);
              // Wait up to 30s for 3DS to resolve (test cards auto-approve)
              try {
                await page.waitForTimeout(30000);
              } catch { /* timeout ok */ }
              // Re-check page state after 3DS wait
            }

            const postSubmitType = await detectPageType(page);
            if (postSubmitType === "error") {
              const errorData = await extractErrorMessage(page);
              console.log(`  [post-submit error] type=${errorData.type} message=${errorData.message.slice(0, 100)}`);

              try {
                const newCache = await extractDomainCache(page, domain);
                saveDomainCache(newCache);
              } catch { /* best-effort */ }

              return {
                success: false,
                sessionId: session.id,
                replayUrl: session.replayUrl,
                failedStep: CHECKOUT_STEPS.CHECKOUT_ERROR as CheckoutStep,
                errorMessage: `${errorData.type}: ${errorData.message}`,
                durationMs: Date.now() - startMs,
              };
            }
          }
          break;
        }

        case "review": {
          if (input.dryRun) {
            const total = await extractVisibleTotal(page);
            state.confirmationData = { total };
            const durationMs = Date.now() - startMs;
            try {
              const newCache = await extractDomainCache(page, domain);
              saveDomainCache(newCache);
            } catch { /* best-effort */ }
            return {
              success: true,
              finalTotal: total,
              sessionId: session.id,
              replayUrl: session.replayUrl,
              durationMs,
            };
          }
          // Check terms/conditions checkboxes before placing order
          const termsChecked = await scriptedCheckRequiredCheckboxes(page);
          if (termsChecked.length > 0) {
            console.log(`  [review] checked ${termsChecked.length} required checkboxes`);
          }
          // Click place order
          advanced =
            await scriptedClickButton(page, "place order") ||
            await scriptedClickButton(page, "complete purchase") ||
            await scriptedClickButton(page, "submit order") ||
            await scriptedClickButton(page, "confirm order") ||
            await scriptedClickButton(page, "pay now") ||
            await scriptedClickButton(page, "pay");
          break;
        }

        case "confirmation": {
          const data = await extractConfirmationData(page);
          state.confirmationData = data;
          state.currentStep = "verify-confirmation";
          console.log(`  [confirmation] order=${data.orderNumber ?? "?"} total=${data.total ?? "?"}`);

          // Save domain cache
          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: true,
            orderNumber: data.orderNumber,
            finalTotal: data.total,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            durationMs: Date.now() - startMs,
          };
        }

        case "error": {
          const errorData = await extractErrorMessage(page);
          console.log(`  [error] type=${errorData.type} message=${errorData.message.slice(0, 100)}`);

          // Save domain cache before returning
          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: false,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            failedStep: CHECKOUT_STEPS.CHECKOUT_ERROR as CheckoutStep,
            errorMessage: `${errorData.type}: ${errorData.message}`,
            durationMs: Date.now() - startMs,
          };
        }

        default: {
          // unknown — URL-based navigation fallbacks when LLM can't see elements
          const defaultUrl = page.url().toLowerCase();
          const defaultOrigin = new URL(page.url()).origin;

          // Cart URL but detected as unknown — skip LLM, navigate directly to checkout
          if (state.addedToCart && (
            defaultUrl.includes("/cart") || defaultUrl.includes("/basket") || defaultUrl.includes("/bag")
          )) {
            console.log(`  [unknown→cart] URL looks like cart, navigating to checkout`);
            try {
              // Try scripted checkout button first
              const clickedCheckout =
                await scriptedClickButton(page, "checkout") ||
                await scriptedClickButton(page, "proceed to checkout") ||
                await scriptedClickButton(page, "go to checkout");
              if (!clickedCheckout) {
                await page.goto(`${defaultOrigin}/checkout`, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
              }
              await page.waitForTimeout(3000);
              advanced = true;
            } catch {
              // Fall through to other recovery
            }
          }

          // Help/FAQ page recovery
          if (!advanced && state.addedToCart && (
            defaultUrl.includes("/help") ||
            defaultUrl.includes("/faq") ||
            defaultUrl.includes("/support") ||
            defaultUrl.includes("/customer-service")
          )) {
            try {
              console.log(`  [recovery] help page detected, navigating to ${defaultOrigin}/cart`);
              await page.goto(`${defaultOrigin}/cart`, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
              advanced = true;
            } catch {
              // Fall through to LLM
            }
          }

          // Cart recovery: if we've added to cart but see empty cart signals
          if (state.addedToCart && !state.cartRecoveryAttempted) {
            const isEmptyCart = await page.evaluate(() => {
              const text = (document.body.textContent || "").toLowerCase();
              return text.includes("your cart is empty") ||
                text.includes("no items") ||
                text.includes("0 items in") ||
                text.includes("cart is currently empty");
            });
            if (isEmptyCart) {
              console.log(`  [recovery] empty cart detected, re-navigating to product`);
              state.cartRecoveryAttempted = true;
              state.addedToCart = false;
              try {
                await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
                advanced = true;
              } catch {
                // Fall through to LLM
              }
            }
          }
          break;
        }
      }

      // 9e. Stall detection — track URL + page type + content hash to detect no-progress loops
      const currentUrl = page.url();
      const contentHash = await page.evaluate(() => {
        const forms = document.querySelectorAll("form");
        const formText = Array.from(forms).map(f => f.textContent?.slice(0, 100) || "").join("|");
        const visibleText = (document.body.textContent || "").slice(0, 200);
        return `${formText.slice(0, 200)}|${visibleText}`.slice(0, 400);
      }).catch(() => "");

      if (currentUrl === state.lastUrl && pageType === state.lastPageType && contentHash === state.lastContentHash) {
        state.stallCount++;
        console.log(`  [stall] same url+page+content ${state.stallCount} times`);
      } else {
        // Detect Shopify step transitions via URL params
        if (currentUrl !== state.lastUrl || contentHash !== state.lastContentHash) {
          state.stallCount = 0;
        }
      }

      // Shopify step transition detection — URL params like ?step=contact → ?step=shipping
      if (platform === "shopify" && currentUrl !== state.lastUrl) {
        try {
          const prevParams = new URL(state.lastUrl).searchParams;
          const currParams = new URL(currentUrl).searchParams;
          const prevStep = prevParams.get("step") || "";
          const currStep = currParams.get("step") || "";
          if (prevStep !== currStep && currStep) {
            console.log(`  [shopify] step transition: ${prevStep || "(start)"} → ${currStep}`);
            state.stallCount = 0;
          }
        } catch { /* URL parsing failed */ }
      }

      state.lastUrl = currentUrl;
      state.lastPageType = pageType;
      state.lastContentHash = contentHash;

      // Break out if completely stuck on same page (5+ stalls = no progress possible)
      if (state.stallCount >= 5) {
        console.log(`  [stuck] 5+ stalls on ${pageType} — giving up`);
        break;
      }

      // 9f. Check if we reached confirmation or error after scripted actions
      if (advanced) {
        await Promise.race([
          page.waitForLoadState("networkidle").catch(() => {}),
          page.waitForTimeout(2000),
        ]);
        const postType = await detectPageType(page);
        if (postType === "confirmation") {
          const data = await extractConfirmationData(page);
          state.confirmationData = data;
          state.currentStep = "verify-confirmation";
          console.log(`  [post-action confirmation] order=${data.orderNumber ?? "?"} total=${data.total ?? "?"}`);

          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: true,
            orderNumber: data.orderNumber,
            finalTotal: data.total,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            durationMs: Date.now() - startMs,
          };
        }
        if (postType === "error") {
          const errorData = await extractErrorMessage(page);
          console.log(`  [post-action error] type=${errorData.type} message=${errorData.message.slice(0, 100)}`);

          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: false,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            failedStep: CHECKOUT_STEPS.CHECKOUT_ERROR as CheckoutStep,
            errorMessage: `${errorData.type}: ${errorData.message}`,
            durationMs: Date.now() - startMs,
          };
        }
      }

      // 9g. LLM fallback — if scripted handler didn't advance, or stalled ≥2 times
      const needsLlm = !advanced || state.stallCount >= 2;
      if (needsLlm && state.llmCalls < MAX_LLM_CALLS) {
        const isStalled = state.stallCount >= 2;
        const instruction = buildPageInstruction(pageType, input, state, isStalled);

        // For shipping forms with no scripted fill, pass variables for LLM substitution
        const actOptions: { variables?: Record<string, string> } = {};
        if (pageType === "shipping-form" && !state.shippingFilled) {
          actOptions.variables = stagehandVars;
        }

        console.log(`  [llm fallback ${state.llmCalls + 1}/${MAX_LLM_CALLS}${isStalled ? " STALLED" : ""}] ${instruction.slice(0, 100)}...`);

        try {
          await stagehand.act(instruction, actOptions);
          state.llmCalls++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  [llm error] ${msg.slice(0, 100)}`);
          state.llmCalls++;
        }

        // After LLM on product page, mark selections as applied and try scripted ATC
        if (pageType === "product") {
          // Mark selections as applied after first LLM attempt
          if (input.selections && Object.keys(input.selections).length > 0) {
            state.selectionsApplied = true;
          }

          // Only try ATC if not already added
          if (!state.addedToCart) {
            await page.waitForTimeout(1000);
            let postLlmAtc =
              await scriptedClickButton(page, "buy now") ||
              await scriptedClickButton(page, "add to cart") ||
              await scriptedClickButton(page, "add to bag") ||
              await scriptedClickButton(page, "add to basket") ||
              await scriptedClickButton(page, "ship it") ||
              await scriptedClickButton(page, "deliver it");

            // Shopify AJAX fallback after LLM attempt
            if (!postLlmAtc && platform === "shopify") {
              console.log(`  [post-llm] scripted ATC failed on Shopify, trying AJAX cart API`);
              try {
                const ajaxResult = await shopifyAjaxAddToCart(page, input.selections);
                if (ajaxResult.success) {
                  postLlmAtc = true;
                  console.log(`  [post-llm] Shopify AJAX cart API succeeded (variant ${ajaxResult.variantId})`);
                } else {
                  console.log(`  [post-llm] Shopify AJAX cart API failed: ${ajaxResult.error}`);
                }
              } catch (err) {
                console.log(`  [post-llm] Shopify AJAX error: ${err instanceof Error ? err.message : String(err)}`);
              }
            }

            if (postLlmAtc) {
              state.addedToCart = true;
              console.log(`  [post-llm] add-to-cart succeeded`);

              // Shopify: go directly to /checkout
              if (platform === "shopify") {
                console.log(`  [post-llm] Shopify fast path: navigating to /checkout`);
                try {
                  const checkoutUrl = new URL(page.url());
                  checkoutUrl.pathname = "/checkout";
                  checkoutUrl.search = "";
                  await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeoutMs: 15000 });
                  console.log(`  [post-llm] navigated to Shopify /checkout`);
                } catch {
                  // Fall through to post-ATC validation
                }
              }

              // Validate post-ATC destination
              const postAtc = await validatePostAtcDestination(
                page, detectPageType, scriptedDismissInterstitial,
              );
              console.log(`  [post-llm post-atc] destination=${postAtc.pageType} advanced=${postAtc.advanced}`);

              if (postAtc.pageType === "cart-drawer") {
                const wentToCheckout =
                  await scriptedClickButton(page, "checkout") ||
                  await scriptedClickButton(page, "proceed to checkout") ||
                  await scriptedClickButton(page, "go to checkout");
                if (wentToCheckout) console.log(`  [post-llm] clicked checkout in cart drawer`);
              }
            }
          }
        }

        // Check for navigation / confirmation / error after LLM action
        // Wait longer when item is in cart (Shopify checkout redirects can take 5+ seconds)
        const postLlmWait = state.addedToCart ? 5000 : 2000;
        await page.waitForTimeout(postLlmWait);
        const postLlmType = await detectPageType(page);
        if (postLlmType === "confirmation") {
          const data = await extractConfirmationData(page);
          state.confirmationData = data;
          state.currentStep = "verify-confirmation";

          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: true,
            orderNumber: data.orderNumber,
            finalTotal: data.total,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            durationMs: Date.now() - startMs,
          };
        }
        if (postLlmType === "error") {
          const errorData = await extractErrorMessage(page);
          console.log(`  [post-llm error] type=${errorData.type} message=${errorData.message.slice(0, 100)}`);

          try {
            const newCache = await extractDomainCache(page, domain);
            saveDomainCache(newCache);
          } catch { /* best-effort */ }

          return {
            success: false,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            failedStep: CHECKOUT_STEPS.CHECKOUT_ERROR as CheckoutStep,
            errorMessage: `${errorData.type}: ${errorData.message}`,
            durationMs: Date.now() - startMs,
          };
        }

        // Reset stall counter after LLM attempt if page changed
        if (page.url() !== currentUrl) {
          state.stallCount = 0;
        }
      } else if (needsLlm && state.llmCalls >= MAX_LLM_CALLS) {
        console.log(`  [budget exhausted] ${state.llmCalls}/${MAX_LLM_CALLS} LLM calls used`);
        break;
      }
      } catch (iterError) {
        const msg = iterError instanceof Error ? iterError.message : String(iterError);
        console.log(`  [iter-error] Iteration ${pageIdx} error (non-fatal): ${msg}`);

        // Check if page is still alive
        try {
          await page.evaluate(() => document.title);
        } catch {
          // Page is dead — fail the checkout
          return {
            success: false,
            sessionId: session.id,
            replayUrl: session.replayUrl,
            failedStep: "page-loop" as CheckoutStep,
            errorMessage: "session_timeout: Browser session lost",
            durationMs: Date.now() - startMs,
          };
        }

        // Page is alive — increment stall count and retry next iteration
        state.stallCount++;
        await page.waitForTimeout(1000);
        continue;
      }
    }

    // 10. Post-loop: check for confirmation via page text
    let confirmedViaPageText = false;
    let finalTotal: string | undefined;
    try {
      const bodyText = await page.evaluate(() => document.body.textContent || "");
      const confirmation = verifyConfirmationPage(bodyText);
      confirmedViaPageText = confirmation.isConfirmed;
      if (!finalTotal) {
        finalTotal = await extractVisibleTotal(page);
      }
    } catch {
      // Ignore page read errors
    }

    // 11. Price verification
    if (finalTotal && order.payment.price) {
      if (!isPriceAcceptable(order.payment.price, finalTotal)) {
        return {
          success: false,
          finalTotal,
          sessionId: session.id,
          replayUrl: session.replayUrl,
          failedStep: CHECKOUT_STEPS.VERIFY_PRICE as CheckoutStep,
          errorMessage: `Price mismatch: expected ~$${order.payment.price}, found $${finalTotal}`,
          durationMs: Date.now() - startMs,
        };
      }
    }

    // 12. Save domain cache
    try {
      const newCache = await extractDomainCache(page, domain);
      saveDomainCache(newCache);
    } catch {
      // Cache save is best-effort
    }

    // 13. Final result
    if (input.dryRun) {
      // Dry-run success requires reaching at least card fill stage
      // (or confirmation page). If we stalled on login-gate/cart/product,
      // the checkout didn't actually complete.
      const dryRunSuccess = state.cardFilled || confirmedViaPageText;
      return {
        success: dryRunSuccess,
        finalTotal: finalTotal ?? state.confirmationData?.total,
        sessionId: session.id,
        replayUrl: session.replayUrl,
        failedStep: dryRunSuccess ? undefined : state.currentStep,
        errorMessage: dryRunSuccess
          ? undefined
          : `Checkout did not reach payment stage (stopped at ${state.currentStep}, ${state.llmCalls}/${MAX_LLM_CALLS} LLM calls used)`,
        durationMs: Date.now() - startMs,
      };
    }

    return {
      success: confirmedViaPageText,
      orderNumber: state.confirmationData?.orderNumber,
      finalTotal: finalTotal ?? state.confirmationData?.total,
      sessionId: session.id,
      replayUrl: session.replayUrl,
      failedStep: confirmedViaPageText ? undefined : state.currentStep,
      errorMessage: confirmedViaPageText
        ? undefined
        : `Checkout did not reach confirmation page (stopped at ${state.currentStep}, ${state.llmCalls}/${MAX_LLM_CALLS} LLM calls used)`,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    return {
      success: false,
      sessionId: session.id,
      replayUrl: session.replayUrl,
      failedStep: "navigate" as CheckoutStep,
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  } finally {
    // Destroy session
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        // Ignore close errors
      }
    }
    await destroySession(session.id);
  }
}
