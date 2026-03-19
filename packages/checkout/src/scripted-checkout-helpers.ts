/**
 * Checkout helper functions — extracted from scripted-actions.ts for maintainability.
 * All functions use page.evaluate() — zero LLM calls.
 */
import type { Page } from "@browserbasehq/stagehand";

// ---- Express pay dismissal ----

export async function scriptedDismissExpressPay(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // 1. Click "Pay with card" / "Credit card" / "Other payment methods" buttons
    const cardPayLabels = [
      "pay with card", "credit card", "credit/debit card", "debit or credit card",
      "other payment methods", "other payment options", "more payment options",
      "pay with credit card", "card payment", "pay another way",
      "use a different payment method",
    ];
    const allClickables = document.querySelectorAll(
      'button, a[role="button"], [role="tab"], [role="radio"], label, [class*="payment" i]'
    );
    for (const el of allClickables) {
      const text = (el.textContent || "").trim().toLowerCase();
      if (cardPayLabels.some(l => text.includes(l))) {
        (el as HTMLElement).click();
        return true;
      }
    }

    // 2. Close Shop Pay modal/overlay
    const shopPayOverlays = document.querySelectorAll(
      '[class*="shopify-pay" i], [class*="shop-pay" i], [class*="shoppay" i], ' +
      '[id*="shop-pay" i], [data-testid*="shop-pay" i], ' +
      '[class*="accelerated-checkout" i], [class*="express-payment" i]'
    );
    for (const overlay of shopPayOverlays) {
      const closeBtn = overlay.querySelector(
        'button[aria-label*="close" i], button[class*="close" i], .close'
      );
      if (closeBtn) {
        (closeBtn as HTMLElement).click();
        return true;
      }
    }

    // 3. Dismiss Apple Pay / Google Pay sheets
    // Press Escape to dismiss any express pay sheet
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // 4. Scroll past express pay section to reveal card form
    const expressSection = document.querySelector(
      '[class*="express" i][class*="pay" i], [class*="accelerated" i], ' +
      '[class*="alternative-payment" i], [data-testid*="express" i]'
    );
    if (expressSection) {
      expressSection.scrollIntoView({ block: "start" });
      // Find next sibling or parent's next sibling that contains card form
      const next = expressSection.nextElementSibling;
      if (next) next.scrollIntoView({ block: "start" });
      return true;
    }

    return false;
  });
}

// ---- Terms & conditions / age verification checkboxes ----

export async function scriptedCheckRequiredCheckboxes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const checked: string[] = [];
    const acceptPatterns = /terms|conditions|agree|age|18\+|policy|consent|accept|acknowledge|confirm.*read/i;
    const skipPatterns = /subscribe|offers|marketing|newsletter|promotions|updates|emails|sms|text messages/i;

    // Check required checkboxes with accept-like labels
    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]'
    );
    for (const cb of checkboxes) {
      if (cb.checked) continue;
      const label = cb.labels?.[0]?.textContent || "";
      const name = `${cb.name} ${cb.id}`;
      const nearbyText = cb.closest("label, div, span, li")?.textContent || "";
      const combined = `${label} ${name} ${nearbyText}`;

      // Skip marketing checkboxes
      if (skipPatterns.test(combined)) continue;

      // Check accept-pattern checkboxes OR required checkboxes without marketing text
      if (acceptPatterns.test(combined) || cb.required) {
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        cb.dispatchEvent(new Event("click", { bubbles: true }));
        checked.push(label.trim().slice(0, 50) || name.trim().slice(0, 50) || "unknown");
      }
    }
    return checked;
  });
}

// ---- Scripted shipping method selection ----

export async function scriptedSelectShippingMethod(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // Find shipping method radio buttons or clickable options
    const shippingSection = document.querySelector(
      '[class*="shipping-method" i], [class*="shippingMethod" i], ' +
      '[class*="delivery-method" i], [class*="deliveryMethod" i], ' +
      '[data-testid*="shipping" i], [id*="shipping-method" i], ' +
      'fieldset:has(input[name*="shipping" i][type="radio"])'
    );

    const radios = (shippingSection || document).querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name*="shipping" i], ' +
      'input[type="radio"][name*="delivery" i], ' +
      'input[type="radio"][name*="rate" i]'
    );

    if (radios.length === 0) {
      // Try clickable elements with shipping method text
      const clickables = (shippingSection || document).querySelectorAll(
        '[class*="shipping-option" i], [class*="delivery-option" i], ' +
        '[class*="rate" i][role="button"], [class*="shipping" i][role="radio"]'
      );
      if (clickables.length > 0) {
        // Click first option (usually default/cheapest)
        (clickables[0] as HTMLElement).click();
        return true;
      }
      return false;
    }

    // Parse prices from labels and select cheapest
    let cheapestRadio: HTMLInputElement | null = null;
    let cheapestPrice = Infinity;

    for (const radio of radios) {
      const label = radio.labels?.[0]?.textContent || radio.closest("label")?.textContent || "";
      const priceMatch = label.match(/\$\s*([\d,]+\.?\d{0,2})/);
      const price = priceMatch ? parseFloat(priceMatch[1]!.replace(/,/g, "")) : Infinity;

      // "Free" shipping = price 0
      if (/free/i.test(label)) {
        cheapestRadio = radio;
        cheapestPrice = 0;
        break;
      }

      if (price < cheapestPrice) {
        cheapestPrice = price;
        cheapestRadio = radio;
      }
    }

    // Fallback: select first radio if no price parsing succeeded
    if (!cheapestRadio && radios.length > 0) {
      cheapestRadio = radios[0]!;
    }

    if (cheapestRadio && !cheapestRadio.checked) {
      cheapestRadio.click();
      cheapestRadio.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    // Already selected
    return radios.length > 0;
  });
}

// ---- Scripted variant selection ----

export async function scriptedSelectVariants(
  page: Page,
  selections: Record<string, string>,
): Promise<{ selected: string[]; failed: string[] }> {
  return page.evaluate((sels) => {
    const selected: string[] = [];
    const failed: string[] = [];

    function fillSelect(el: HTMLSelectElement, value: string): boolean {
      for (const opt of el.options) {
        if (
          opt.value.toLowerCase() === value.toLowerCase() ||
          opt.text.trim().toLowerCase() === value.toLowerCase() ||
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

    for (const [key, value] of Object.entries(sels)) {
      const keyLower = key.toLowerCase();
      const valueLower = value.toLowerCase();
      let found = false;

      // 1. Try <select> with label matching key
      const selects = document.querySelectorAll("select");
      for (const sel of selects) {
        const label = sel.labels?.[0]?.textContent?.toLowerCase() || "";
        const name = `${sel.name} ${sel.id}`.toLowerCase();
        const ariaLabel = (sel.getAttribute("aria-label") || "").toLowerCase();
        if (label.includes(keyLower) || name.includes(keyLower) || ariaLabel.includes(keyLower)) {
          if (fillSelect(sel, value)) {
            selected.push(key);
            found = true;
            break;
          }
        }
      }
      if (found) continue;

      // 2. Try radio buttons with matching text
      const radios = document.querySelectorAll<HTMLInputElement>(
        `input[type="radio"]`
      );
      for (const radio of radios) {
        const label = radio.labels?.[0]?.textContent?.trim().toLowerCase() || "";
        const radioValue = radio.value.toLowerCase();
        if (label.includes(valueLower) || radioValue.includes(valueLower)) {
          radio.click();
          radio.dispatchEvent(new Event("change", { bubbles: true }));
          selected.push(key);
          found = true;
          break;
        }
      }
      if (found) continue;

      // 3. Try color/size swatches (clickable elements with matching title/aria-label/data-*)
      const swatches = document.querySelectorAll(
        '[class*="swatch" i], [class*="option" i], [class*="variant" i], ' +
        '[data-option-value], [data-value], [role="option"]'
      );
      for (const swatch of swatches) {
        const title = (swatch.getAttribute("title") || "").toLowerCase();
        const ariaLabel = (swatch.getAttribute("aria-label") || "").toLowerCase();
        const dataValue = (swatch.getAttribute("data-option-value") || swatch.getAttribute("data-value") || "").toLowerCase();
        const text = (swatch.textContent || "").trim().toLowerCase();

        if (title.includes(valueLower) || ariaLabel.includes(valueLower) || dataValue === valueLower || text === valueLower) {
          (swatch as HTMLElement).click();
          selected.push(key);
          found = true;
          break;
        }
      }
      if (found) continue;

      // 4. Try buttons with matching text (size buttons, color buttons)
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        const text = (btn.textContent || "").trim().toLowerCase();
        const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
        if (text === valueLower || ariaLabel.includes(valueLower)) {
          // Skip add-to-cart / checkout buttons
          if (/add to cart|checkout|buy now/i.test(text)) continue;
          (btn as HTMLElement).click();
          selected.push(key);
          found = true;
          break;
        }
      }

      if (!found) failed.push(key);
    }

    return { selected, failed };
  }, selections);
}

// ---- Shopify AJAX cart API fallback ----

/**
 * Bypasses DOM button clicks entirely by using Shopify's AJAX cart API.
 * Step 1: Extract variant ID from DOM sources (sync evaluate).
 * Step 2: If DOM sources fail, fetch /products/HANDLE.json (async evaluate).
 * Step 3: POST to /cart/add.js with the variant ID (async evaluate).
 */
export async function shopifyAjaxAddToCart(
  page: Page,
  selections?: Record<string, string>,
): Promise<{ success: boolean; variantId?: string; error?: string }> {
  // Step 1: Try to extract variant ID from synchronous DOM sources
  const domVariantId = await page.evaluate((sels) => {
    // Source A: Shopify's window.meta.product
    try {
      const meta = (window as any).meta;
      if (meta?.product?.variants) {
        const variants = meta.product.variants as Array<{ id: number; title: string; available: boolean }>;
        if (variants.length === 1) return String(variants[0]!.id);
        if (sels && Object.keys(sels).length > 0) {
          const selValues = Object.values(sels).map(v => v.toLowerCase());
          for (const v of variants) {
            if (!v.available) continue;
            if (selValues.every(sv => v.title.toLowerCase().includes(sv))) return String(v.id);
          }
        }
        const available = variants.find(v => v.available);
        if (available) return String(available.id);
      }
    } catch { /* continue */ }

    // Source B: ShopifyAnalytics.meta.product
    try {
      const sa = (window as any).ShopifyAnalytics?.meta?.product;
      if (sa?.variants) {
        const variants = sa.variants as Array<{ id: number; available: boolean }>;
        const available = variants.find(v => v.available) || variants[0];
        if (available) return String(available.id);
      }
    } catch { /* continue */ }

    // Source C: JSON-LD structured data
    try {
      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of ldScripts) {
        const data = JSON.parse(script.textContent || "");
        if (data["@type"] === "Product" && data.offers) {
          const offers = Array.isArray(data.offers) ? data.offers : [data.offers];
          for (const offer of offers) {
            if (offer.url) {
              const match = offer.url.match(/variant[=:](\d+)/i);
              if (match) return match[1]!;
            }
            if (offer.sku) {
              const numSku = parseInt(offer.sku, 10);
              if (!isNaN(numSku) && numSku > 1000000) return String(numSku);
            }
          }
        }
      }
    } catch { /* continue */ }

    // Source D: <select> with variant selector
    try {
      const selects = document.querySelectorAll<HTMLSelectElement>(
        'select[name="id"], select[name*="variant"], select[data-product-select]'
      );
      for (const sel of selects) {
        if (sel.value && /^\d+$/.test(sel.value)) return sel.value;
      }
    } catch { /* continue */ }

    // Source E: Hidden input with variant ID
    try {
      const hiddenInputs = document.querySelectorAll<HTMLInputElement>(
        'input[name="id"][type="hidden"], input[name="variant_id"], ' +
        'input[name="product-id"], [data-variant-id]'
      );
      for (const inp of hiddenInputs) {
        const val = inp.value || inp.getAttribute("data-variant-id") || "";
        if (val && /^\d+$/.test(val)) return val;
      }
    } catch { /* continue */ }

    // Source F: URL query param ?variant=XXXXX
    try {
      const vParam = new URLSearchParams(window.location.search).get("variant");
      if (vParam && /^\d+$/.test(vParam)) return vParam;
    } catch { /* continue */ }

    // Source G: Scan inline <script> tags for Shopify variant IDs
    // Shopify variant IDs are large numbers (10-15 digits). We look for patterns like:
    //   "id":37022218748054  or  variant_id: 37022218748054  or  "variant":37022218748054
    try {
      const scripts = document.querySelectorAll('script:not([src])');
      const variantIds = new Set<string>();
      for (const script of scripts) {
        const text = script.textContent || "";
        // Match "id": NUMBER patterns near "variant" context
        const idMatches = text.matchAll(/"id"\s*:\s*(\d{10,15})/g);
        for (const m of idMatches) {
          variantIds.add(m[1]!);
        }
        // Match variant_id or variantId patterns
        const variantMatches = text.matchAll(/variant[_\-]?[iI]d["\s:=]+(\d{10,15})/g);
        for (const m of variantMatches) {
          variantIds.add(m[1]!);
        }
      }
      // If we found exactly one variant ID, use it
      if (variantIds.size === 1) {
        return variantIds.values().next().value as string;
      }
      // If multiple, try matching with selections
      if (variantIds.size > 0 && sels && Object.keys(sels).length > 0) {
        // Can't match without product context — return first as best guess
        return variantIds.values().next().value as string;
      }
      // If any found, return first
      if (variantIds.size > 0) {
        return variantIds.values().next().value as string;
      }
    } catch { /* continue */ }

    return null;
  }, selections);

  let variantId = domVariantId;

  // Step 2: If DOM sources failed, try Shopify product JSON API
  if (!variantId) {
    console.log("  [shopify-ajax] DOM sources failed, trying /products/HANDLE.json");
    variantId = await page.evaluate(async (sels) => {
      try {
        const pathMatch = window.location.pathname.match(/\/products\/([^/?#]+)/);
        if (!pathMatch) return null;
        const handle = pathMatch[1];
        const resp = await fetch(`/products/${handle}.json`);
        if (!resp.ok) return null;
        const json = await resp.json();
        const variants = json.product?.variants as Array<{
          id: number; title: string; available: boolean;
          option1?: string; option2?: string; option3?: string;
        }> | undefined;
        if (!variants || variants.length === 0) return null;

        if (variants.length === 1) return String(variants[0]!.id);

        // Match by selection values
        if (sels && Object.keys(sels).length > 0) {
          const selValues = Object.values(sels).map(v => v.toLowerCase());
          for (const v of variants) {
            if (!v.available) continue;
            const opts = [v.option1, v.option2, v.option3]
              .filter(Boolean)
              .map(o => (o as string).toLowerCase());
            const titleLower = v.title.toLowerCase();
            if (selValues.every(sv => opts.some(o => o.includes(sv)) || titleLower.includes(sv))) {
              return String(v.id);
            }
          }
        }

        // Fallback: first available variant
        const available = variants.find(v => v.available);
        return available ? String(available.id) : null;
      } catch {
        return null;
      }
    }, selections);
  }

  if (!variantId) {
    return { success: false, error: "no_variant_id" };
  }

  console.log(`  [shopify-ajax] found variant ID: ${variantId}`);

  // Step 3: POST to /cart/add.js
  const cartResult = await page.evaluate(async (vid) => {
    try {
      const resp = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ id: Number(vid), quantity: 1 }],
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        return { ok: false, error: `cart_api_${resp.status}: ${text.slice(0, 100)}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `fetch_failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }, variantId);

  if (!cartResult.ok) {
    return { success: false, variantId, error: cartResult.error };
  }

  return { success: true, variantId };
}

// ---- Interstitial dismissal ----

export async function scriptedDismissInterstitial(
  page: Page,
): Promise<{ dismissed: boolean }> {
  const dismissed = await page.evaluate(() => {
    // Look for decline/skip buttons
    const declineLabels = [
      "no thanks", "no, thanks", "skip", "continue without",
      "continue to checkout", "decline", "not now", "no thank you",
      "maybe later", "no, thank you",
    ];
    const allClickables = document.querySelectorAll(
      'button, a[role="button"], a, [role="button"]'
    );
    for (const el of allClickables) {
      const text = (el.textContent || "").trim().toLowerCase();
      if (text.length > 50) continue;
      if (declineLabels.some(l => text.includes(l))) {
        (el as HTMLElement).click();
        return true;
      }
    }
    // No decline button found — press Escape
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  });

  if (dismissed) {
    try {
      await page.waitForTimeout(2000);
    } catch {
      // Page may have navigated
    }
  }
  return { dismissed };
}

// ---- Post-ATC destination validation ----

export async function validatePostAtcDestination(
  page: Page,
  detectFn: (p: Page) => Promise<string>,
  dismissFn: (p: Page) => Promise<{ dismissed: boolean }>,
): Promise<{ pageType: string; advanced: boolean }> {
  // 1. Wait up to 3s for navigation or DOM change
  await Promise.race([
    page.waitForLoadState("networkidle").catch(() => {}),
    page.waitForTimeout(3000),
  ]);

  // 2. Detect what page we landed on
  const pageType = await detectFn(page);

  // 3. If cart, shipping, checkout, or cart-drawer → OK
  if (["cart", "shipping-form", "payment-form", "payment-gateway", "cart-drawer"].includes(pageType)) {
    return { pageType, advanced: true };
  }

  // 4. If interstitial → dismiss and re-check
  if (pageType === "interstitial") {
    const result = await dismissFn(page);
    if (result.dismissed) {
      await page.waitForTimeout(2000);
      const postDismiss = await detectFn(page);
      return { pageType: postDismiss, advanced: true };
    }
  }

  // 5. If still product → check for cart drawer overlay
  if (pageType === "product") {
    const hasCartDrawer = await page.evaluate(() => {
      const drawer = document.querySelector(
        '[class*="cart-drawer" i], [class*="cartDrawer" i], ' +
        '[class*="mini-cart" i], [class*="minicart" i], ' +
        '[class*="slide-cart" i], [class*="cart-sidebar" i]'
      );
      if (!drawer) return false;
      const style = getComputedStyle(drawer as HTMLElement);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    if (hasCartDrawer) {
      return { pageType: "cart-drawer", advanced: true };
    }

    // 6. Navigate to /cart, then /checkout
    try {
      const cartUrl = new URL(page.url());
      cartUrl.pathname = "/cart";
      cartUrl.search = "";
      await page.goto(cartUrl.toString(), { waitUntil: "domcontentloaded", timeoutMs: 10000 });
      return { pageType: "cart", advanced: true };
    } catch {
      try {
        const checkoutUrl = new URL(page.url());
        checkoutUrl.pathname = "/checkout";
        checkoutUrl.search = "";
        await page.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded", timeoutMs: 10000 });
        return { pageType: "checkout", advanced: true };
      } catch {
        return { pageType, advanced: false };
      }
    }
  }

  return { pageType, advanced: false };
}
