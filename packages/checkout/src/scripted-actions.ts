/**
 * Zero-LLM DOM manipulation functions for checkout automation.
 * All functions use page.evaluate() — no LLM calls.
 */
import type { Page } from "@browserbasehq/stagehand";
import { scanIframesForCardFields } from "./agent-tools.js";

export { scriptedDismissExpressPay, scriptedCheckRequiredCheckboxes, scriptedSelectShippingMethod, scriptedSelectVariants, shopifyAjaxAddToCart } from "./scripted-checkout-helpers.js";

// ---- Page types detected by DOM analysis ----

export type PageType =
  | "donation-landing"
  | "product"
  | "cart"
  | "cart-drawer"
  | "interstitial"
  | "login-gate"
  | "email-verification"
  | "shipping-form"
  | "payment-form"
  | "payment-gateway"
  | "review"
  | "confirmation"
  | "error"
  | "unknown";

// ---- Card field selectors (mirrors agent-tools.ts CARD_FIELD_SELECTORS) ----

const CARD_SELECTORS = [
  'input[name*="cardnumber" i], input[name*="card-number" i], input[name*="encryptedCardNumber" i], input[autocomplete="cc-number"], input[name="number"], input[placeholder*="card number" i], input[data-testid*="card" i]',
  'input[name*="exp" i], input[name*="encryptedExpiryDate" i], input[autocomplete="cc-exp"], input[autocomplete="cc-exp-month"], input[name*="month" i][name*="exp" i]',
  'input[name*="cvc" i], input[name*="cvv" i], input[name*="encryptedSecurityCode" i], input[autocomplete="cc-csc"], input[name*="security" i], input[placeholder*="security" i]',
];

const CARD_FIELD_MAP: Array<{ selector: string; credKey: string }> = [
  { selector: 'input[name*="cardnumber" i], input[name*="card-number" i], input[name*="encryptedCardNumber" i], input[autocomplete="cc-number"], input[name="number"], input[placeholder*="card number" i], input[data-testid*="card" i]', credKey: "x_card_number" },
  { selector: 'input[name*="exp" i], input[name*="encryptedExpiryDate" i], input[autocomplete="cc-exp"]', credKey: "x_card_expiry" },
  { selector: 'input[name*="cvc" i], input[name*="cvv" i], input[name*="encryptedSecurityCode" i], input[autocomplete="cc-csc"], input[name*="security" i], input[placeholder*="security" i]', credKey: "x_card_cvv" },
  { selector: 'input[name*="holderName" i], input[name*="cardholder" i], input[autocomplete="cc-name"]', credKey: "x_cardholder_name" },
];

// Separate month/year selectors for split expiry fields (Stripe, Square, Adyen)
const EXPIRY_MONTH_SELECTORS = [
  'select[name*="month" i]', 'input[name*="month" i]',
  'select[autocomplete="cc-exp-month"]', 'input[autocomplete="cc-exp-month"]',
  'select[name*="exp_month" i]', 'input[name*="exp_month" i]',
];

const EXPIRY_YEAR_SELECTORS = [
  'select[name*="year" i]', 'input[name*="year" i]',
  'select[autocomplete="cc-exp-year"]', 'input[autocomplete="cc-exp-year"]',
  'select[name*="exp_year" i]', 'input[name*="exp_year" i]',
];

// ---- Scripted popup dismissal ----

export async function scriptedDismissPopups(page: Page): Promise<string[]> {
  return page.evaluate(() => {
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
      if (!CAPTCHA_RE.test(dialog?.textContent || "")) {
        (btn as HTMLElement).click();
        actions.push("clicked close button");
      }
    });

    // Remove cookie/consent banners
    document.querySelectorAll('[class*="cookie" i], [id*="cookie" i], [class*="consent" i]')
      .forEach(e => { e.remove(); actions.push("removed cookie banner"); });

    // Remove fixed overlays
    document.querySelectorAll('.overlay, .backdrop, [class*="overlay" i], [class*="backdrop" i]')
      .forEach(e => {
        if (!CAPTCHA_RE.test(e.textContent || "") && getComputedStyle(e).position === "fixed") {
          e.remove();
          actions.push("removed overlay");
        }
      });

    // Press Escape
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    actions.push("pressed Escape");

    // Dismiss newsletter / email capture modals
    const newsletterPatterns = /subscribe|sign up for|get \d+% off|join our|don't miss|newsletter|email list/i;
    document.querySelectorAll('[role="dialog"], .modal, [class*="popup" i], [class*="modal" i]').forEach(el => {
      if (CAPTCHA_RE.test(el.textContent || "")) return;
      if (!newsletterPatterns.test(el.textContent || "")) return;
      // Try close/dismiss buttons within the modal
      const closeBtn = el.querySelector(
        'button[aria-label*="close" i], button[class*="close" i], ' +
        'button:has(svg), .close, .btn-close, ' +
        'button'
      );
      // Check for "No thanks" style buttons
      const allBtns = el.querySelectorAll('button, a[role="button"]');
      for (const btn of allBtns) {
        const text = (btn.textContent || "").trim().toLowerCase();
        if (text.includes("no thanks") || text.includes("no, thanks") || text.includes("close") || text.includes("dismiss") || text.includes("not now") || text.includes("maybe later")) {
          (btn as HTMLElement).click();
          actions.push("dismissed newsletter popup");
          return;
        }
      }
      if (closeBtn) {
        (closeBtn as HTMLElement).click();
        actions.push("dismissed newsletter popup via close button");
      }
    });

    return actions;
  });
}

// scriptedDismissExpressPay — moved to scripted-checkout-helpers.ts
// scriptedCheckRequiredCheckboxes — moved to scripted-checkout-helpers.ts

// ---- Scripted shipping fill ----

interface ShippingData {
  email: string;
  firstName: string;
  lastName: string;
  street: string;
  apartment: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
}

export async function scriptedFillShipping(
  page: Page,
  data: ShippingData,
): Promise<string[]> {
  const filled = await page.evaluate((d) => {
    const results: string[] = [];

    // Shadow DOM-aware element search
    function deepFind(selector: string, root: ParentNode = document): Element | null {
      const found = root.querySelector(selector);
      if (found) return found;
      const allEls = root.querySelectorAll("*");
      for (const el of allEls) {
        if (el.shadowRoot) {
          const inner = deepFind(selector, el.shadowRoot);
          if (inner) return inner;
        }
      }
      return null;
    }

    function find(selectors: string[]): HTMLInputElement | HTMLSelectElement | null {
      for (const s of selectors) {
        const el = deepFind(s);
        if (el) return el as HTMLInputElement | HTMLSelectElement;
      }
      return null;
    }

    function fillInput(el: HTMLInputElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value",
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
      'input[autocomplete="email"]', 'input[type="email"]',
      'input[name*="email" i]', 'input[id*="email" i]',
    ]);
    if (email) { fillInput(email as HTMLInputElement, d.email); results.push("email"); }

    // Combined full name (many stores use a single name field)
    const fullName = find([
      'input[autocomplete="name"]', 'input[name*="fullName" i]',
      'input[name*="full_name" i]', 'input[name="name"]',
      'input[id*="fullName" i]',
    ]);
    if (fullName) {
      fillInput(fullName as HTMLInputElement, `${d.firstName} ${d.lastName}`.trim());
      results.push("fullName");
    }

    // First name (skip if full name was already filled)
    const fn = !fullName ? find([
      'input[autocomplete="given-name"]', 'input[name*="firstName" i]',
      'input[name*="first_name" i]', 'input[id*="firstName" i]',
      'input[name*="first-name" i]',
    ]) : null;
    if (fn) { fillInput(fn as HTMLInputElement, d.firstName); results.push("firstName"); }

    // Last name (skip if full name was already filled)
    const ln = !fullName ? find([
      'input[autocomplete="family-name"]', 'input[name*="lastName" i]',
      'input[name*="last_name" i]', 'input[id*="lastName" i]',
      'input[name*="last-name" i]',
    ]) : null;
    if (ln) { fillInput(ln as HTMLInputElement, d.lastName); results.push("lastName"); }

    // Address
    const addr = find([
      'input[autocomplete="address-line1"]', 'input[name*="address1" i]',
      'input[name*="street" i]', 'input[id*="address1" i]',
      'input[name*="line1" i]', 'input[name*="streetAddress" i]',
      'input[name*="address_1" i]', 'input[name*="addr1" i]',
      'input[name="address" i]', 'input[id="address" i]',
    ]);
    if (addr) { fillInput(addr as HTMLInputElement, d.street); results.push("address"); }

    // Apartment
    const apt = find([
      'input[autocomplete="address-line2"]', 'input[name*="address2" i]',
      'input[name*="apartment" i]', 'input[id*="address2" i]', 'input[id*="apartment" i]',
      'input[name*="line2" i]', 'input[name*="address_2" i]', 'input[name*="apt" i]',
    ]);
    if (apt && d.apartment) { fillInput(apt as HTMLInputElement, d.apartment); results.push("apartment"); }

    // City
    const city = find([
      'input[autocomplete="address-level2"]', 'input[name*="city" i]', 'input[id*="city" i]',
    ]);
    if (city) { fillInput(city as HTMLInputElement, d.city); results.push("city"); }

    // State — try select first, then input (many stores use text input for state)
    const stateSelect = find([
      'select[autocomplete="address-level1"]', 'select[name*="zone" i]',
      'select[name*="state" i]', 'select[name*="province" i]',
      'select[name*="region" i]',
    ]);
    if (stateSelect) {
      if (fillSelect(stateSelect as HTMLSelectElement, d.state)) results.push("state");
    } else {
      const stateInput = find([
        'input[autocomplete="address-level1"]', 'input[name*="state" i]',
        'input[name*="province" i]', 'input[name*="region" i]',
        'input[id*="state" i]',
      ]);
      if (stateInput) { fillInput(stateInput as HTMLInputElement, d.state); results.push("state"); }
    }

    // ZIP
    const zip = find([
      'input[autocomplete="postal-code"]', 'input[name*="zip" i]',
      'input[name*="postal" i]', 'input[id*="zip" i]',
      'input[name*="postalCode" i]', 'input[name*="zipCode" i]',
    ]);
    if (zip) { fillInput(zip as HTMLInputElement, d.zip); results.push("zip"); }

    // Country — try select first, then input
    const countrySelect = find([
      'select[autocomplete="country"]', 'select[name*="country" i]',
      'select[id*="country" i]',
    ]);
    if (countrySelect && d.country) {
      if (fillSelect(countrySelect as HTMLSelectElement, d.country)) results.push("country");
    } else {
      const countryInput = find([
        'input[autocomplete="country"]', 'input[name*="country" i]',
        'input[id*="country" i]',
      ]);
      if (countryInput && d.country) {
        fillInput(countryInput as HTMLInputElement, d.country);
        results.push("country");
      }
    }

    // Phone
    const phone = find([
      'input[autocomplete="tel"]', 'input[type="tel"]',
      'input[name*="phone" i]', 'input[id*="phone" i]',
    ]);
    if (phone) { fillInput(phone as HTMLInputElement, d.phone); results.push("phone"); }

    return results;
  }, data);

  // Dismiss autocomplete popups after filling
  if (filled.length > 0) {
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      document.querySelectorAll(
        '[role="dialog"] button[aria-label*="close" i], ' +
        '[role="dialog"] button[aria-label*="dismiss" i]'
      ).forEach(btn => {
        const dialog = btn.closest('[role="dialog"]');
        const text = dialog?.textContent?.toLowerCase() || "";
        if (!/captcha|recaptcha|hcaptcha|turnstile/i.test(text)) {
          (btn as HTMLElement).click();
        }
      });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    // Re-verify filled values — autocomplete can overwrite after dismissal
    if (filled.length > 0) {
      await page.waitForTimeout(500);
      await page.evaluate((d) => {
        function refillIfChanged(selectors: string[], expected: string) {
          if (!expected) return;
          for (const s of selectors) {
            const el = document.querySelector(s) as HTMLInputElement | null;
            if (!el) continue;
            if (el.value !== expected) {
              const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype, "value",
              )?.set;
              setter?.call(el, expected);
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
            return;
          }
        }
        refillIfChanged(['input[autocomplete="address-line1"]', 'input[name*="address1" i]', 'input[name*="street" i]'], d.street);
        refillIfChanged(['input[autocomplete="address-level2"]', 'input[name*="city" i]'], d.city);
        refillIfChanged(['input[autocomplete="postal-code"]', 'input[name*="zip" i]', 'input[name*="postal" i]'], d.zip);
      }, data);
    }
  }

  return filled;
}

// ---- Scripted card field fill (main page CSS selectors + iframe fallback) ----

export async function scriptedFillCardFields(
  page: Page,
  cdpCreds: Record<string, string>,
): Promise<{ filled: number; method: "main-page" | "iframe" | "none" }> {
  // 1. Try main-page CSS selectors first
  // Helper: fill with a short timeout to avoid hanging
  async function fillWithTimeout(locator: ReturnType<typeof page.locator>, value: string, ms = 1500): Promise<boolean> {
    try {
      await Promise.race([
        locator.fill(value),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fill timeout")), ms)),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  // Gift card / promo negative selectors
  const PROMO_PATTERNS = /gift|promo|discount|coupon|reward|voucher/i;

  let mainPageFilled = 0;
  for (const { selector, credKey } of CARD_FIELD_MAP) {
    const value = cdpCreds[credKey];
    if (!value) continue;
    try {
      const el = page.locator(selector).first();
      // Check if the field is a promo/gift card field by evaluating its attributes
      const isPromo = await page.evaluate((sel) => {
        const input = document.querySelector(sel) as HTMLInputElement | null;
        if (!input) return false;
        const attrs = `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute("aria-label") || ""}`.toLowerCase();
        return /gift|promo|discount|coupon|reward|voucher/.test(attrs);
      }, selector.split(",")[0]!.trim());
      if (isPromo) continue;
      if (await fillWithTimeout(el, value)) mainPageFilled++;
    } catch {
      // Field not found on main page
    }
  }

  // 2. Handle separated month/year expiry fields (Stripe, Square, Adyen)
  const expiry = cdpCreds.x_card_expiry;
  if (expiry) {
    const [rawMonth, rawYear] = expiry.split("/");
    const month = rawMonth?.trim() ?? "";
    const year = rawYear?.trim() ?? "";
    // Expand 2-digit year to 4-digit
    const fullYear = year.length === 2 ? `20${year}` : year;

    let filledSplit = false;
    for (const sel of EXPIRY_MONTH_SELECTORS) {
      const el = page.locator(sel).first();
      if (await fillWithTimeout(el, month)) {
        filledSplit = true;
        break;
      }
    }
    if (filledSplit) {
      for (const sel of EXPIRY_YEAR_SELECTORS) {
        const el = page.locator(sel).first();
        if (await fillWithTimeout(el, fullYear) || await fillWithTimeout(el, year)) {
          mainPageFilled += 2; // month + year
          break;
        }
      }
    }
  }

  // Need at least 2 fields (card number + one more) to count as main-page success
  if (mainPageFilled >= 2) {
    return { filled: mainPageFilled, method: "main-page" };
  }

  // 3. Iframe fallback — try even if 1 main-page field was found (likely a false positive)
  const iframeResult = await scanIframesForCardFields(page, cdpCreds);
  if (iframeResult.filled > 0) {
    return { filled: iframeResult.filled + mainPageFilled, method: "iframe" };
  }

  // If main page got at least 1, report that
  if (mainPageFilled > 0) {
    return { filled: mainPageFilled, method: "main-page" };
  }

  return { filled: 0, method: "none" };
}

// ---- Scripted billing fill ----

interface BillingData {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export async function scriptedFillBilling(
  page: Page,
  data: BillingData,
): Promise<string[]> {
  return page.evaluate((d) => {
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
        HTMLInputElement.prototype, "value",
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

    // Billing-specific selectors (look for "billing" in name/id, or second address group)
    const street = find([
      'input[name*="billing"][name*="address" i]', 'input[name*="billing"][name*="street" i]',
      'input[id*="billing"][id*="address" i]',
    ]);
    if (street) { fillInput(street as HTMLInputElement, d.street); results.push("billing_street"); }

    const city = find([
      'input[name*="billing"][name*="city" i]', 'input[id*="billing"][id*="city" i]',
    ]);
    if (city) { fillInput(city as HTMLInputElement, d.city); results.push("billing_city"); }

    const state = find([
      'select[name*="billing"][name*="state" i]', 'select[name*="billing"][name*="zone" i]',
      'select[name*="billing"][name*="province" i]',
    ]);
    if (state) {
      if (fillSelect(state as HTMLSelectElement, d.state)) results.push("billing_state");
    }

    const zip = find([
      'input[name*="billing"][name*="zip" i]', 'input[name*="billing"][name*="postal" i]',
      'input[id*="billing"][id*="zip" i]',
    ]);
    if (zip) { fillInput(zip as HTMLInputElement, d.zip); results.push("billing_zip"); }

    // Fallback: generic address selectors after card fields (second address block = billing)
    if (results.length === 0) {
      // Find address inputs that DON'T have "shipping" in their name/id
      const genericSelectors = [
        { sel: ['input[autocomplete="address-line1"]:not([name*="shipping" i])'], key: "billing_street", val: d.street },
        { sel: ['input[autocomplete="address-level2"]:not([name*="shipping" i])'], key: "billing_city", val: d.city },
        { sel: ['select[autocomplete="address-level1"]:not([name*="shipping" i])'], key: "billing_state", val: d.state },
        { sel: ['input[autocomplete="postal-code"]:not([name*="shipping" i])'], key: "billing_zip", val: d.zip },
      ];
      // Only use these if card fields are already present (confirms we're in billing context)
      const hasCardFields = !!document.querySelector('input[autocomplete="cc-number"], input[name*="card" i]');
      if (hasCardFields) {
        for (const { sel, key, val } of genericSelectors) {
          if (!val) continue;
          const el = find(sel);
          if (el && !(el as HTMLInputElement).value) {
            if (el.tagName === "SELECT") {
              if (fillSelect(el as HTMLSelectElement, val)) results.push(key);
            } else {
              fillInput(el as HTMLInputElement, val);
              results.push(key);
            }
          }
        }
      }
    }

    // Fill cardholder name if present and empty
    const cardholderName = find([
      'input[name*="holderName" i]', 'input[name*="cardholder" i]',
      'input[autocomplete="cc-name"]', 'input[name*="cardName" i]',
      'input[name*="name_on_card" i]', 'input[name*="nameOnCard" i]',
    ]);
    if (cardholderName && !(cardholderName as HTMLInputElement).value && d.street) {
      // We don't have cardholder name in BillingData — skip (filled via card handler)
    }

    return results;
  }, data);
}

// ---- Uncheck "billing same as shipping" ----

export async function scriptedUncheckBillingSameAsShipping(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    for (const cb of checkboxes) {
      const label = cb.labels?.[0]?.textContent?.toLowerCase() ?? "";
      const name = (cb.name + cb.id).toLowerCase();
      if (
        label.includes("same as shipping") ||
        label.includes("billing") ||
        name.includes("billing_same") ||
        name.includes("same_as_shipping")
      ) {
        if (cb.checked) {
          cb.click();
          cb.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  });
}

// scriptedSelectShippingMethod — moved to scripted-checkout-helpers.ts

// ---- Scripted button click ----

export async function scriptedClickButton(
  page: Page,
  target: string,
): Promise<boolean> {
  const clicked = await page.evaluate((t) => {
    const lower = t.toLowerCase();
    const alternatives = lower.split("/").map(s => s.trim());

    function wordsMatch(haystack: string, needle: string): boolean {
      const needleWords = needle.split(/\s+/);
      let pos = 0;
      for (const word of needleWords) {
        const idx = haystack.indexOf(word, pos);
        if (idx === -1) return false;
        pos = idx + word.length;
      }
      return true;
    }

    const candidates = document.querySelectorAll(
      'button, a[role="button"], input[type="submit"], [role="button"], a.btn, a.button, ' +
      'label[role="button"], div[role="button"], span[role="button"], a[href]'
    );

    const scored: Array<{ el: HTMLElement; score: number; text: string }> = [];

    for (const el of candidates) {
      const htmlEl = el as HTMLElement;

      // Skip disabled or hidden buttons
      const style = getComputedStyle(htmlEl);
      const isFixedOrSticky = style.position === "fixed" || style.position === "sticky";
      if (
        (el as HTMLButtonElement).disabled ||
        htmlEl.getAttribute("aria-disabled") === "true" ||
        (!isFixedOrSticky && htmlEl.offsetParent === null) ||
        style.display === "none" ||
        style.visibility === "hidden"
      ) continue;

      const text = (el.textContent || "").trim().toLowerCase();
      const value = (el as HTMLInputElement).value?.toLowerCase() || "";
      const label = el.getAttribute("aria-label")?.toLowerCase() || "";
      const testId = el.getAttribute("data-testid")?.toLowerCase() || "";
      const title = el.getAttribute("title")?.toLowerCase() || "";
      const allText = `${text} ${value} ${label} ${testId} ${title}`;

      const match = alternatives.some(alt =>
        allText.includes(alt) || wordsMatch(allText, alt)
      );
      if (!match) continue;

      // ---- Score the candidate ----
      let score = 0;

      // +3: Inside <form> with action containing cart/add/checkout
      const parentForm = htmlEl.closest("form");
      if (parentForm) {
        const action = (parentForm.getAttribute("action") || "").toLowerCase();
        if (/cart|add|checkout/.test(action)) score += 3;
      }

      // +2: type="submit"
      if (htmlEl.getAttribute("type") === "submit") score += 2;

      // +2: Exact text match (normalized)
      if (alternatives.some(alt => text === alt || value === alt)) score += 2;

      // -5: Financing keywords
      if (/financing|apply now|affirm|klarna|afterpay|zip pay|credit line|monthly payment|installment|lease|rent.to.own/i.test(allText)) score -= 5;

      // -3: Inside role="complementary" or <aside>
      if (htmlEl.closest('[role="complementary"], aside')) score -= 3;

      // -2: Inside modal/overlay (role="dialog" or position:fixed with high z-index)
      if (htmlEl.closest('[role="dialog"], [aria-modal="true"]')) {
        score -= 2;
      } else {
        let ancestor = htmlEl.parentElement;
        while (ancestor && ancestor !== document.body) {
          const aStyle = getComputedStyle(ancestor);
          if (aStyle.position === "fixed" && parseInt(aStyle.zIndex || "0", 10) > 999) {
            score -= 2;
            break;
          }
          ancestor = ancestor.parentElement;
        }
      }

      // +3: aria-label or data-testid contains add-to-cart/atc/add_to_cart
      if (/add.to.cart|atc|add_to_cart|addtocart/i.test(label) ||
          /add.to.cart|atc|add_to_cart|addtocart/i.test(testId)) score += 3;

      scored.push({ el: htmlEl, score, text: allText.slice(0, 80) });
    }

    if (scored.length === 0) return false;

    // +1 bonus for visually largest matching button
    let maxArea = 0;
    let largestIdx = -1;
    for (let i = 0; i < scored.length; i++) {
      const area = scored[i]!.el.offsetWidth * scored[i]!.el.offsetHeight;
      if (area > maxArea) {
        maxArea = area;
        largestIdx = i;
      }
    }
    if (largestIdx >= 0) scored[largestIdx]!.score += 1;

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Log top 3 candidates for debugging
    const top3 = scored.slice(0, 3).map(c => `[${c.score}] ${c.text}`);
    console.log(`[scriptedClickButton] "${t}" top candidates: ${top3.join(" | ")}`);

    // Click the highest-scoring candidate
    const winner = scored[0]!;
    const onclick = winner.el.getAttribute("onclick");
    if (onclick) {
      try {
        new Function(onclick).call(winner.el);
        return true;
      } catch {
        // Fall through to regular click
      }
    }
    winner.el.click();
    return true;
  }, target);

  if (clicked) {
    try {
      await page.waitForTimeout(3000);
    } catch {
      // Page may have navigated
    }
  }
  return clicked;
}

// ---- Scripted radio/checkbox option selection ----

export async function scriptedSelectOption(
  page: Page,
  labelOrValue: string,
  type: "radio" | "checkbox" = "radio",
): Promise<boolean> {
  return page.evaluate(
    ({ target, inputType }) => {
      const lower = target.toLowerCase();

      // 1. Native input[type="radio"] or input[type="checkbox"]
      const inputs = document.querySelectorAll<HTMLInputElement>(`input[type="${inputType}"]`);
      for (const input of inputs) {
        const label = input.labels?.[0]?.textContent?.toLowerCase() ?? "";
        const val = input.value.toLowerCase();
        const id = input.id.toLowerCase();
        // Also check parent element text (for inputs without proper <label> association)
        const parentText = input.parentElement?.textContent?.toLowerCase() ?? "";
        // Check aria-label on the input itself
        const ariaLabel = input.getAttribute("aria-label")?.toLowerCase() ?? "";
        if (label.includes(lower) || val.includes(lower) || id.includes(lower) ||
            parentText.includes(lower) || ariaLabel.includes(lower)) {
          input.click();
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }

      // 2. Custom [role="radio"] or [role="checkbox"] elements
      const role = inputType === "radio" ? "radio" : "checkbox";
      const customEls = document.querySelectorAll(`[role="${role}"]`);
      for (const el of customEls) {
        const text = (el.textContent || "").trim().toLowerCase();
        const val = el.getAttribute("value")?.toLowerCase() || "";
        const label = el.getAttribute("aria-label")?.toLowerCase() || "";
        if (text.includes(lower) || val.includes(lower) || label.includes(lower)) {
          (el as HTMLElement).click();
          return true;
        }
      }

      // 3. Clickable elements containing the target text (buttons, labels, etc.)
      const clickables = document.querySelectorAll(
        'button, label, [role="button"], [class*="option" i], [class*="amount" i]'
      );
      for (const el of clickables) {
        const text = (el.textContent || "").trim().toLowerCase();
        if (text === lower || text.includes(lower)) {
          (el as HTMLElement).click();
          return true;
        }
      }

      return false;
    },
    { target: labelOrValue, inputType: type },
  );
}

// ---- Page type detection ----

export async function detectPageType(page: Page): Promise<PageType> {
  const evalBody = ({ cardSelectors }: { cardSelectors: string[] }) => {
      // Shadow DOM-aware querySelector — searches light DOM + open shadow roots
      function deepQuerySelector(selector: string, root: ParentNode = document): Element | null {
        const found = root.querySelector(selector);
        if (found) return found;
        const allEls = root.querySelectorAll("*");
        for (const el of allEls) {
          if (el.shadowRoot) {
            const inner = deepQuerySelector(selector, el.shadowRoot);
            if (inner) return inner;
          }
        }
        return null;
      }

      function deepQuerySelectorAll(selector: string, root: ParentNode = document): Element[] {
        const results = Array.from(root.querySelectorAll(selector));
        const allEls = root.querySelectorAll("*");
        for (const el of allEls) {
          if (el.shadowRoot) {
            results.push(...deepQuerySelectorAll(selector, el.shadowRoot));
          }
        }
        return results;
      }

      // Collect text from light DOM + shadow roots for signal detection
      function deepTextContent(root: ParentNode = document.body): string {
        let text = (root as HTMLElement).textContent || "";
        const allEls = root.querySelectorAll("*");
        for (const el of allEls) {
          if (el.shadowRoot) {
            text += " " + deepTextContent(el.shadowRoot);
          }
        }
        return text;
      }

      const text = deepTextContent().toLowerCase();
      const url = window.location.href.toLowerCase();

      // Donation landing page (check BEFORE confirmation — donation pages have "thank you" text)
      const donationSignals = [
        "donate", "donation", "contribution", "give now",
      ];
      const donationCount = donationSignals.filter(s => text.includes(s)).length;
      const hasDonateButton = !!document.querySelector(
        'button[value*="donate" i], a[href*="donate" i], input[value*="donate" i]'
      );
      const hasDonationAmounts = !!document.querySelector(
        '[class*="amount" i], [name*="amount" i], input[type="radio"][name*="amount" i]'
      );
      const isDonationSite = url.includes("donate") || url.includes("donation");
      if ((donationCount >= 2 && (hasDonateButton || hasDonationAmounts)) || isDonationSite) {
        // Check if this is actually the payment gateway (has card fields)
        const hasCardFields = cardSelectors.some(sel =>
          document.querySelector(sel) !== null
        );
        const hasIframes = document.querySelectorAll("iframe").length > 0;
        if (hasCardFields || hasIframes) {
          return "payment-gateway" as const;
        }
        return "donation-landing" as const;
      }

      // Confirmation page (after donation check to avoid false positives on donation landing)
      const confirmSignals = [
        "thank you for your order", "order confirmed", "order number",
        "confirmation number", "order placed", "purchase complete",
        "successfully placed", "thank you for your donation",
        "we received your order", "your order has been",
      ];
      const confirmCount = confirmSignals.filter(s => text.includes(s)).length;
      // Require strong signals: ≥2 matches OR URL-based confirmation
      const isConfirmUrl = url.includes("/confirmation") || url.includes("/thank-you") ||
        url.includes("/order-complete") || url.includes("/order-confirmation");
      if (confirmCount >= 2 || (confirmCount >= 1 && isConfirmUrl)) {
        // Check for error signals even on apparent confirmation pages
        // "Your order could not be placed" contains "order" but is an error
        const errorTextSignals = [
          // Payment declines
          "card was declined", "card has been declined", "payment was declined",
          "payment declined", "transaction was declined", "transaction declined",
          "your card was denied", "payment was not successful",
          "unable to process your payment", "could not process your payment",
          "payment could not be completed", "we couldn't process your payment",
          // Card validation
          "invalid card number", "card number is invalid", "card has expired",
          "incorrect cvc", "incorrect cvv", "security code is incorrect",
          "card was not accepted", "card is not supported",
          // Order-level errors
          "order could not be placed", "order could not be completed",
          "unable to place your order", "unable to complete your order",
          "we were unable to process", "there was a problem with your order",
          // Out of stock
          "sold out", "out of stock", "no longer available", "item is unavailable",
          // Generic checkout errors
          "something went wrong", "an error occurred", "please try again",
          "transaction failed", "payment failed", "purchase failed",
          "insufficient funds", "do not honor",
        ];
        const errorOnConfirmCount = errorTextSignals.filter(s => text.includes(s)).length;
        if (errorOnConfirmCount === 0) {
          return "confirmation" as const;
        }
        // Error signals found on confirmation-like page → fall through to error check
      }

      // Shared signals used by multiple detectors (shadow DOM-aware)
      const hasCardFields = cardSelectors.some(sel =>
        deepQuerySelector(sel) !== null
      );
      const paymentIframeSignals = deepQuerySelectorAll(
        'iframe[src*="pay" i], iframe[src*="card" i], iframe[src*="adyen" i], ' +
        'iframe[src*="stripe" i], iframe[src*="braintree" i], iframe[name*="card" i]'
      );
      const hasAddToCart = !!deepQuerySelector(
        'button[class*="add-to-cart" i], button[name*="add" i], ' +
        'input[value*="add to cart" i], button[data-action*="add-to-cart" i], ' +
        'form[action*="cart"] button[type="submit"], ' +
        'button[data-testid*="add" i], button[id*="add-to-cart" i], ' +
        'button[aria-label*="add to cart" i], button[aria-label*="add to bag" i], ' +
        'button[data-testid*="add-to-cart" i], [data-action="add-to-cart"], ' +
        'form[action*="/cart/add"] button, ' +
        'button[data-test*="add-to-cart" i], button[data-test*="addToCart" i], ' +
        '[data-test="shipItButton"], [data-test="orderPickupButton"], ' +
        // Shopify product forms (common pattern)
        'product-form button[type="submit"], ' +
        '[data-product-form] button[type="submit"], ' +
        'form[data-type="add-to-cart-form"] button, ' +
        'form.product-form button[type="submit"], ' +
        // Generic submit buttons inside product sections
        '[class*="product" i] button[type="submit"], ' +
        '[id*="product" i] button[type="submit"]'
      );
      const addToCartText = ["add to cart", "add to bag", "add to basket", "buy now", "add it to your cart", "add item", "add to order", "ship it", "pick it up", "deliver it"];
      // URL-based product page hint (Shopify /products/, generic /product/)
      const isProductUrl = url.includes("/products/") || url.includes("/product/") ||
        /\/p\/[^/]+/.test(url) || url.includes("/dp/");
      const hasAtcText = addToCartText.some(s => text.includes(s));
      const isCheckoutUrl = url.includes("/checkout") || url.includes("/payment") ||
        url.includes("/billing");

      // URL query param hints for checkout step
      const urlStep = (() => {
        try {
          const params = new URLSearchParams(window.location.search);
          const step = params.get("step") || params.get("checkout_step") || params.get("stage") || "";
          return step.toLowerCase();
        } catch { return ""; }
      })();

      // Login signals — computed early so shipping-form can use loginCount as guard
      const loginSignals = [
        "sign in", "log in", "create account", "guest checkout",
        "continue as guest", "checkout as guest", "sign-in", "email or mobile",
        "sign up", "register", "returning customer", "new customer",
        "have an account", "already a member", "shop as guest",
      ];
      const loginCount = loginSignals.filter(s => text.includes(s)).length;

      // Cart drawer detection — fixed-position element with cart items + checkout button
      const cartDrawer = document.querySelector(
        '[class*="cart-drawer" i], [class*="cartDrawer" i], ' +
        '[class*="mini-cart" i], [class*="minicart" i], ' +
        '[class*="cart-sidebar" i], [class*="slide-cart" i], ' +
        '[data-testid*="cart-drawer" i]'
      );
      if (cartDrawer) {
        const style = getComputedStyle(cartDrawer as HTMLElement);
        const isVisible = style.display !== "none" && style.visibility !== "hidden" &&
          ((cartDrawer as HTMLElement).offsetWidth > 0 || style.position === "fixed");
        const hasCheckout = !!cartDrawer.querySelector('a[href*="checkout" i], button[class*="checkout" i]');
        if (isVisible && hasCheckout) {
          return "cart-drawer" as const;
        }
      }

      // ---- Cart page (BEFORE product — cart pages contain ATC-like buttons) ----
      const cartTextSignals = [
        "your cart", "shopping cart", "cart total", "order summary",
        "your bag", "cart summary", "your basket", "shopping bag",
      ];
      const cartTextCount = cartTextSignals.filter(s => text.includes(s)).length;
      const hasCheckoutButton = !!document.querySelector(
        'a[href*="checkout" i], button[class*="checkout" i], input[value*="checkout" i]'
      );
      const isCartUrl = url.includes("/cart") || url.includes("/basket") ||
        url.includes("/bag") || url.includes("/shopping-cart");
      const cartItemEls = document.querySelectorAll(
        '[data-item], [data-line-item], .cart-item, .line-item, ' +
        '[class*="cart-item" i], [class*="line-item" i], [class*="cart_item" i]'
      );
      const hasCartItems = cartItemEls.length > 0;
      const hasQuantityInputs = !!document.querySelector(
        'input[name*="quantity" i], select[name*="quantity" i], ' +
        '[class*="quantity" i] input, [class*="qty" i] input'
      );
      let cartSignalCount = 0;
      if (cartTextCount >= 1) cartSignalCount++;
      if (hasCheckoutButton) cartSignalCount++;
      if (isCartUrl) cartSignalCount++;
      if (hasCartItems) cartSignalCount++;
      if (hasQuantityInputs) cartSignalCount++;
      // Require 2+ cart signals to avoid false positives
      // Guard: checkout URLs (Shopify one-page checkout has cart items + order summary)
      // Guard: product URLs with ATC buttons (product pages have qty inputs + checkout links in nav)
      const hasStrongProductSignals = (hasAddToCart || hasAtcText) && isProductUrl;
      if (cartSignalCount >= 2 && !isCheckoutUrl && !hasStrongProductSignals) {
        return "cart" as const;
      }

      // ---- Interstitial page (warranty, upsell, protection plan) ----
      const interstitialTextPatterns = [
        "protection plan", "warranty", "extended coverage", "add protection",
        "customers also bought", "you may also like", "complete your order",
        "recommended for you", "frequently bought together", "don't forget",
        "before you go", "one more thing",
      ];
      const interstitialTextCount = interstitialTextPatterns.filter(s => text.includes(s)).length;
      const hasInterstitialUrl = /protection|warranty|upsell|crosssell|addon|cross-sell|up-sell/i.test(url);
      let hasDeclineButton = false;
      {
        const btns = document.querySelectorAll('button, a[role="button"], a');
        const declineRe = /no\s*,?\s*thanks|skip|continue without|not now|decline|no thank/i;
        for (const btn of btns) {
          const btnText = (btn.textContent || "").trim();
          if (declineRe.test(btnText) && btnText.length < 40) {
            hasDeclineButton = true;
            break;
          }
        }
      }
      let interstitialSignalCount = 0;
      if (interstitialTextCount >= 1) interstitialSignalCount++;
      if (hasInterstitialUrl) interstitialSignalCount++;
      if (hasDeclineButton) interstitialSignalCount++;
      // Only classify as interstitial if the page does NOT have ATC buttons
      // (product pages often have "you may also like" + cookie dismiss buttons)
      if (interstitialSignalCount >= 2 && !hasAddToCart && !hasAtcText) {
        return "interstitial" as const;
      }

      // Product page — check BEFORE payment to avoid misclassifying product pages
      // that have Shop Pay / express checkout card inputs.
      // Product pages have ATC buttons and are NOT on checkout URLs.
      if ((hasAddToCart || hasAtcText) && !isCheckoutUrl) {
        return "product" as const;
      }
      // URL-based product page fallback (Shopify /products/*, Target /p/*, Amazon /dp/*)
      if (isProductUrl && !isCheckoutUrl && !hasCardFields && paymentIframeSignals.length === 0) {
        return "product" as const;
      }

      // Payment form (card fields visible on main page)
      if (hasCardFields) {
        return "payment-form" as const;
      }

      // Login-gate — URL-based early detection (before payment-gateway steals it)
      const AUTH_PATH_PATTERNS = [
        '/login', '/signin', '/sign-in', '/sign_in',
        '/identity/',     // Best Buy
        '/auth/',         // generic
        '/authenticate',
        '/account/login', '/account/signin',
        '/ap/signin',     // Amazon
        '/sso/',
      ];
      const isAuthUrl = AUTH_PATH_PATTERNS.some(p => url.includes(p));
      if (isAuthUrl) {
        return "login-gate" as const;
      }

      // Payment gateway (iframes that likely contain card fields)
      if (paymentIframeSignals.length > 0) {
        return "payment-gateway" as const;
      }

      // URL step hint for payment
      if (urlStep === "payment" || urlStep === "payment_method" || urlStep === "pay") {
        // Check for card fields or iframes to confirm
        if (hasCardFields || paymentIframeSignals.length > 0) {
          return "payment-form" as const;
        }
        return "payment-gateway" as const;
      }

      // Structural login-gate: auth dialog or password fields with no shipping fields
      const shippingSelectors_precheck = [
        'input[autocomplete="given-name"]', 'input[autocomplete="address-line1"]',
        'input[autocomplete="family-name"]', 'input[autocomplete="postal-code"]',
        'input[name*="firstName" i]', 'input[name*="address1" i]',
        'input[name*="lastName" i]', 'input[name*="last_name" i]',
        'input[name*="city" i]', 'input[name*="postal" i]', 'input[name*="zip" i]',
      ];
      const shippingFieldCountPrecheck = shippingSelectors_precheck.filter(sel =>
        deepQuerySelector(sel) !== null
      ).length;
      const hasAuthDialog = (() => {
        const dialog = document.querySelector('dialog, [role="dialog"]');
        if (!dialog) return false;
        return !!(dialog.querySelector(
          'input[type="password"], input[autocomplete*="password"], ' +
          'input[autocomplete*="username"]'
        ));
      })();
      const hasPasswordField = !!deepQuerySelector(
        'input[type="password"], input[autocomplete="current-password"]'
      );
      if ((hasAuthDialog || (hasPasswordField && shippingFieldCountPrecheck === 0)) && !hasCardFields) {
        return "login-gate" as const;
      }

      // Shipping form — broadened detection
      const shippingSelectors = [
        'input[autocomplete="given-name"]', 'input[autocomplete="address-line1"]',
        'input[autocomplete="family-name"]', 'input[autocomplete="postal-code"]',
        'input[name*="firstName" i]', 'input[name*="address1" i]',
        'input[name*="lastName" i]', 'input[name*="last_name" i]',
        'input[autocomplete="shipping"]', 'input[autocomplete="name"]',
        'input[name*="fullName" i]', 'input[name*="full_name" i]',
        'input[name*="line1" i]', 'input[name*="streetAddress" i]',
        'input[name*="first_name" i]',
        'input[name*="city" i]', 'input[name*="postal" i]', 'input[name*="zip" i]',
        'input[name*="phone" i]', 'input[name*="address1" i]', 'input[name*="address_line" i]',
        'select[name*="country" i]', 'select[name*="province" i]', 'select[name*="state" i]',
      ];
      const shippingFieldCount = shippingSelectors.filter(sel =>
        deepQuerySelector(sel) !== null
      ).length;
      // Guard: if the page has 2+ login signals on a checkout URL, it's likely a login gate
      // (e.g. Target /checkout shows "sign in" + "create account" + email input)
      // Only use the relaxed 1-field threshold when login signals are low
      if (shippingFieldCount >= 2 || (isCheckoutUrl && shippingFieldCount >= 1 && loginCount < 2)) {
        return "shipping-form" as const;
      }

      // URL step hint for shipping
      if (urlStep === "contact_information" || urlStep === "contact" || urlStep === "shipping" || urlStep === "address") {
        return "shipping-form" as const;
      }

      // Email verification / OTP page — check BEFORE email-only step
      const verificationSignals = [
        "verification code", "enter code", "enter the code",
        "we sent", "we've sent", "check your email",
        "confirm your email", "one-time", "otp",
      ];
      const verificationCount = verificationSignals.filter(s => text.includes(s)).length;
      const otpInputs = deepQuerySelectorAll(
        'input[autocomplete="one-time-code"], ' +
        'input[name*="code" i], input[name*="otp" i], input[name*="verification" i], ' +
        'input[name*="token" i], input[id*="code" i], input[id*="otp" i], ' +
        'input[maxlength="1"], input[maxlength="4"], input[maxlength="5"], ' +
        'input[maxlength="6"], input[maxlength="7"], input[maxlength="8"]'
      );
      // Require both text signals AND short code inputs (avoid false positives)
      if (verificationCount >= 1 && otpInputs.length > 0) {
        return "email-verification" as const;
      }

      // Email-only step (common in Shopify) — treat as shipping-form
      // Only trigger on /checkout URLs (NOT /cart — cart pages often have email login fields)
      const emailOnlyInputs = deepQuerySelectorAll('input[type="email"], input[name*="email" i]');
      const totalFormInputs = deepQuerySelectorAll('input:not([type="hidden"]):not([type="submit"])');
      if (
        emailOnlyInputs.length > 0 &&
        totalFormInputs.length <= 3 &&
        isCheckoutUrl &&
        !url.includes("/cart")
      ) {
        return "shipping-form" as const;
      }

      // Review order page — enhanced with URL params + "Edit" buttons
      const reviewSignals = [
        "review your order", "review order", "order review",
        "review and pay", "confirm your order", "place your order",
      ];
      const reviewCount = reviewSignals.filter(s => text.includes(s)).length;
      const hasEditButtons = !!document.querySelector('a[href*="edit" i], [class*="edit-link" i], [class*="edit-button" i]');
      const isReviewStep = urlStep === "review" || urlStep === "confirm";
      if (reviewCount >= 1 && (isCheckoutUrl || url.includes("/review") || isReviewStep)) {
        return "review" as const;
      }
      if (isReviewStep && hasEditButtons) {
        return "review" as const;
      }

      // Login gate (loginSignals + loginCount computed earlier for shipping-form guard)
      // isAuthUrl already computed above (expanded AUTH_PATH_PATTERNS)
      const isLoginUrl = isCheckoutUrl || isAuthUrl;
      if (loginCount >= 2 && isLoginUrl) {
        return "login-gate" as const;
      }
      // Also detect as login-gate if URL is explicitly a login page (not generic /checkout)
      // Generic checkout URLs with a single "sign in" text (e.g. Shopify) are NOT login-gates
      if (isAuthUrl && loginCount >= 1) {
        return "login-gate" as const;
      }

      // Product page fallback (for pages on checkout URLs that also have ATC)
      if (hasAddToCart || hasAtcText) {
        return "product" as const;
      }

      // Error page — checked LAST so product/payment/shipping pages aren't misclassified
      // (e.g., Stripe demo mentions "payment failed" in description but is a product page)
      const errorTextSignals = [
        // Payment declines
        "card was declined", "card has been declined", "payment was declined",
        "payment declined", "transaction was declined", "transaction declined",
        "your card was denied", "payment was not successful",
        "unable to process your payment", "could not process your payment",
        "payment could not be completed", "we couldn't process your payment",
        // Card validation
        "invalid card number", "card number is invalid", "card has expired",
        "incorrect cvc", "incorrect cvv", "security code is incorrect",
        "card was not accepted", "card is not supported",
        // Order-level errors
        "order could not be placed", "order could not be completed",
        "unable to place your order", "unable to complete your order",
        "we were unable to process", "there was a problem with your order",
        // Out of stock
        "sold out", "out of stock", "no longer available", "item is unavailable",
        "option not available", "currently unavailable",
        // Generic checkout errors
        "something went wrong", "an error occurred", "please try again",
        "transaction failed", "payment failed", "purchase failed",
        "insufficient funds", "do not honor",
      ];
      const errorTextCount = errorTextSignals.filter(s => text.includes(s)).length;

      // CSS-based error detection — visible elements with error-confirming text
      const errorCssSelectors = [
        '[role="alert"]', '[class*="error" i]', '[class*="decline" i]',
        '[class*="alert-danger" i]', '[class*="alert-error" i]',
        '[class*="payment-error" i]', '[class*="form-error" i]',
        '[data-testid*="error" i]', '[id*="error-message" i]',
      ];
      const errorConfirmingPhrases = [
        "declined", "failed", "invalid", "expired", "denied",
        "unable to", "could not", "cannot", "error", "problem",
        "sold out", "out of stock", "unavailable", "insufficient",
      ];
      let cssErrorCount = 0;
      for (const sel of errorCssSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const htmlEl = el as HTMLElement;
          // Must be visible
          const style = getComputedStyle(htmlEl);
          if (style.display === "none" || style.visibility === "hidden") continue;
          if (htmlEl.offsetParent === null && style.position !== "fixed" && style.position !== "sticky") continue;
          // Must contain error-confirming text
          const elText = (htmlEl.textContent || "").toLowerCase();
          if (errorConfirmingPhrases.some(p => elText.includes(p))) {
            cssErrorCount++;
          }
        }
      }

      // Trigger error: require stronger signals on product/cart URLs to avoid false positives
      // (e.g. "something went wrong" in cookie banners or hidden error containers)
      const onProductOrCartUrl = isProductUrl || url.includes("/cart");
      if (onProductOrCartUrl) {
        // On product pages, require ≥2 text signals OR ≥3 CSS error elements
        if (errorTextCount >= 2 || cssErrorCount >= 3) {
          return "error" as const;
        }
      } else {
        // On checkout/other pages, keep original sensitivity
        if (errorTextCount >= 1 || cssErrorCount >= 2) {
          return "error" as const;
        }
      }

      // Checkout URL fallback — if on a checkout URL and nothing else matched,
      // check if it's a login gate (has login signals but no shipping fields)
      // vs a shipping form (has some form content the LLM can interact with)
      if (isCheckoutUrl) {
        if (loginCount >= 1 && shippingFieldCount === 0) {
          return "login-gate" as const;
        }
        return "shipping-form" as const;
      }

      return "unknown" as const;
  };

  try {
    return await page.evaluate(evalBody, { cardSelectors: CARD_SELECTORS });
  } catch {
    // DOM may be mutating (SPA navigation, hydration). Wait and retry once.
    await page.waitForTimeout(2000);
    try {
      return await page.evaluate(evalBody, { cardSelectors: CARD_SELECTORS });
    } catch {
      return "unknown";
    }
  }
}

// ---- Extract confirmation data ----

export interface ConfirmationData {
  orderNumber?: string;
  total?: string;
}

export async function extractConfirmationData(page: Page): Promise<ConfirmationData> {
  return page.evaluate(() => {
    const text = document.body.textContent || "";

    // Order number patterns
    const orderPatterns = [
      /order\s*(?:#|number|no\.?)\s*[:.]?\s*([A-Z0-9-]{4,})/i,
      /confirmation\s*(?:#|number|no\.?)\s*[:.]?\s*([A-Z0-9-]{4,})/i,
      /reference\s*(?:#|number|no\.?)\s*[:.]?\s*([A-Z0-9-]{4,})/i,
    ];
    let orderNumber: string | undefined;
    for (const pat of orderPatterns) {
      const m = text.match(pat);
      if (m?.[1]) { orderNumber = m[1]; break; }
    }

    // Total extraction
    const totalPatterns = [
      /(?:order\s*)?total\s*[:.]?\s*\$?\s*([\d,]+\.?\d{0,2})/i,
      /(?:amount\s*)?charged\s*[:.]?\s*\$?\s*([\d,]+\.?\d{0,2})/i,
      /\$\s*([\d,]+\.\d{2})/,
    ];
    let total: string | undefined;
    for (const pat of totalPatterns) {
      const m = text.match(pat);
      if (m?.[1]) { total = m[1].replace(/,/g, ""); break; }
    }

    return { orderNumber, total };
  });
}

// ---- Extract visible total from page ----

export async function extractVisibleTotal(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    // Pass 1: DOM-aware — find elements with total labels, extract adjacent dollar amount
    const labelPatterns = [
      "order total", "estimated total", "total due", "amount due",
      "subtotal", "order subtotal", "donation amount",
    ];
    const allElements = Array.from(document.querySelectorAll("*"));
    for (const el of allElements) {
      if (el.children.length > 5) continue; // skip large containers
      const elText = (el.textContent || "").toLowerCase().trim();
      if (!labelPatterns.some(lp => elText.includes(lp))) continue;
      const combined = (el.textContent || "") + " " + (el.nextElementSibling?.textContent || "");
      const m = combined.match(/\$\s*([\d,]+\.\d{2})/);
      if (m?.[1]) return m[1].replace(/,/g, "");
    }

    // Pass 2: Regex on full text — labeled patterns only
    const text = document.body.textContent || "";
    const labeledPatterns = [
      /(?:order\s*)?total\s*[:.]?\s*[$€£¥]?\s*([\d,]+\.?\d{0,2})/i,
      /(?:estimated\s*)?total\s*[:.]?\s*[$€£¥]?\s*([\d,]+\.?\d{0,2})/i,
      /(?:amount\s*)?due\s*[:.]?\s*[$€£¥]?\s*([\d,]+\.?\d{0,2})/i,
      /(?:donation\s*)?amount\s*[:.]?\s*[$€£¥]?\s*([\d,]+\.?\d{0,2})/i,
    ];
    for (const pat of labeledPatterns) {
      const m = text.match(pat);
      if (m?.[1]) return m[1].replace(/,/g, "");
    }

    // Pass 3: Greedy fallback — last resort
    const fallback = text.match(/[$€£¥]\s*([\d,]+\.\d{2})/);
    if (fallback?.[1]) return fallback[1].replace(/,/g, "");

    return undefined;
  });
}

// ---- Error message extraction ----

export type ErrorType =
  | "payment_declined"
  | "card_invalid"
  | "out_of_stock"
  | "3ds_failed"
  | "session_timeout"
  | "express_pay_required"
  | "site_requires_account"
  | "price_mismatch"
  | "checkout_error";

export interface ErrorData {
  type: ErrorType;
  message: string;
}

export async function extractErrorMessage(page: Page): Promise<ErrorData> {
  return page.evaluate(() => {
    const text = (document.body.textContent || "").toLowerCase();

    // Classify error type
    const declinePatterns = [
      "card was declined", "card has been declined", "payment was declined",
      "payment declined", "transaction was declined", "transaction declined",
      "your card was denied", "payment was not successful",
      "unable to process your payment", "could not process your payment",
      "payment could not be completed", "we couldn't process your payment",
      "transaction failed", "payment failed", "insufficient funds", "do not honor",
    ];
    const cardInvalidPatterns = [
      "invalid card number", "card number is invalid", "card has expired",
      "incorrect cvc", "incorrect cvv", "security code is incorrect",
      "card was not accepted", "card is not supported",
    ];
    const outOfStockPatterns = [
      "sold out", "out of stock", "no longer available", "item is unavailable",
    ];
    const threeDsPatterns = [
      "3d secure", "3ds", "authentication failed", "authentication required",
      "verification failed", "unable to authenticate", "secure authentication",
    ];
    const sessionPatterns = [
      "session expired", "session timed out", "session has expired",
      "please refresh", "start over", "checkout expired",
    ];
    const accountRequiredPatterns = [
      "sign in to continue", "login required", "create an account",
      "must be logged in", "account required", "please sign in",
    ];

    let type: "payment_declined" | "card_invalid" | "out_of_stock" | "3ds_failed" | "session_timeout" | "express_pay_required" | "site_requires_account" | "price_mismatch" | "checkout_error" = "checkout_error";
    if (declinePatterns.some(p => text.includes(p))) type = "payment_declined";
    else if (cardInvalidPatterns.some(p => text.includes(p))) type = "card_invalid";
    else if (outOfStockPatterns.some(p => text.includes(p))) type = "out_of_stock";
    else if (threeDsPatterns.some(p => text.includes(p))) type = "3ds_failed";
    else if (sessionPatterns.some(p => text.includes(p))) type = "session_timeout";
    else if (accountRequiredPatterns.some(p => text.includes(p))) type = "site_requires_account";

    // Extract visible error text from DOM containers
    const errorSelectors = [
      '[role="alert"]', '[class*="error" i]', '[class*="decline" i]',
      '[class*="alert-danger" i]', '[class*="alert-error" i]',
      '[class*="payment-error" i]', '[class*="form-error" i]',
      '[data-testid*="error" i]', '[id*="error-message" i]',
    ];
    const errorConfirming = [
      "declined", "failed", "invalid", "expired", "denied",
      "unable to", "could not", "cannot", "error", "problem",
      "sold out", "out of stock", "unavailable", "insufficient",
    ];

    for (const sel of errorSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const htmlEl = el as HTMLElement;
        const style = getComputedStyle(htmlEl);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (htmlEl.offsetParent === null && style.position !== "fixed" && style.position !== "sticky") continue;
        const elText = (htmlEl.textContent || "").trim();
        if (elText.length > 0 && elText.length < 500 && errorConfirming.some(p => elText.toLowerCase().includes(p))) {
          return { type, message: elText };
        }
      }
    }

    // Fallback: find matching error phrase in full page text
    const allPatterns = [...declinePatterns, ...cardInvalidPatterns, ...outOfStockPatterns,
      "something went wrong", "an error occurred", "please try again",
      "purchase failed", "order could not be placed", "order could not be completed",
      "unable to place your order", "unable to complete your order",
      "there was a problem with your order",
    ];
    for (const p of allPatterns) {
      if (text.includes(p)) {
        return { type, message: p };
      }
    }

    return { type, message: "Unknown checkout error" };
  });
}

// ---- Scripted verification code fill ----

export async function scriptedFillVerificationCode(
  page: Page,
  code: string,
): Promise<boolean> {
  return page.evaluate((c) => {
    function fillInput(el: HTMLInputElement, value: string) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value",
      )?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    // 1. Try autocomplete="one-time-code" first
    const otcInput = document.querySelector<HTMLInputElement>(
      'input[autocomplete="one-time-code"]'
    );
    if (otcInput) {
      fillInput(otcInput, c);
      return true;
    }

    // 2. Try named code/otp/verification inputs
    const namedSelectors = [
      'input[name*="code" i]', 'input[name*="otp" i]', 'input[name*="verification" i]',
      'input[name*="token" i]', 'input[id*="code" i]', 'input[id*="otp" i]',
    ];
    for (const sel of namedSelectors) {
      const el = document.querySelector<HTMLInputElement>(sel);
      if (el && el.type !== "hidden") {
        fillInput(el, c);
        return true;
      }
    }

    // 3. Split OTP inputs — multiple adjacent single-char inputs (maxlength=1)
    const splitInputs = document.querySelectorAll<HTMLInputElement>(
      'input[maxlength="1"]'
    );
    if (splitInputs.length >= 4 && splitInputs.length <= 8 && c.length === splitInputs.length) {
      for (let i = 0; i < splitInputs.length; i++) {
        fillInput(splitInputs[i]!, c[i]!);
      }
      return true;
    }

    // 4. Short maxlength inputs (4-8 chars)
    for (let len = 4; len <= 8; len++) {
      const el = document.querySelector<HTMLInputElement>(
        `input[maxlength="${len}"]`
      );
      if (el && el.type !== "hidden") {
        fillInput(el, c);
        return true;
      }
    }

    return false;
  }, code);
}
