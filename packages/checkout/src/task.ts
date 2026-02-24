import { Stagehand } from "@browserbasehq/stagehand";
import type { Order, ShippingInfo } from "@proxo/core";
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
} from "./cache.js";
import { createSession, destroySession, getAnthropicApiKey } from "./session.js";
import type { SessionOptions } from "./session.js";
import { fillAllCardFields } from "./fill.js";
import type { ObservedField } from "./fill.js";

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
  VERIFY_PRICE: "verify-price",
  PLACE_ORDER: "place-order",
  VERIFY_CONFIRMATION: "verify-confirmation",
} as const;

export type CheckoutStep = (typeof CHECKOUT_STEPS)[keyof typeof CHECKOUT_STEPS];

// ---- Types ----

export interface CheckoutResult {
  success: boolean;
  orderNumber?: string;
  finalTotal?: string;
  sessionId: string;
  replayUrl: string;
  failedStep?: CheckoutStep;
  errorMessage?: string;
  durationMs?: number;
}

export interface CheckoutInput {
  order: Order;
  shipping: ShippingInfo;
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

// ---- Retry wrapper for Stagehand schema bugs ----

const MAX_ACT_RETRIES = 2;

async function actWithRetry(
  stagehand: InstanceType<typeof Stagehand>,
  instruction: string,
  options?: { variables?: Record<string, string> },
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_ACT_RETRIES; attempt++) {
    try {
      await stagehand.act(instruction, options);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isSchemaError =
        msg.includes("AI_NoObjectGeneratedError") ||
        msg.includes("Invalid response schema") ||
        msg.includes("did not match the expected schema");
      if (isSchemaError && attempt < MAX_ACT_RETRIES) {
        // Stagehand schema bug — retry
        continue;
      }
      throw err;
    }
  }
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

  // 2. Validate keys early (fail fast with clear error)
  const anthropicApiKey = getAnthropicApiKey();

  // 3. Create Browserbase session
  const session = await createSession(input.sessionOptions);
  let stagehand: InstanceType<typeof Stagehand> | undefined;
  const startMs = Date.now();

  try {
    // 4. Init Stagehand (Claude Sonnet 4) on session
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      model: {
        modelName: "anthropic/claude-sonnet-4-20250514",
        apiKey: anthropicApiKey,
      },
      browserbaseSessionID: session.id,
    });

    await stagehand.init();
    const page = stagehand.context.activePage()!;

    // 4. Inject domain cache if available
    const existingCache = loadDomainCache(domain);
    if (existingCache) {
      await injectDomainCache(page, existingCache);
    }

    {
      let currentStep: CheckoutStep = CHECKOUT_STEPS.NAVIGATE;

      try {
        // 6a. Navigate to product
        currentStep = CHECKOUT_STEPS.NAVIGATE;
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeoutMs: 30000,
        });
        await page.waitForTimeout(2000);

        // 6b. Dismiss any initial overlays before interacting
        currentStep = CHECKOUT_STEPS.DISMISS_POPUPS;
        try {
          await actWithRetry(
            stagehand,
            "Dismiss any popups, cookie banners, modals, newsletter signups, or overlays that are blocking the page",
          );
        } catch {
          // Nothing to dismiss
        }

        // 6c. Add to cart — two explicit steps to avoid Stagehand treating variant selection as add-to-cart
        currentStep = CHECKOUT_STEPS.ADD_TO_CART;

        // Step 1: Select variant/size if needed
        try {
          await actWithRetry(
            stagehand,
            "If this product requires selecting a size, color, variant, or quantity option before adding to cart, " +
            "select the first available in-stock option now. " +
            "If the current selection shows 'Sold Out' or 'Unavailable', choose a different option. " +
            "If no selection is needed or options are already selected, do nothing.",
          );
          await page.waitForTimeout(1000);
        } catch {
          // No variant selection needed
        }

        // Step 2: Explicitly click the Add to Cart button
        await actWithRetry(
          stagehand,
          "Click the 'Add to Cart', 'Add to Bag', or 'Add to Basket' button on this page. " +
          "This is a button that adds the product to the shopping cart. " +
          "Do NOT click variant/size selectors, quantity controls, or any other button. " +
          "The button usually says exactly 'Add to Cart' or 'Add to Bag'.",
        );
        // Wait for cart state to persist (some sites need time to update cookies/state)
        await page.waitForTimeout(3000);

        // 6d. Proceed to checkout
        currentStep = CHECKOUT_STEPS.PROCEED_TO_CHECKOUT;

        // First try: look for a checkout/cart link in any popup, drawer, or notification
        // that appeared after adding to cart (e.g., "View cart & check out", "Checkout")
        try {
          await actWithRetry(
            stagehand,
            "Look for a 'Checkout', 'View cart & check out', 'Proceed to Checkout', or 'Go to Cart' link " +
            "in any popup, drawer, notification, or modal that appeared after adding the item. " +
            "Click it to proceed toward checkout. " +
            "Do NOT click 'Continue Shopping' or dismiss the notification.",
          );
        } catch {
          // No popup/drawer — fall back to clicking the cart icon
          await actWithRetry(
            stagehand,
            "Click the cart icon or 'Cart' link in the page header to go to the cart page.",
          );
        }
        await page.waitForTimeout(3000);

        // If we're on the cart page, click the checkout button
        const currentUrl = page.url();
        if (currentUrl.includes("/cart")) {
          await actWithRetry(
            stagehand,
            "Find and click the main 'Check Out', 'Checkout', or 'Proceed to Checkout' button on this page. " +
            "It is usually a large, prominent button (often red, green, or blue) near the order summary or cart total. " +
            "Do NOT click invisible elements, hidden alerts, account buttons, or newsletter signups. " +
            "Do NOT click 'Log In', 'Sign In', or 'Create Account'. " +
            "If a guest checkout option appears, select it.",
          );
          await page.waitForTimeout(2000);
        }

        // 6e. Handle any remaining login walls or popups after navigation
        try {
          await actWithRetry(
            stagehand,
            "If there is a login wall, account creation prompt, or sign-in page, " +
            "find and click any Guest Checkout, Continue as Guest, or Skip Login option. " +
            "Also dismiss any new popups, modals, or overlays.",
          );
        } catch {
          // Already past login / no popups
        }

        // 6f. Fill shipping via Stagehand variables (field-by-field to avoid schema issues)
        currentStep = CHECKOUT_STEPS.FILL_SHIPPING;

        // Email / contact — must be the checkout/shipping form email, NOT newsletter
        await actWithRetry(
          stagehand,
          "Fill the email or contact email field in the checkout or shipping form with %x_shipping_email%. " +
          "Do NOT fill any newsletter signup, footer, or promotional email fields.",
          { variables: stagehandVars },
        );

        // Name fields — some sites split first/last, some have a single field
        await actWithRetry(
          stagehand,
          "Fill the name, first name, or full name field with %x_shipping_name%",
          { variables: stagehandVars },
        );

        // Street address
        await actWithRetry(
          stagehand,
          "Fill the street address or address line 1 field with %x_shipping_street%. If an address autocomplete dropdown appears, dismiss it or press Escape.",
          { variables: stagehandVars },
        );

        // City
        await actWithRetry(
          stagehand,
          "Fill the city field with %x_shipping_city%",
          { variables: stagehandVars },
        );

        // State — may be dropdown or text input
        await actWithRetry(
          stagehand,
          "Fill or select %x_shipping_state% in the state, province, or region field",
          { variables: stagehandVars },
        );

        // ZIP / postal code
        await actWithRetry(
          stagehand,
          "Fill the ZIP code or postal code field with %x_shipping_zip%",
          { variables: stagehandVars },
        );

        // Country — often pre-filled, skip errors
        try {
          await actWithRetry(
            stagehand,
            "Select or fill %x_shipping_country% in the country field if it is not already set",
            { variables: stagehandVars },
          );
        } catch {
          // Country may be pre-selected
        }

        // Phone — optional on many sites
        try {
          await actWithRetry(
            stagehand,
            "Fill the phone number field with %x_shipping_phone%",
            { variables: stagehandVars },
          );
        } catch {
          // Phone may not be required
        }

        await page.waitForTimeout(1000);

        // 6g. Select cheapest shipping + continue
        currentStep = CHECKOUT_STEPS.SELECT_SHIPPING;
        try {
          await actWithRetry(
            stagehand,
            "Select the cheapest shipping option if multiple are available, then continue to payment",
          );
          await page.waitForTimeout(1000);
        } catch {
          // Shipping selection may not be applicable
        }

        // 6h. Avoid express pay
        currentStep = CHECKOUT_STEPS.AVOID_EXPRESS_PAY;
        try {
          await actWithRetry(
            stagehand,
            "If asked about express payment (Shop Pay, Google Pay, Apple Pay, PayPal), decline and use regular credit card payment instead",
          );
        } catch {
          // No express pay prompt
        }

        // 6i. Observe card fields via Stagehand
        currentStep = CHECKOUT_STEPS.OBSERVE_CARD_FIELDS;
        const observeResult = await stagehand.observe(
          "Find all credit card input fields on this page: card number, expiration date, CVV/security code, and cardholder name.",
        );

        // Map Stagehand observations to ObservedField format
        const observedFields: ObservedField[] = observeResult.map((obs) => ({
          selector: obs.selector,
          description: obs.description,
        }));

        // 6j. Fill card fields via direct DOM fill (NEVER through Stagehand LLM)
        currentStep = CHECKOUT_STEPS.FILL_CARD;
        await fillAllCardFields(page, observedFields, cdpCreds);
        await page.waitForTimeout(500);

        // 6k. Fill billing address if separate from shipping
        currentStep = CHECKOUT_STEPS.FILL_BILLING;
        try {
          await actWithRetry(
            stagehand,
            "If there is a separate billing address form, fill it: street=%x_billing_street%, city=%x_billing_city%, state=%x_billing_state%, zip=%x_billing_zip%, country=%x_billing_country%. If billing is same as shipping, check that box instead.",
            { variables: stagehandVars },
          );
        } catch {
          // No separate billing
        }

        // 6l. Verify price before submitting
        currentStep = CHECKOUT_STEPS.VERIFY_PRICE;
        try {
          const bodyText = await page.evaluate(
            () => document.body.textContent || "",
          );
          const totalMatch = /\$?([\d,]+\.?\d*)/.exec(bodyText);
          if (totalMatch && totalMatch[1]) {
            if (!isPriceAcceptable(order.payment.price, totalMatch[1])) {
              throw new Error(
                `Price mismatch: expected ~$${order.payment.price}, found $${totalMatch[1]}`,
              );
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("Price mismatch")) {
            throw e;
          }
          // Ignore other verification errors
        }

        let orderNumber: string | undefined;
        let finalTotal: string | undefined;

        if (!input.dryRun) {
          // 6l. Click Place Order
          currentStep = CHECKOUT_STEPS.PLACE_ORDER;
          await actWithRetry(
            stagehand,
            "Click the Place Order, Complete Purchase, or Submit Order button to finalize the purchase",
          );
          await page.waitForTimeout(5000);

          // 6m. Verify confirmation page
          currentStep = CHECKOUT_STEPS.VERIFY_CONFIRMATION;
          const bodyText = await page.evaluate(
            () => document.body.textContent || "",
          );
          const confirmation = verifyConfirmationPage(bodyText);

          if (confirmation.isConfirmed) {
            // Extract order number
            const orderMatch =
              /(?:order|confirmation)\s*(?:#|number|:)\s*([A-Z0-9-]+)/i.exec(
                bodyText,
              );
            if (orderMatch) {
              orderNumber = orderMatch[1];
            }
          }

          // Extract final total
          const totalMatch =
            /(?:total|amount)\s*:?\s*\$?([\d,]+\.\d{2})/i.exec(bodyText);
          if (totalMatch) {
            finalTotal = totalMatch[1];
          }
        } else {
          // Dry run: extract diagnostics without placing order
          const bodyText = await page.evaluate(
            () => document.body.textContent || "",
          );
          const totalMatch =
            /(?:total|amount)\s*:?\s*\$?([\d,]+\.\d{2})/i.exec(bodyText);
          if (totalMatch) {
            finalTotal = totalMatch[1];
          }
        }

        // 7. Save domain cache
        try {
          const newCache = await extractDomainCache(page, domain);
          saveDomainCache(newCache);
        } catch {
          // Cache save is best-effort
        }

        return {
          success: input.dryRun ? true : !!orderNumber,
          orderNumber,
          finalTotal,
          sessionId: session.id,
          replayUrl: session.replayUrl,
          durationMs: Date.now() - startMs,
        };
      } catch (err) {
        return {
          success: false,
          sessionId: session.id,
          replayUrl: session.replayUrl,
          failedStep: currentStep,
          errorMessage: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startMs,
        };
      }
    }
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
