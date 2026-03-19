#!/usr/bin/env tsx
/**
 * Debug script: inspect what the browser sees on a Shopify product page.
 * Checks all variant ID sources used by shopifyAjaxAddToCart.
 */
import "dotenv/config";
import { Stagehand } from "../packages/checkout/node_modules/@browserbasehq/stagehand/dist/index.js";

const url = process.argv[2] || "https://ugmonk.com/products/gather-premium-set-maple";

async function main() {
  console.log(`Debugging Shopify DOM for: ${url}`);

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY!,
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    model: {
      modelName: "google/gemini-2.5-flash",
      apiKey: process.env.GOOGLE_API_KEY!,
    },
  });
  await stagehand.init();
  const page = stagehand.context?.activePage() || (stagehand as any).page;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Wait for networkidle AND extra time for JS hydration
  await Promise.race([
    page.waitForLoadState("networkidle").catch(() => {}),
    page.waitForTimeout(10000),
  ]);
  await page.waitForTimeout(5000); // extra time for React/web component hydration

  const diagnostics = await page.evaluate(() => {
    const results: Record<string, unknown> = {};

    // Source A: window.meta
    try {
      const meta = (window as any).meta;
      results.windowMeta = meta?.product ? {
        hasVariants: !!meta.product.variants,
        variantCount: meta.product.variants?.length,
        firstVariant: meta.product.variants?.[0],
      } : "not found";
    } catch (e) { results.windowMeta = `error: ${e}`; }

    // Source B: ShopifyAnalytics
    try {
      const sa = (window as any).ShopifyAnalytics?.meta?.product;
      results.shopifyAnalytics = sa ? {
        hasVariants: !!sa.variants,
        variantCount: sa.variants?.length,
        firstVariant: sa.variants?.[0],
      } : "not found";
    } catch (e) { results.shopifyAnalytics = `error: ${e}`; }

    // Source C: JSON-LD
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      results.jsonLd = Array.from(scripts).map(s => {
        try {
          const data = JSON.parse(s.textContent || "");
          return { type: data["@type"], hasOffers: !!data.offers };
        } catch { return "parse error"; }
      });
    } catch (e) { results.jsonLd = `error: ${e}`; }

    // Source D: select[name="id"]
    try {
      const selects = document.querySelectorAll('select[name="id"], select[name*="variant"], select[data-product-select]');
      results.variantSelects = Array.from(selects).map(s => ({
        name: (s as HTMLSelectElement).name,
        value: (s as HTMLSelectElement).value,
        id: s.id,
      }));
    } catch (e) { results.variantSelects = `error: ${e}`; }

    // Source E: hidden inputs
    try {
      const inputs = document.querySelectorAll('input[name="id"][type="hidden"], input[name="variant_id"], input[name="product-id"], [data-variant-id]');
      results.hiddenInputs = Array.from(inputs).map(i => ({
        name: (i as HTMLInputElement).name,
        value: (i as HTMLInputElement).value,
        type: (i as HTMLInputElement).type,
        id: i.id,
        dataVariantId: i.getAttribute("data-variant-id"),
      }));
    } catch (e) { results.hiddenInputs = `error: ${e}`; }

    // Source F: URL variant param
    try {
      results.urlVariant = new URLSearchParams(window.location.search).get("variant");
    } catch (e) { results.urlVariant = `error: ${e}`; }

    // Source G: Scan inline scripts for variant IDs
    try {
      const scripts = document.querySelectorAll('script:not([src])');
      const variantIds = new Set<string>();
      for (const script of scripts) {
        const text = script.textContent || "";
        const idMatches = text.matchAll(/"id"\s*:\s*(\d{10,15})/g);
        for (const m of idMatches) variantIds.add(m[1]!);
        const variantMatches = text.matchAll(/variant[_\-]?[iI]d["\s:=]+(\d{10,15})/g);
        for (const m of variantMatches) variantIds.add(m[1]!);
      }
      results.inlineScriptVariantIds = Array.from(variantIds);
    } catch (e) { results.inlineScriptVariantIds = `error: ${e}`; }

    // Extra: window.Shopify
    try {
      results.windowShopify = {
        exists: !!(window as any).Shopify,
        product: (window as any).Shopify?.product ? "exists" : "not found",
      };
    } catch (e) { results.windowShopify = `error: ${e}`; }

    // Extra: all input[name="id"]
    try {
      const allIds = document.querySelectorAll('input[name="id"]');
      results.allNameIdInputs = Array.from(allIds).map(i => ({
        type: (i as HTMLInputElement).type,
        value: (i as HTMLInputElement).value,
        id: i.id,
        hidden: (i as HTMLElement).hidden || window.getComputedStyle(i).display === "none",
      }));
    } catch (e) { results.allNameIdInputs = `error: ${e}`; }

    // Extra: buttons with add to cart text
    try {
      const buttons = document.querySelectorAll('button, input[type="submit"]');
      results.atcButtons = Array.from(buttons)
        .filter(b => /add to cart|add to bag|buy now/i.test(b.textContent || (b as HTMLInputElement).value || ""))
        .map(b => ({
          tag: b.tagName,
          text: (b.textContent || "").trim().slice(0, 50),
          type: (b as HTMLButtonElement).type,
          disabled: (b as HTMLButtonElement).disabled,
          ariaHidden: b.getAttribute("aria-hidden"),
          visible: window.getComputedStyle(b).display !== "none" && window.getComputedStyle(b).visibility !== "hidden",
        }));
    } catch (e) { results.atcButtons = `error: ${e}`; }

    // Extra: product-form custom element
    try {
      const pf = document.querySelector("product-form");
      if (pf) {
        results.productForm = {
          exists: true,
          innerHTML: pf.innerHTML.slice(0, 500),
          shadowRoot: !!pf.shadowRoot,
        };
      } else {
        results.productForm = "not found";
      }
    } catch (e) { results.productForm = `error: ${e}`; }

    // Extra: check all custom elements with shadow roots
    try {
      const allElements = document.querySelectorAll("*");
      const shadowHosts: Array<{tag: string; childCount: number; sample: string}> = [];
      for (const el of allElements) {
        if (el.shadowRoot) {
          shadowHosts.push({
            tag: el.tagName.toLowerCase(),
            childCount: el.shadowRoot.childNodes.length,
            sample: el.shadowRoot.innerHTML?.slice(0, 200) || "",
          });
        }
      }
      results.shadowRoots = shadowHosts;
    } catch (e) { results.shadowRoots = `error: ${e}`; }

    // Extra: check document.forms
    try {
      results.documentForms = Array.from(document.forms).map(f => ({
        id: f.id,
        action: f.action,
        method: f.method,
        inputCount: f.elements.length,
        inputs: Array.from(f.elements).slice(0, 5).map(el => ({
          name: (el as HTMLInputElement).name,
          type: (el as HTMLInputElement).type,
          value: (el as HTMLInputElement).value?.slice(0, 30),
        })),
      }));
    } catch (e) { results.documentForms = `error: ${e}`; }

    // Extra: page title and URL for verification
    results.pageTitle = document.title;
    results.pageUrl = window.location.href;
    results.bodyClasses = document.body.className.slice(0, 200);
    results.bodyTextLength = document.body.innerText.length;
    results.bodyTextSample = document.body.innerText.slice(0, 500);

    return results;
  });

  console.log(JSON.stringify(diagnostics, null, 2));

  await stagehand.close();
}

main().catch(console.error);
