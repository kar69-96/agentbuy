import { Stagehand } from "@browserbasehq/stagehand";
import type { Page } from "@browserbasehq/stagehand";
import type { Order, ShippingInfo } from "@proxo/core";
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
import { createSession, destroySession, getAnthropicApiKey } from "./session.js";
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

function buildAgentSystemPrompt(dryRun: boolean): string {
  const dryRunInstruction = dryRun
    ? `
IMPORTANT — DRY RUN MODE:
- DO NOT click any button that finalizes the purchase/donation ("Place Order", "Complete Purchase", "Submit Order", "Donate", etc.).
- Stop AFTER filling payment fields and verifying the total is visible.
- Report the total in your output.`
    : `
LIVE PURCHASE MODE:
- After filling payment, click the final submit button ("Place Order", "Complete Purchase", "Donate", etc.) to finalize.
- Wait for the confirmation/thank-you page to load.
- Extract the order/confirmation number and final total from the confirmation page.`;

  return `You are an autonomous checkout agent. Complete an online purchase or payment as fast as possible.

FORM FILLING — USE TOOLS ONLY:
- Contact/shipping/donor info → call "fillShippingInfo" ONCE. It fills email, name, address, city, state, ZIP, country, phone. Do NOT use act() for these fields.
- Payment card fields → call "fillCardFields" ONCE. It fills card securely. NEVER type card data with act().
- Separate billing address → call "fillBillingAddress" once.

NAVIGATION:
- Use "dismissPopups" to clear cookie banners, login prompts, sign-in suggestions, and overlays.
- CAPTCHA: If you see reCAPTCHA, hCaptcha, or Turnstile — do NOT click it. Wait 10 seconds, then proceed. Browserbase auto-solves these.
- Choose Guest Checkout if asked to log in or create an account.
- Decline express payment (Google Pay, Apple Pay, PayPal, etc.) — use regular credit card.
${dryRunInstruction}

APPROACH:
- Follow the page's natural payment flow step by step. This could be e-commerce, donation, subscription, or any payment type.
- If the page shows amount/quantity options, select the target amount.
- If there is an "Add to Cart" button, click it. If not (e.g. donation pages), follow whatever flow the page provides.
- When you see a payment method choice, select credit/debit card.
- When contact/address fields appear, call fillShippingInfo immediately.
- When card payment fields appear, call fillCardFields immediately.
- ${dryRun ? "STOP before the final submit button and report the total." : "Click the final submit button to complete the payment."}

SPEED — CRITICAL:
- NEVER call goto or navigate — the page is already loaded.
- NEVER call screenshot — it is disabled and will fail.
- Use clickButton for ALL simple clicks (Add to Cart, Continue, Checkout, Donate, Pay now, Close). Only use act() for dropdowns or text input.
- Act FAST. Do not over-extract or over-observe. Click, fill, proceed.
- After tool calls, proceed immediately to the next step.`;
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
  const anthropicApiKey = getAnthropicApiKey();

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
        modelName: "anthropic/claude-sonnet-4-20250514",
        apiKey: anthropicApiKey,
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
      const CAPTCHA_RE = /captcha|recaptcha|hcaptcha|turnstile/i;
      // Remove cookie/consent banners
      document.querySelectorAll('[class*="cookie" i], [id*="cookie" i], [class*="consent" i]')
        .forEach(e => e.remove());
      // Click close buttons inside modals/dialogs (skip CAPTCHA dialogs)
      document.querySelectorAll('[role="dialog"] [aria-label*="close" i], [role="dialog"] [aria-label*="dismiss" i]')
        .forEach(btn => {
          const dialog = btn.closest('[role="dialog"]');
          if (!CAPTCHA_RE.test(dialog?.textContent || '')) (btn as HTMLElement).click();
        });
      // Remove fixed-position overlays (skip CAPTCHA overlays)
      document.querySelectorAll('.overlay, .backdrop, [class*="overlay" i]')
        .forEach(e => {
          if (!CAPTCHA_RE.test(e.textContent || '') && getComputedStyle(e).position === 'fixed') e.remove();
        });
    });

    // 6e. Pre-select required radio groups that have no selection
    // Some forms have required radio groups (e.g. email opt-in) that block submission
    // if not selected. Auto-select the last option (usually "no" / opt-out / privacy-friendly).
    await page.evaluate(() => {
      const radioGroups = new Map<string, HTMLInputElement[]>();
      document.querySelectorAll('input[type="radio"]').forEach(r => {
        const name = r.getAttribute('name');
        if (!name) return;
        if (!radioGroups.has(name)) radioGroups.set(name, []);
        radioGroups.get(name)!.push(r as HTMLInputElement);
      });
      for (const [, radios] of radioGroups) {
        const anyChecked = radios.some(r => r.checked);
        if (!anyChecked && radios.length > 0) {
          // Select last option (typically opt-out / decline)
          const last = radios[radios.length - 1];
          last.checked = true;
          last.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });

    // 6f. Rewrite inline onclick handlers as addEventListener calls.
    // Some sites use onclick="handler(); return false;" — the 'return false' in an
    // attribute handler prevents default behavior AND stops propagation, which blocks
    // Playwright/Stagehand clicks from triggering navigation. Converting to addEventListener
    // makes 'return false' a no-op (only event.preventDefault() works in listeners).
    await page.evaluate(() => {
      document.querySelectorAll('[onclick]').forEach(el => {
        const handler = el.getAttribute('onclick');
        if (handler) {
          el.removeAttribute('onclick');
          el.addEventListener('click', function (this: HTMLElement) {
            new Function(handler).call(this);
          });
        }
      });
    });

    // 7. Create custom tools
    const customTools = createCheckoutTools(stagehand, page, stagehandVars, cdpCreds);

    // 8. Create step tracker + form state for prepareStep
    const tracker = new StepTracker();
    tracker.setStep("navigate");

    const initialUrl = page.url();
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
      systemPrompt: buildAgentSystemPrompt(!!input.dryRun),
      tools: customTools,
    });

    // 10. Execute agent
    const targetPrice = order.payment.price
      ? ` The target amount is $${order.payment.price}.`
      : "";
    const instruction = input.dryRun
      ? `The page is already loaded. Do NOT call goto or navigate.${targetPrice} ` +
        `Complete the payment flow: navigate through each step, fill contact/shipping info and payment details, but DO NOT finalize the purchase. ` +
        `Report the final total.`
      : `The page is already loaded. Do NOT call goto or navigate.${targetPrice} ` +
        `Complete the payment flow: navigate through each step, fill contact/shipping info and payment details, then finalize the purchase. ` +
        `Extract the order/confirmation number and final total from the confirmation page.`;

    const result = await agent.execute({
      instruction,
      maxSteps: 40,
      excludeTools: ["fillForm", "ariaTree", "screenshot"],
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

          // Track checkout/payment page visits
          const currentUrl = page.url();
          // Path-based detection (reliable for e-commerce: /checkout, /checkouts/, /payment)
          if (/\/checkout|\/checkouts\/|\/payment/i.test(currentUrl)) {
            formState.stepsOnCheckout++;
          }
          // Fallback for non-standard flows (donations, etc.): if the URL has changed
          // from the initial page and we're several steps in, the agent has navigated forward
          if (
            formState.stepsOnCheckout === 0 &&
            formState.totalSteps >= 5 &&
            !formState.shippingFilled &&
            currentUrl !== initialUrl
          ) {
            formState.stepsOnCheckout = 1;
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
              ? "Both contact/shipping and payment fields are ALREADY filled. " +
                "Find the total on the page and report it. Use the done tool to finish."
              : "Both contact/shipping and payment fields are ALREADY filled. " +
                "Click the final submit button (Place Order, Complete Purchase, Donate, etc.) to finalize.";
            return { system: buildAgentSystemPrompt(!!input.dryRun) + "\n\n" + hint };
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
