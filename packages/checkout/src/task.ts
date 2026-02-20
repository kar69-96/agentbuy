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
import { fillAllCardFields } from "./fill.js";
import type { ObservedField } from "./fill.js";

// ---- Types ----

export interface CheckoutResult {
  success: boolean;
  orderNumber?: string;
  finalTotal?: string;
  sessionId: string;
  replayUrl: string;
}

export interface CheckoutInput {
  order: Order;
  shipping: ShippingInfo;
}

// ---- Hard timeout ----

const CHECKOUT_TIMEOUT_MS = 5 * 60 * 1000;

// ---- Price tolerance ----

function isPriceAcceptable(expected: string, actual: string): boolean {
  const exp = parseFloat(expected);
  const act = parseFloat(actual);
  if (isNaN(exp) || isNaN(act)) return true; // can't verify, proceed
  const diff = Math.abs(act - exp);
  return diff <= 1 || diff / exp <= 0.05;
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
  const session = await createSession();
  let stagehand: InstanceType<typeof Stagehand> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

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

    // 5. Set hard timeout (timer cleared in finally to prevent unhandled rejection)
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Checkout timeout: 5 minutes exceeded")),
        CHECKOUT_TIMEOUT_MS,
      );
    });

    const checkoutPromise = (async (): Promise<CheckoutResult> => {
      // 6a. Navigate to product
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeoutMs: 30000,
      });
      await page.waitForTimeout(2000);

      // 6b. Add to cart
      await stagehand.act("Add this product to cart");
      await page.waitForTimeout(1000);

      // 6c. Proceed to checkout
      await stagehand.act("Go to checkout or proceed to checkout");
      await page.waitForTimeout(2000);

      // 6d. Dismiss popups, cookie banners, login walls
      try {
        await stagehand.act(
          "Dismiss any popups, cookie banners, or login prompts. Click continue as guest if asked.",
        );
      } catch {
        // No popups to dismiss
      }

      // 6e. Fill shipping via Stagehand variables
      await stagehand.act(
        "Fill the shipping/contact form: name=%x_shipping_name%, street address=%x_shipping_street%, city=%x_shipping_city%, state=%x_shipping_state%, zip=%x_shipping_zip%, country=%x_shipping_country%, email=%x_shipping_email%, phone=%x_shipping_phone%",
        { variables: stagehandVars },
      );
      await page.waitForTimeout(1000);

      // 6f. Select cheapest shipping + continue
      try {
        await stagehand.act(
          "Select the cheapest shipping option if multiple are available, then continue to payment",
        );
        await page.waitForTimeout(1000);
      } catch {
        // Shipping selection may not be applicable
      }

      // 6g. Avoid express pay
      try {
        await stagehand.act(
          "If asked about express payment (Shop Pay, Google Pay, Apple Pay, PayPal), decline and use regular credit card payment instead",
        );
      } catch {
        // No express pay prompt
      }

      // 6h. Observe card fields via Stagehand
      const observeResult = await stagehand.observe(
        "Find all credit card input fields on this page: card number, expiration date, CVV/security code, and cardholder name.",
      );

      // Map Stagehand observations to ObservedField format
      const observedFields: ObservedField[] = observeResult.map((obs) => ({
        selector: obs.selector,
        description: obs.description,
      }));

      // 6i. Fill card fields via direct DOM fill (NEVER through Stagehand LLM)
      await fillAllCardFields(page, observedFields, cdpCreds);
      await page.waitForTimeout(500);

      // 6j. Fill billing address if separate from shipping
      try {
        await stagehand.act(
          "If there is a separate billing address form, fill it: street=%x_billing_street%, city=%x_billing_city%, state=%x_billing_state%, zip=%x_billing_zip%, country=%x_billing_country%. If billing is same as shipping, check that box instead.",
          { variables: stagehandVars },
        );
      } catch {
        // No separate billing
      }

      // 6k. Verify price before submitting
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

      // 6l. Click Place Order
      await stagehand.act(
        "Click the Place Order, Complete Purchase, or Submit Order button to finalize the purchase",
      );
      await page.waitForTimeout(5000);

      // 6m. Verify confirmation page
      const bodyText = await page.evaluate(
        () => document.body.textContent || "",
      );
      const confirmation = verifyConfirmationPage(bodyText);

      let orderNumber: string | undefined;
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
      let finalTotal: string | undefined;
      const totalMatch =
        /(?:total|amount)\s*:?\s*\$?([\d,]+\.\d{2})/i.exec(bodyText);
      if (totalMatch) {
        finalTotal = totalMatch[1];
      }

      // 7. Save domain cache
      try {
        const newCache = await extractDomainCache(page, domain);
        saveDomainCache(newCache);
      } catch {
        // Cache save is best-effort
      }

      return {
        success: confirmation.isConfirmed,
        orderNumber,
        finalTotal,
        sessionId: session.id,
        replayUrl: session.replayUrl,
      };
    })();

    // Race checkout against timeout
    return await Promise.race([checkoutPromise, timeoutPromise]);
  } finally {
    // 8. Clear timeout to prevent unhandled rejection after settlement
    if (timer) clearTimeout(timer);
    // 9. Destroy session in finally (belt-and-suspenders)
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
