import type { ProductOption } from "@bloon/core";
import { getFirecrawlConfig } from "./client.js";
import { stripCurrencySymbol, mapOptions, isValidPrice } from "./helpers.js";
import { firecrawlExtractAsync } from "./extract.js";
import { browserbaseExtract } from "./browserbase-extract.js";
import {
  resolveVariantPricesViaFirecrawl,
  resolveVariantPricesViaCrawl,
} from "./variant.js";
import { fetchShopifyOptions } from "./shopify.js";

export interface FullDiscoveryResult {
  name: string;
  price: string;
  image_url?: string;
  method: string;
  options: ProductOption[];
  original_price?: string;
  currency?: string;
  description?: string;
  brand?: string;
}

// ---- Tier 2: Firecrawl 3-step discovery pipeline ----

export async function discoverViaFirecrawl(
  url: string,
): Promise<FullDiscoveryResult | null> {
  const config = getFirecrawlConfig();
  if (!config) return null;

  try {
    // Step 1: /extract on product URL (3 attempts with exponential backoff)
    let results: Awaited<ReturnType<typeof firecrawlExtractAsync>> = null;
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
      results = await firecrawlExtractAsync([url], config, 90_000);
      if (results?.length) break;
    }
    const isNullish = (v: unknown): boolean =>
      !v || v === "null" || v === "undefined";

    // If Firecrawl failed, try Browserbase adapter + Gemini extraction
    if (isNullish(results?.[0]?.name) || isNullish(results?.[0]?.price)) {
      console.log(`  [discover] Firecrawl failed for ${url}, trying Browserbase fallback`);
      const bbExtract = await browserbaseExtract(url);
      if (bbExtract?.name && bbExtract?.price && isValidPrice(bbExtract.price)) {
        results = [bbExtract];
      } else {
        return null;
      }
    }

    if (!isValidPrice(results![0].price!)) return null;
    const extract = results![0];

    let options = mapOptions(extract.options);

    // Shopify fallback: if no options from LLM, try the Shopify .json endpoint
    if (options.length === 0) {
      const shopifyOpts = await fetchShopifyOptions(url);
      if (shopifyOpts) options = shopifyOpts;
    }

    // Step 2 or 3 — only if options exist
    if (options.length > 0) {
      const hasVariantUrls =
        extract.variant_urls && extract.variant_urls.length > 0;
      if (hasVariantUrls) {
        // Step 2: /extract on each variant URL
        options = await resolveVariantPricesViaFirecrawl(
          extract.variant_urls!,
          url,
          config,
          options,
        );
      } else {
        // Step 3: /crawl from product URL
        options = await resolveVariantPricesViaCrawl(
          url,
          config,
          options,
          extract.name!,
        );
      }
    }

    const clean = (v: string | undefined): string | undefined =>
      v && v !== "null" && v !== "undefined" ? v : undefined;

    return {
      name: extract.name!,
      price: stripCurrencySymbol(extract.price!),
      image_url: clean(extract.image_url),
      method: "firecrawl",
      options,
      original_price: clean(extract.original_price)
        ? stripCurrencySymbol(extract.original_price!)
        : undefined,
      currency: clean(extract.currency),
      description: clean(extract.description),
      brand: clean(extract.brand),
    };
  } catch {
    return null;
  }
}
