import { tool } from "@browserbasehq/stagehand";
import type { Stagehand, Page } from "@browserbasehq/stagehand";
import { z } from "zod";
import { fillAllCardFields } from "./fill.js";
import type { ObservedField } from "./fill.js";

// ---- Retry wrapper for Stagehand schema bugs ----

const MAX_ACT_RETRIES = 2;

export async function actWithRetry(
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
        continue;
      }
      throw err;
    }
  }
}

// ---- Iframe card field scanner ----

const CARD_FIELD_SELECTORS: Array<{ selector: string; credKey: string }> = [
  { selector: 'input[name*="cardnumber" i], input[name*="card-number" i], input[name*="encryptedCardNumber" i], input[autocomplete="cc-number"]', credKey: "x_card_number" },
  { selector: 'input[name*="exp" i], input[name*="encryptedExpiryDate" i], input[autocomplete="cc-exp"]', credKey: "x_card_expiry" },
  { selector: 'input[name*="cvc" i], input[name*="cvv" i], input[name*="encryptedSecurityCode" i], input[autocomplete="cc-csc"]', credKey: "x_card_cvv" },
  { selector: 'input[name*="holderName" i], input[name*="cardholder" i], input[autocomplete="cc-name"]', credKey: "x_cardholder_name" },
];

async function scanIframesForCardFields(
  page: Page,
  cdpCreds: Record<string, string>,
): Promise<{ filled: number }> {
  let filled = 0;

  // Find all iframes on the page and try filling card fields inside each
  const iframes = page.locator("iframe");
  const count = await iframes.count();

  for (let i = 0; i < count; i++) {
    const frameLocator = page.frameLocator(`iframe >> nth=${i}`);

    for (const { selector, credKey } of CARD_FIELD_SELECTORS) {
      const value = cdpCreds[credKey];
      if (!value) continue;

      try {
        const el = frameLocator.locator(selector).first();
        // Quick check — don't wait long
        await el.fill(value);
        filled++;
      } catch {
        // Field not found in this frame — continue
      }
    }

    if (filled > 0) break; // Found the payment frame
  }

  return { filled };
}

// ---- Custom checkout tools factory ----

export function createCheckoutTools(
  stagehand: InstanceType<typeof Stagehand>,
  page: Page,
  stagehandVars: Record<string, string>,
  cdpCreds: Record<string, string>,
) {
  const fillShippingInfo = tool({
    description:
      "Fill all shipping and contact fields in the checkout form. " +
      "This fills email, name, street address, city, state, ZIP, country, and phone. " +
      "Call this ONCE when you reach the shipping/contact form.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const nameParts = (stagehandVars.x_shipping_name ?? "").split(" ");
        const shippingData = {
          email: stagehandVars.x_shipping_email ?? "",
          firstName: nameParts[0] ?? "",
          lastName: nameParts.slice(1).join(" ") || "",
          street: stagehandVars.x_shipping_street ?? "",
          city: stagehandVars.x_shipping_city ?? "",
          state: stagehandVars.x_shipping_state ?? "",
          zip: stagehandVars.x_shipping_zip ?? "",
          country: stagehandVars.x_shipping_country ?? "",
          phone: stagehandVars.x_shipping_phone ?? "",
        };

        // Fill all fields via page.evaluate — instant, no LLM calls
        const filled = await page.evaluate((data) => {
          const results: string[] = [];

          function find(selectors: string[]): HTMLInputElement | HTMLSelectElement | null {
            for (const s of selectors) {
              const el = document.querySelector(s);
              if (el) return el as HTMLInputElement | HTMLSelectElement;
            }
            return null;
          }

          function fillInput(el: HTMLInputElement, value: string) {
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            )?.set;
            setter?.call(el, value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new Event("blur", { bubbles: true }));
          }

          function fillSelect(el: HTMLSelectElement, value: string) {
            for (const opt of el.options) {
              if (
                opt.value === value ||
                opt.text.trim() === value ||
                opt.value.toLowerCase().includes(value.toLowerCase()) ||
                opt.text.toLowerCase().includes(value.toLowerCase())
              ) {
                el.value = opt.value;
                el.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
              }
            }
            return false;
          }

          // Email
          const email = find([
            'input[autocomplete="email"]',
            'input[type="email"]',
            'input[name*="email" i]',
            'input[id*="email" i]',
          ]);
          if (email) {
            fillInput(email as HTMLInputElement, data.email);
            results.push("email");
          }

          // First name
          const fn = find([
            'input[autocomplete="given-name"]',
            'input[name*="firstName" i]',
            'input[name*="first_name" i]',
            'input[id*="firstName" i]',
          ]);
          if (fn) {
            fillInput(fn as HTMLInputElement, data.firstName);
            results.push("firstName");
          }

          // Last name
          const ln = find([
            'input[autocomplete="family-name"]',
            'input[name*="lastName" i]',
            'input[name*="last_name" i]',
            'input[id*="lastName" i]',
          ]);
          if (ln) {
            fillInput(ln as HTMLInputElement, data.lastName);
            results.push("lastName");
          }

          // Address
          const addr = find([
            'input[autocomplete="address-line1"]',
            'input[name*="address1" i]',
            'input[name*="street" i]',
            'input[id*="address1" i]',
          ]);
          if (addr) {
            fillInput(addr as HTMLInputElement, data.street);
            results.push("address");
          }

          // City
          const city = find([
            'input[autocomplete="address-level2"]',
            'input[name*="city" i]',
            'input[id*="city" i]',
          ]);
          if (city) {
            fillInput(city as HTMLInputElement, data.city);
            results.push("city");
          }

          // State (select dropdown)
          const state = find([
            'select[autocomplete="address-level1"]',
            'select[name*="zone" i]',
            'select[name*="state" i]',
            'select[name*="province" i]',
          ]);
          if (state) {
            if (fillSelect(state as HTMLSelectElement, data.state)) {
              results.push("state");
            }
          }

          // ZIP
          const zip = find([
            'input[autocomplete="postal-code"]',
            'input[name*="zip" i]',
            'input[name*="postal" i]',
            'input[id*="zip" i]',
          ]);
          if (zip) {
            fillInput(zip as HTMLInputElement, data.zip);
            results.push("zip");
          }

          // Phone
          const phone = find([
            'input[autocomplete="tel"]',
            'input[type="tel"]',
            'input[name*="phone" i]',
            'input[id*="phone" i]',
          ]);
          if (phone) {
            fillInput(phone as HTMLInputElement, data.phone);
            results.push("phone");
          }

          return results;
        }, shippingData);

        if (filled.length === 0) {
          return "No shipping/contact fields found on this page. Navigate to the form first.";
        }

        // Brief wait for any modals/popups triggered by form fill (e.g. login prompts, address autocomplete)
        await page.waitForTimeout(1500);
        await page.evaluate(() => {
          // Click close/dismiss buttons on any dialog that isn't a CAPTCHA
          document.querySelectorAll(
            '[role="dialog"] button[aria-label*="close" i], ' +
            '[role="dialog"] button[aria-label*="dismiss" i]'
          ).forEach(btn => {
            const dialog = btn.closest('[role="dialog"]');
            const text = dialog?.textContent?.toLowerCase() || '';
            const isCaptcha = /captcha|recaptcha|hcaptcha|turnstile/i.test(text);
            if (!isCaptcha) (btn as HTMLElement).click();
          });
          // Press Escape to dismiss any remaining modal/autocomplete
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });

        return `Successfully filled ${filled.length} shipping fields (${filled.join(", ")}).`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Failed to fill shipping fields: ${msg}`;
      }
    },
  });

  const fillCardFields = tool({
    description:
      "Fill credit card payment fields securely. " +
      "This finds card number, expiry, CVV, and cardholder name fields and fills them. " +
      "Call this ONCE when you are on the payment step and card fields are visible.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        // 1. Observe card fields via Stagehand (main page)
        const observeResult = await stagehand.observe(
          "Find all credit card input fields on this page: card number, expiration date, CVV/security code, and cardholder name.",
        );

        let observedFields: ObservedField[] = observeResult.map((obs) => ({
          selector: obs.selector,
          description: obs.description,
        }));

        // 2. Iframe fallback — scan payment iframes for card fields
        //    Handles Adyen, Stripe, Braintree, etc. that embed card inputs in cross-origin iframes
        if (observedFields.length === 0) {
          const iframeFields = await scanIframesForCardFields(page, cdpCreds);
          if (iframeFields.filled > 0) {
            return `Successfully filled ${iframeFields.filled} card fields via payment iframe.`;
          }
          return "No card fields found on this page. The payment form may not be visible yet.";
        }

        // 3. Fill via CDP (card data NEVER enters LLM context)
        await fillAllCardFields(page, observedFields, cdpCreds);

        return "Successfully filled all card payment fields.";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Failed to fill card fields: ${msg}`;
      }
    },
  });

  const fillBillingAddress = tool({
    description:
      "Fill separate billing address fields or check 'same as shipping' box. " +
      "Call this ONLY if there is a separate billing address form visible.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        await actWithRetry(
          stagehand,
          "If there is a separate billing address form, fill it: street=%x_billing_street%, city=%x_billing_city%, state=%x_billing_state%, zip=%x_billing_zip%, country=%x_billing_country%. If billing is same as shipping, check that box instead.",
          { variables: stagehandVars },
        );
        return "Successfully filled billing address fields.";
      } catch {
        return "No separate billing address form found, or same-as-shipping already set.";
      }
    },
  });

  const clickButton = tool({
    description:
      "Click a button, link, or interactive element by its visible label or purpose. " +
      "Use this for all simple clicks: Add to Cart, Continue, Checkout, Close, Pay, etc. " +
      "Much faster than act(). Only use act() for complex multi-step interactions.",
    inputSchema: z.object({
      target: z.string().describe("What to click, e.g. 'Add to Cart', 'Checkout', 'Continue', 'Pay now'"),
    }),
    execute: async ({ target }) => {
      try {
        // Fast path: find button by text content (instant, no LLM)
        const clicked = await page.evaluate((t) => {
          const lower = t.toLowerCase();
          const candidates = document.querySelectorAll(
            'button, a[role="button"], input[type="submit"], [role="button"], a.btn, a.button, ' +
            'label[role="button"], div[role="button"], span[role="button"]'
          );
          for (const el of candidates) {
            const text = (el.textContent || "").trim().toLowerCase();
            const value = (el as HTMLInputElement).value?.toLowerCase() || "";
            const label = el.getAttribute("aria-label")?.toLowerCase() || "";
            if (text.includes(lower) || value.includes(lower) || label.includes(lower)) {
              // Check for inline onclick handler (e.g. onclick="someFunction(); return false;")
              const onclick = el.getAttribute("onclick");
              if (onclick) {
                // Execute the inline handler directly — some sites use onclick with return false
                // which prevents normal click() from triggering the handler correctly
                try {
                  new Function(onclick).call(el);
                  return true;
                } catch {
                  // Inline handler failed, fall through to regular click
                }
              }
              (el as HTMLElement).click();
              return true;
            }
          }
          return false;
        }, target);

        if (clicked) {
          // Wait for potential page navigation or content load
          try {
            await page.waitForTimeout(3000);
          } catch {
            // Page may have navigated
          }
          return `Clicked "${target}".`;
        }

        // Slow path: use observe (LLM-based, handles complex selectors)
        const matches = await stagehand.observe(`Find the clickable element: ${target}`);
        if (matches.length === 0) return `Could not find "${target}" on the page.`;
        await page.locator(matches[0].selector).click();
        await page.waitForTimeout(1500);
        return `Clicked "${target}".`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Failed to click "${target}": ${msg}`;
      }
    },
  });

  const dismissPopups = tool({
    description:
      "Dismiss any visible popups, modals, or overlays on the page. " +
      "Clicks close/dismiss buttons and removes blocking overlays. " +
      "Does NOT dismiss CAPTCHAs (Browserbase auto-solves those). " +
      "Use this before interacting with the page if popups are blocking.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const dismissed = await page.evaluate(() => {
          const CAPTCHA_RE = /captcha|recaptcha|hcaptcha|turnstile/i;
          const actions: string[] = [];
          // Click close/dismiss buttons in dialogs
          document.querySelectorAll(
            '[role="dialog"] button[aria-label*="close" i], ' +
            '[role="dialog"] button[aria-label*="dismiss" i], ' +
            'button[aria-label*="close" i][class*="modal" i], ' +
            '.modal button.close, .modal .btn-close'
          ).forEach(btn => {
            const dialog = btn.closest('[role="dialog"], .modal');
            if (!CAPTCHA_RE.test(dialog?.textContent || '')) {
              (btn as HTMLElement).click();
              actions.push("clicked close button");
            }
          });
          // Remove fixed overlays
          document.querySelectorAll('.overlay, .backdrop, [class*="overlay" i], [class*="backdrop" i]')
            .forEach(e => {
              if (!CAPTCHA_RE.test(e.textContent || '') && getComputedStyle(e).position === 'fixed') {
                e.remove();
                actions.push("removed overlay");
              }
            });
          // Press Escape
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          actions.push("pressed Escape");
          return actions;
        });
        return `Dismissed popups: ${dismissed.join(", ")}.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Popup dismissal attempted: ${msg}`;
      }
    },
  });

  return { fillShippingInfo, fillCardFields, fillBillingAddress, clickButton, dismissPopups };
}
