/**
 * Bulk URL test for Firecrawl discovery pipeline.
 * Tests ~60 product URLs across a wide spectrum of sites.
 *
 * Usage: npx tsx packages/crawling/tests/bulk-url-test.ts
 */

import {
  discoverViaFirecrawlWithDiagnostics,
  type DiscoveryFailureCode,
} from "../src/discover.js";
import { isValidPrice } from "../src/helpers.js";
import type { FullDiscoveryResult } from "../src/discover.js";

// Set env vars if not already set
process.env.FIRECRAWL_API_KEY ??= "fc-selfhosted";
process.env.FIRECRAWL_BASE_URL ??= "http://localhost:3002";

interface TestResult {
  url: string;
  category: string;
  success: boolean;
  name?: string;
  price?: string;
  method?: string;
  failureCode?: DiscoveryFailureCode;
  failureStage?: string;
  failureDetail?: string;
  timingTotalMs?: number;
  timingFirecrawlMs?: number;
  timingFirecrawlAttempts?: number;
  timingBrowserbaseMs?: number;
  timingVariantMs?: number;
  priceValid: boolean;
  nameValid: boolean;
  optionCount: number;
  options?: string[];
  error?: string;
  notFound: boolean;
  durationMs: number;
}

const urls: { url: string; category: string }[] = [
  // ---- Shopify stores ----
  { url: "https://www.allbirds.com/products/mens-tree-runners", category: "Shopify / Shoes" },
  { url: "https://en.pitviper.es/products/the-actualbush-original-2-0", category: "Shopify / Sunglasses" },
  { url: "https://www.gymshark.com/products/gymshark-vital-seamless-2-0-leggings-black-ss22", category: "Shopify / Activewear" },
  { url: "https://www.brooklinen.com/products/classic-core-sheet-set", category: "Shopify / Bedding" },
  { url: "https://www.bombas.com/products/womens-gripper-ankle-sock-6-pack", category: "Shopify / Socks" },
  { url: "https://www.ruggable.com/products/solid-navy-blue-rug", category: "Shopify / Rugs" },
  { url: "https://www.chubbiesshorts.com/products/the-flint-stones", category: "Shopify / Shorts" },
  { url: "https://www.mvmt.com/products/classic-black-tan", category: "Shopify / Watches" },
  { url: "https://www.nativecos.com/products/coconut-vanilla-deodorant", category: "Shopify / Personal care" },
  { url: "https://www.hydroflask.com/32-oz-wide-mouth", category: "Shopify / Bottles" },

  // ---- Fashion / Apparel ----
  { url: "https://www.primark.com/es-es/p/pantalones-cortos-deportivos-de-malla-negro-991160590804", category: "Primark / Shorts" },
  { url: "https://www.zara.com/us/en/cotton-t-shirt-p00722325.html", category: "Zara / T-shirt" },
  { url: "https://www2.hm.com/en_us/productpage.0970818001.html", category: "H&M / Apparel" },
  { url: "https://www.uniqlo.com/us/en/products/E449982-000/00", category: "Uniqlo / Apparel" },
  { url: "https://www.nike.com/t/air-max-90-mens-shoes-6n3vKB/CN8490-001", category: "Nike / Shoes" },
  { url: "https://www.adidas.com/us/ultraboost-5-shoes/HQ6437.html", category: "Adidas / Shoes" },
  { url: "https://www.levi.com/US/en_US/clothing/men/jeans/511-slim-fit-mens-jeans/p/045115855", category: "Levi's / Jeans" },
  { url: "https://www.nordstrom.com/s/nike-dunk-low-retro-sneaker-men/6579130", category: "Nordstrom / Shoes" },
  { url: "https://www.gap.com/browse/product.do?pid=795187012", category: "Gap / Apparel" },

  // ---- Electronics ----
  { url: "https://www.apple.com/shop/buy-iphone/iphone-16", category: "Apple / Phone" },
  { url: "https://www.samsung.com/us/smartphones/galaxy-s25-ultra/", category: "Samsung / Phone" },
  { url: "https://store.google.com/us/product/pixel_9", category: "Google / Phone" },
  { url: "https://www.bose.com/p/headphones/bose-quietcomfort-ultra-headphones/QCUH-HEADPHONEARN.html", category: "Bose / Headphones" },
  { url: "https://www.sony.com/en/headphones/wh-1000xm5", category: "Sony / Headphones" },
  { url: "https://www.logitech.com/en-us/products/mice/mx-master-3s.910-006557.html", category: "Logitech / Mouse" },
  { url: "https://www.anker.com/products/a2337-usb-c-charger-67w", category: "Anker / Charger" },

  // ---- Home / Furniture ----
  { url: "https://www.ikea.com/us/en/p/kallax-shelf-unit-white-00275848/", category: "IKEA / Furniture" },
  { url: "https://www.wayfair.com/furniture/pdp/mercury-row-arviso-upholstered-platform-bed-w007705244.html", category: "Wayfair / Furniture" },
  { url: "https://www.cb2.com/taper-black-marble-side-table/s547916", category: "CB2 / Furniture" },
  { url: "https://www.westelm.com/products/mid-century-bedside-table-h433/", category: "West Elm / Furniture" },

  // ---- Grocery / Food ----
  { url: "https://www.instacart.com/store/whole-foods-market/product_page/365-by-whole-foods-market-organic-whole-milk-1-gal", category: "Instacart / Grocery" },
  { url: "https://www.thrive.market/p/primal-kitchen-classic-bbq-sauce", category: "Thrive / Food" },

  // ---- Beauty / Skincare ----
  { url: "https://www.sephora.com/product/the-porefessional-face-primer-P264900", category: "Sephora / Makeup" },
  { url: "https://www.ulta.com/p/dream-cream-body-lotion-pimprod2003346", category: "Ulta / Skincare" },
  { url: "https://theordinary.com/en-us/hyaluronic-acid-2-b5-hydrating-serum-100098.html", category: "The Ordinary / Skincare" },
  { url: "https://www.cerave.com/skincare/moisturizers/moisturizing-cream", category: "CeraVe / Skincare" },
  { url: "https://glossier.com/products/boy-brow", category: "Glossier / Makeup" },

  // ---- Sporting goods / Outdoor ----
  { url: "https://www.rei.com/product/171554/patagonia-better-sweater-fleece-jacket-mens", category: "REI / Outdoor" },
  { url: "https://www.patagonia.com/product/mens-nano-puff-jacket/84212.html", category: "Patagonia / Jacket" },
  { url: "https://www.yeti.com/drinkware/bottles/21071501392.html", category: "Yeti / Drinkware" },
  { url: "https://www.thenorthface.com/en-us/mens/mens-jackets-and-vests/mens-fleece-c210237/m-denali-jacket-pNF0A7UR2", category: "North Face / Jacket" },

  // ---- Books / Media ----
  { url: "https://bookshop.org/p/books/atomic-habits-james-clear/7244448", category: "Bookshop / Book" },
  { url: "https://www.barnesandnoble.com/w/project-hail-mary-andy-weir/1137396811", category: "B&N / Book" },

  // ---- Pet ----
  { url: "https://www.chewy.com/dp/54226", category: "Chewy / Pet food" },

  // ---- Specialty / DTC ----
  { url: "https://www.warbyparker.com/eyeglasses/women/durand/crystal", category: "Warby Parker / Glasses" },
  { url: "https://www.casper.com/mattresses/original/", category: "Casper / Mattress" },
  { url: "https://www.away.com/suitcases/the-carry-on", category: "Away / Luggage" },
  { url: "https://www.everlane.com/products/mens-premium-weight-crew-tee-black", category: "Everlane / Apparel" },
  { url: "https://www.aesop.com/us/p/skin/hydrate/camellia-nut-facial-hydrating-cream/", category: "Aesop / Skincare" },
  { url: "https://www.lego.com/en-us/product/eiffel-tower-10307", category: "Lego / Toys" },
  { url: "https://www.dyson.com/vacuum-cleaners/cordless/v15/detect-absolute-yellow-iron", category: "Dyson / Vacuum" },

  // ---- International ----
  { url: "https://www.asos.com/us/asos-design/asos-design-oversized-t-shirt-in-black/prd/203426899", category: "ASOS / Apparel" },
  { url: "https://www.decathlon.com/products/mens-mountain-hiking-waterproof-jacket-mh500", category: "Decathlon / Outdoor" },
  { url: "https://www.muji.com/us/products/cmdty/detail/4550344592045", category: "Muji / Home" },

  // ---- Supplements / Health ----
  { url: "https://www.iherb.com/pr/nature-s-way-alive-once-daily-multi-vitamin-ultra-potency-60-tablets/14811", category: "iHerb / Vitamins" },
  { url: "https://athleticgreens.com/en", category: "AG1 / Supplements" },

  // ---- Marketplace ----
  { url: "https://www.etsy.com/listing/1020399732/custom-name-necklace-personalized", category: "Etsy / Jewelry" },
  { url: "https://www.ebay.com/itm/394944449784", category: "eBay / Marketplace" },
  { url: "https://www.target.com/p/apple-airpods-pro-2nd-generation/-/A-85978612", category: "Target / Electronics" },
  { url: "https://www.walmart.com/ip/Crayola-96ct-Crayons/17801992", category: "Walmart / Toys" },
  { url: "https://www.costco.com/kirkland-signature-organic-extra-virgin-olive-oil%2C-2-l.product.100334841.html", category: "Costco / Grocery" },
];

// Set to 1 when using Browserbase adapter (Dev plan = 1 concurrent session)
const CONCURRENCY = parseInt(process.env.BULK_TEST_CONCURRENCY ?? "3", 10);

async function runTest(
  entry: { url: string; category: string },
): Promise<TestResult> {
  const start = Date.now();
  try {
    const { result, diagnostics } = await discoverViaFirecrawlWithDiagnostics(
      entry.url,
    );
    const durationMs = Date.now() - start;
    if (!result) {
      return {
        url: entry.url,
        category: entry.category,
        success: false,
        priceValid: false,
        nameValid: false,
        optionCount: 0,
        notFound: false,
        error: "null result",
        failureCode: diagnostics.failureCode,
        failureStage: diagnostics.failureStage,
        failureDetail: diagnostics.failureDetail,
        timingTotalMs: diagnostics.timings?.totalMs,
        timingFirecrawlMs: diagnostics.timings?.firecrawlMs,
        timingFirecrawlAttempts: diagnostics.timings?.firecrawlAttempts,
        timingBrowserbaseMs: diagnostics.timings?.browserbaseMs,
        timingVariantMs: diagnostics.timings?.variantMs,
        durationMs,
      };
    }
    if (result.error === "product_not_found") {
      return {
        url: entry.url,
        category: entry.category,
        success: false,
        priceValid: false,
        nameValid: false,
        optionCount: 0,
        notFound: true,
        error: "product not found / discontinued",
        failureCode: diagnostics.failureCode ?? result.failure_code,
        failureStage: diagnostics.failureStage ?? result.failure_stage,
        failureDetail: diagnostics.failureDetail ?? result.failure_detail,
        timingTotalMs: diagnostics.timings?.totalMs,
        timingFirecrawlMs: diagnostics.timings?.firecrawlMs,
        timingFirecrawlAttempts: diagnostics.timings?.firecrawlAttempts,
        timingBrowserbaseMs: diagnostics.timings?.browserbaseMs,
        timingVariantMs: diagnostics.timings?.variantMs,
        durationMs,
      };
    }
    const priceValid = isValidPrice(result.price);
    const nameValid = Boolean(result.name && result.name.trim().length >= 3);
    return {
      url: entry.url,
      category: entry.category,
      success: priceValid && nameValid,
      name: result.name,
      price: result.price,
      method: result.method,
      failureCode: diagnostics.failureCode,
      failureStage: diagnostics.failureStage,
      failureDetail: diagnostics.failureDetail,
      timingTotalMs: diagnostics.timings?.totalMs,
      timingFirecrawlMs: diagnostics.timings?.firecrawlMs,
      timingFirecrawlAttempts: diagnostics.timings?.firecrawlAttempts,
      timingBrowserbaseMs: diagnostics.timings?.browserbaseMs,
      timingVariantMs: diagnostics.timings?.variantMs,
      priceValid,
      nameValid,
      optionCount: result.options.length,
      options: result.options.map(
        (o) => `${o.name}: [${o.values.join(", ")}]`,
      ),
      notFound: false,
      error: !priceValid
        ? `invalid price: "${result.price}"`
        : !nameValid
          ? "invalid name"
          : undefined,
      durationMs,
    };
  } catch (err: any) {
    return {
      url: entry.url,
      category: entry.category,
      success: false,
      priceValid: false,
      nameValid: false,
      optionCount: 0,
      notFound: false,
      error: err?.message ?? String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function main() {
  console.log(`\n=== Firecrawl Bulk URL Test ===`);
  console.log(`URLs: ${urls.length} | Concurrency: ${CONCURRENCY}\n`);

  const results: TestResult[] = [];
  const queue = [...urls];

  // Process in batches
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(runTest));
    for (const r of batchResults) {
      results.push(r);
      const status = r.notFound ? "404" : r.success ? "OK" : "FAIL";
      const optStr = r.optionCount > 0 ? ` [${r.optionCount} options]` : "";
      const priceStr = r.price ? ` $${r.price}` : "";
      const nameStr = r.name ? ` "${r.name.slice(0, 50)}"` : "";
      const errStr = r.error ? ` (${r.error.slice(0, 60)})` : "";
      console.log(
        `[${String(results.length).padStart(2)}/${urls.length}] ${status.padEnd(4)} ${(r.durationMs / 1000).toFixed(1).padStart(5)}s  ${r.category.padEnd(30)}${nameStr}${priceStr}${optStr}${errStr}`,
      );
    }
  }

  // Summary
  const passed = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const notFoundResults = failed.filter((r) => r.notFound);
  const nullResults = failed.filter((r) => !r.notFound && r.error === "null result");
  const invalidPrice = failed.filter((r) => !r.notFound && r.error?.startsWith("invalid price"));
  const invalidName = failed.filter((r) => !r.notFound && r.error === "invalid name");
  const thrownErrors = failed.filter(
    (r) =>
      !r.notFound
      && r.error !== "null result"
      && !r.error?.startsWith("invalid price")
      && r.error !== "invalid name",
  );
  const withOptions = results.filter((r) => r.optionCount > 0);
  const totalMs = results.reduce((a, r) => a + r.durationMs, 0);
  const sortedDurations = [...results.map((r) => r.durationMs)].sort((a, b) => a - b);
  const percentile = (p: number): number => {
    const idx = Math.min(
      sortedDurations.length - 1,
      Math.max(0, Math.ceil((p / 100) * sortedDurations.length) - 1),
    );
    return sortedDurations[idx] ?? 0;
  };
  const avgTime = totalMs / results.length;
  const p50 = percentile(50);
  const p95 = percentile(95);
  const p99 = percentile(99);
  const fastest = Math.min(...results.map((r) => r.durationMs));
  const slowest = Math.max(...results.map((r) => r.durationMs));
  const methodCounts = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.method ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const failureCodeCounts = failed.reduce<Record<string, number>>((acc, r) => {
    const key = r.failureCode ?? (r.notFound ? "not_found" : "unknown");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const avg = (values: number[]): number =>
    values.length > 0
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  const avgFirecrawlMs = avg(
    results
      .map((r) => r.timingFirecrawlMs)
      .filter((v): v is number => typeof v === "number"),
  );
  const avgBrowserbaseMs = avg(
    results
      .map((r) => r.timingBrowserbaseMs)
      .filter((v): v is number => typeof v === "number" && v > 0),
  );
  const avgVariantMs = avg(
    results
      .map((r) => r.timingVariantMs)
      .filter((v): v is number => typeof v === "number" && v > 0),
  );
  const avgFirecrawlAttempts = avg(
    results
      .map((r) => r.timingFirecrawlAttempts)
      .filter((v): v is number => typeof v === "number"),
  );

  console.log(`\n=== Summary ===`);
  console.log(`Total:        ${results.length}`);
  console.log(`Passed:       ${passed.length} (${((passed.length / results.length) * 100).toFixed(0)}%)`);
  console.log(`Failed:       ${failed.length}`);
  console.log(`  Not found:    ${notFoundResults.length}`);
  console.log(`  Null result:  ${nullResults.length}`);
  console.log(`  Bad price:    ${invalidPrice.length}`);
  console.log(`  Bad name:     ${invalidName.length}`);
  console.log(`  Errors:       ${thrownErrors.length}`);
  console.log(`W/ Options:   ${withOptions.length}`);
  console.log(`Avg Time:     ${(avgTime / 1000).toFixed(1)}s`);
  console.log(`P50 Time:     ${(p50 / 1000).toFixed(1)}s`);
  console.log(`P95 Time:     ${(p95 / 1000).toFixed(1)}s`);
  console.log(`P99 Time:     ${(p99 / 1000).toFixed(1)}s`);
  console.log(`Fastest:      ${(fastest / 1000).toFixed(1)}s`);
  console.log(`Slowest:      ${(slowest / 1000).toFixed(1)}s`);
  console.log(`Total Time:   ${(totalMs / 1000).toFixed(0)}s`);
  console.log(
    `Methods:      ${Object.entries(methodCounts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
  );
  console.log(
    `Failure codes:${Object.entries(failureCodeCounts)
      .map(([k, v]) => ` ${k}=${v}`)
      .join(",")}`,
  );
  console.log(`Avg stage ms: firecrawl=${avgFirecrawlMs.toFixed(1)}, browserbase=${avgBrowserbaseMs.toFixed(1)}, variant=${avgVariantMs.toFixed(1)}`);
  console.log(`Avg firecrawl attempts: ${avgFirecrawlAttempts.toFixed(2)}`);

  if (notFoundResults.length > 0) {
    console.log(`\n--- Not Found / Discontinued ---`);
    for (const f of notFoundResults) {
      console.log(`  [404] ${(f.durationMs / 1000).toFixed(1).padStart(5)}s  ${f.category}: ${f.url}`);
    }
  }

  const otherFailed = failed.filter((r) => !r.notFound);
  if (otherFailed.length > 0) {
    console.log(`\n--- Failed URLs ---`);
    for (const f of otherFailed) {
      const reason = f.error === "null result"
        ? "NULL"
        : f.error?.startsWith("invalid price")
          ? "BAD_PRICE"
          : f.error === "invalid name"
            ? "BAD_NAME"
          : "ERROR";
      console.log(`  [${reason}] ${(f.durationMs / 1000).toFixed(1).padStart(5)}s  ${f.category}: ${f.url}`);
      if (f.failureCode || f.failureStage) {
        console.log(
          `         code=${f.failureCode ?? "unknown"} stage=${f.failureStage ?? "unknown"}`,
        );
      }
      if (typeof f.timingFirecrawlMs === "number") {
        console.log(
          `         timing_ms total=${f.timingTotalMs ?? 0} firecrawl=${f.timingFirecrawlMs} browserbase=${f.timingBrowserbaseMs ?? 0} variant=${f.timingVariantMs ?? 0} attempts=${f.timingFirecrawlAttempts ?? 0}`,
        );
      }
      if (f.failureDetail) {
        console.log(`         detail=${f.failureDetail.slice(0, 160)}`);
      }
      if (reason === "ERROR") console.log(`         ${f.error}`);
    }
  }

  if (withOptions.length > 0) {
    console.log(`\n--- URLs with Options ---`);
    for (const r of withOptions) {
      console.log(`  ${r.category}: ${r.name}`);
      for (const o of r.options ?? []) {
        console.log(`    ${o}`);
      }
    }
  }
}

main().catch(console.error);
