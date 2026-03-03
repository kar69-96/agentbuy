import { Stagehand } from "@browserbasehq/stagehand";
import type { Page } from "@browserbasehq/stagehand";
import type { Order, ShippingInfo } from "@bloon/core";
import { z } from "zod";
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
import { createCheckoutTools } from "./agent-tools.js";
import { StepTracker } from "./step-tracker.js";

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

// ---- Structured output schema for agent ----

const CheckoutOutputSchema = z.object({
  orderNumber: z
    .string()
    .optional()
    .describe("The order or confirmation number, if visible"),
  finalTotal: z
    .string()
    .optional()
    .describe("The final order total amount (digits and decimals only, no currency symbol)"),
  confirmationDetected: z
    .boolean()
    .describe("True if a confirmation/thank-you page was reached"),
});

// ---- System prompt for the checkout agent ----

function buildAgentSystemPrompt(dryRun: boolean, selections?: Record<string, string>): string {
  const dryRunInstruction = dryRun
    ? `
IMPORTANT — DRY RUN MODE:
- DO NOT click "Place Order", "Complete Purchase", "Submit Order", or any button that finalizes the purchase.
- Stop AFTER filling payment fields and verifying the order total is visible.
- Report the order total in your output.`
    : `
LIVE PURCHASE MODE:
- After filling payment, click "Place Order", "Complete Purchase", or "Submit Order" to finalize.
- Wait for the confirmation page to load.
- Extract the order/confirmation number and final total from the confirmation page.`;

  return `You are an autonomous checkout agent. Your job is to complete an online purchase on a website.

CRITICAL RULES — YOU MUST FOLLOW THESE EXACTLY:

FORM FILLING — MANDATORY TOOL USAGE:
- When you reach the shipping/contact form, call the "fillShippingInfo" tool ONCE. It fills ALL fields (email, name, address, city, state, zip, country, phone) in one call. Do NOT use the act tool to fill individual form fields — use fillShippingInfo instead.
- When you reach the payment step with card fields visible, call the "fillCardFields" tool ONCE. It fills card number, expiry, CVV, and cardholder name securely. You do NOT have card data — only the tool does. NEVER type card data with act.
- If a separate billing address form appears, call "fillBillingAddress" once.

NAVIGATION RULES:
- Dismiss any popups, cookie banners, modals, newsletter signups, or overlays.
- Choose Guest Checkout if asked to log in or create an account.
- ${selections && Object.keys(selections).length > 0 ? `Select these specific product options: ${Object.entries(selections).map(([k, v]) => `${k}: ${v}`).join(', ')}.` : 'Select the first available in-stock variant/size if selection is required.'}
- ALWAYS uncheck any "billing address same as shipping" or "use shipping address for billing" checkbox. The billing address is DIFFERENT from shipping and will be filled separately via the fillBillingAddress tool. If billing address fields are hidden behind this checkbox, uncheck it to reveal them, then call fillBillingAddress.
- Click "Add to Cart" / "Add to Bag" to add the product.
- Proceed to checkout via cart popup, cart icon, or cart page.
- After calling fillShippingInfo, select the cheapest shipping option and continue to payment.
- Decline express payment options (Shop Pay, Google Pay, Apple Pay, PayPal) — use regular credit card.
- If an address autocomplete dropdown appears, dismiss it or press Escape.
${dryRunInstruction}

SEQUENCE:
Dismiss popups → Select variant → Add to cart → Proceed to checkout → Guest checkout → call fillShippingInfo → Select shipping → Decline express pay → call fillCardFields → call fillBillingAddress (if needed) → ${dryRun ? "STOP (report total)" : "Place order → Verify confirmation"}

SPEED RULES — CRITICAL:
- NEVER call screenshot() unless you have failed 2 consecutive actions and need visual debugging.
- After calling fillShippingInfo or fillCardFields, do NOT screenshot to verify — the tool output confirms success.
- Use clickButton for ALL simple clicks (Add to Cart, Continue, Checkout, Close popup). Only use act() for complex interactions like selecting from dropdowns or typing text.
- Do not take a screenshot after each action — proceed directly to the next step.
- Use the custom tools for ALL form filling.`;
}

// ---- Form-filling detection for prepareStep ----

const SHIPPING_FIELD_RE =
  /\b(email|name|first\s*name|last\s*name|address|street|city|state|province|zip|postal|phone|country)\b/i;
const CARD_FIELD_RE =
  /\b(card\s*number|credit\s*card|expir|cvv|cvc|security\s*code|cardholder)\b/i;
const FORM_ACTION_RE = /\b(fill|type|enter|input|set)\b/i;

function isShippingFormAction(action: string): boolean {
  return FORM_ACTION_RE.test(action) && SHIPPING_FIELD_RE.test(action);
}

function isCardFormAction(action: string): boolean {
  return FORM_ACTION_RE.test(action) && CARD_FIELD_RE.test(action);
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
  const modelApiKey = getModelApiKey();

  // 3. Create Browserbase session
  const session = await createSession(input.sessionOptions);
  let stagehand: InstanceType<typeof Stagehand> | undefined;
  const startMs = Date.now();

  try {
    // 4. Init Stagehand with experimental flag for agent API features
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      model: {
        modelName: "anthropic/claude-haiku-4-5-20251001",
        apiKey: modelApiKey,
      },
      browserbaseSessionID: session.id,
      experimental: true,
    });

    await stagehand.init();
    const page: Page = stagehand.context.activePage()!;

    // 5. Inject domain cache cookies (before navigation)
    const existingCache = loadDomainCache(domain);
    if (existingCache) {
      await injectDomainCache(page, existingCache);
    }

    // 6. Navigate to product URL (manual — faster than agent)
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeoutMs: 30000,
    });
    await page.waitForTimeout(3000);

    // 6b. Inject localStorage (must happen after navigating to target domain)
    if (existingCache) {
      try {
        await injectLocalStorage(page, existingCache);
      } catch {
        // localStorage injection is best-effort
      }
    }

    // 6c. DOM pruning — strip non-functional elements to reduce token count
    // NOTE: Do NOT remove <script>, <style>, or <link> — they are needed for page rendering and interactivity
    await page.evaluate(() => {
      document.querySelectorAll('noscript')
        .forEach(e => e.remove());
      document.querySelectorAll('[aria-hidden="true"]')
        .forEach(e => e.remove());
      document.querySelectorAll('img')
        .forEach(img => { img.removeAttribute('srcset'); });
    });

    // 6d. Scripted popup dismissal — eliminate cookie banners and modals before agent runs
    await page.evaluate(() => {
      // Remove cookie/consent banners
      document.querySelectorAll('[class*="cookie" i], [id*="cookie" i], [class*="consent" i]')
        .forEach(e => e.remove());
      // Click close buttons inside modals/dialogs
      document.querySelectorAll('[role="dialog"] [aria-label*="close" i], [role="dialog"] [aria-label*="dismiss" i]')
        .forEach(btn => (btn as HTMLElement).click());
      // Remove fixed-position overlays
      document.querySelectorAll('.overlay, .backdrop, [class*="overlay" i]')
        .forEach(e => { if (getComputedStyle(e).position === 'fixed') e.remove(); });
    });

    // 7. Create custom tools
    const customTools = createCheckoutTools(stagehand, page, stagehandVars, cdpCreds);

    // 8. Create step tracker + form state for prepareStep
    const tracker = new StepTracker();
    tracker.setStep("navigate");

    const formState = {
      shippingFilled: false,
      cardFilled: false,
      billingFilled: false,
      stepsOnCheckout: 0,
      stepWhenShippingFilled: -1,
      totalSteps: 0,
    };

    // 9. Create agent with custom tools
    const agent = stagehand.agent({
      mode: "dom",
      systemPrompt: buildAgentSystemPrompt(!!input.dryRun, input.selections),
      tools: customTools,
    });

    // 10. Execute agent
    const selectionInstruction = input.selections && Object.keys(input.selections).length > 0
      ? `First select these product options: ${Object.entries(input.selections).map(([k, v]) => `${k}: ${v}`).join(', ')}. `
      : '';

    const instruction = input.dryRun
      ? `${selectionInstruction}Complete the checkout flow for the product on this page (${url}). ` +
        `Fill all shipping and payment fields, but DO NOT place the order. ` +
        `Report the final order total.`
      : `${selectionInstruction}Complete the checkout flow for the product on this page (${url}). ` +
        `Fill all shipping and payment fields, then place the order. ` +
        `Extract the order number and final total from the confirmation page.`;

    const result = await agent.execute({
      instruction,
      maxSteps: 40,
      excludeTools: ["fillForm", "ariaTree"],
      output: CheckoutOutputSchema,
      callbacks: {
        onStepFinish: (stepResult) => {
          formState.totalSteps++;
          const toolCalls = stepResult.toolCalls.map((tc) => ({
            toolName: tc.toolName as string,
            input: "input" in tc ? tc.input : undefined,
          }));

          // Track custom tool usage
          for (const tc of toolCalls) {
            if (tc.toolName === "fillShippingInfo") {
              formState.shippingFilled = true;
              formState.stepWhenShippingFilled = formState.totalSteps;
            }
            if (tc.toolName === "fillCardFields") formState.cardFilled = true;
            if (tc.toolName === "fillBillingAddress") formState.billingFilled = true;
          }

          // Track checkout page visits
          const currentUrl = page.url();
          if (/\/checkout|\/checkouts\//i.test(currentUrl)) {
            formState.stepsOnCheckout++;
          }

          tracker.update(toolCalls, currentUrl);
        },
        // Force custom tools when agent reaches checkout forms
        prepareStep: (() => {
          // Proactive: force fillShippingInfo after agent has seen checkout page
          if (formState.stepsOnCheckout >= 1 && !formState.shippingFilled) {
            return {
              toolChoice: { type: "tool" as const, toolName: "fillShippingInfo" },
            };
          }

          // Force fillCardFields a few steps after shipping is done
          if (
            formState.shippingFilled &&
            !formState.cardFilled &&
            formState.totalSteps >= formState.stepWhenShippingFilled + 3
          ) {
            return {
              toolChoice: { type: "tool" as const, toolName: "fillCardFields" },
            };
          }

          // After both forms filled, guide agent to finish
          if (formState.shippingFilled && formState.cardFilled) {
            const hint = input.dryRun
              ? "Both shipping and payment fields are ALREADY filled. " +
                "Find the order total on the page and report it. Use the done tool to finish."
              : "Both shipping and payment fields are ALREADY filled. " +
                "Click Place Order / Complete Purchase to finalize.";
            return { system: buildAgentSystemPrompt(!!input.dryRun, input.selections) + "\n\n" + hint };
          }

          return undefined;
        }) as never,
      },
    });

    // 11. Post-execution price verification (defense in depth)
    const agentOutput = result.output as
      | { orderNumber?: string; finalTotal?: string; confirmationDetected?: boolean }
      | undefined;

    const finalTotal = agentOutput?.finalTotal;
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

    // 13. Map AgentResult → CheckoutResult (backward compat)
    if (input.dryRun) {
      return {
        success: result.success,
        finalTotal: agentOutput?.finalTotal,
        sessionId: session.id,
        replayUrl: session.replayUrl,
        durationMs: Date.now() - startMs,
      };
    }

    // Live purchase: verify confirmation
    const orderNumber = agentOutput?.orderNumber;
    const confirmationDetected = agentOutput?.confirmationDetected ?? false;

    // Fallback: check page text for confirmation signals
    let confirmedViaPageText = false;
    if (!confirmationDetected) {
      try {
        const bodyText = await page.evaluate(
          () => document.body.textContent || "",
        );
        const confirmation = verifyConfirmationPage(bodyText);
        confirmedViaPageText = confirmation.isConfirmed;
      } catch {
        // Ignore page read errors
      }
    }

    const isConfirmed = confirmationDetected || confirmedViaPageText;

    return {
      success: isConfirmed,
      orderNumber,
      finalTotal: agentOutput?.finalTotal,
      sessionId: session.id,
      replayUrl: session.replayUrl,
      failedStep: isConfirmed
        ? undefined
        : (tracker.currentStep as CheckoutStep),
      errorMessage: isConfirmed
        ? undefined
        : result.message || "Checkout did not reach confirmation page",
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
