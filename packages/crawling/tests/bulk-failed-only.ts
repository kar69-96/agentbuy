/**
 * Quick re-test of only the previously-failed URLs from the bulk test.
 * Baseline: 20/61 passed, these 41 failed.
 *
 * Usage: set -a && source .env && set +a && BULK_TEST_CONCURRENCY=1 npx tsx packages/crawling/tests/bulk-failed-only.ts
 */

import { discoverViaFirecrawl } from "../src/discover.js";
import { isValidPrice } from "../src/helpers.js";

process.env.FIRECRAWL_API_KEY ??= "fc-selfhosted";
process.env.FIRECRAWL_BASE_URL ??= "http://localhost:3002";

const failedUrls = [
  // Previously failed — WAF / Cloudflare / Akamai
  { url: "https://www.gymshark.com/products/gymshark-vital-seamless-2-0-leggings-black-ss22", category: "Shopify / Activewear" },
  { url: "https://www.brooklinen.com/products/classic-core-sheet-set", category: "Shopify / Bedding" },
  { url: "https://www.bombas.com/products/womens-gripper-ankle-sock-6-pack", category: "Shopify / Socks" },
  { url: "https://www.ruggable.com/products/solid-navy-blue-rug", category: "Shopify / Rugs" },
  { url: "https://www.chubbiesshorts.com/products/the-flint-stones", category: "Shopify / Shorts" },
  { url: "https://www.nativecos.com/products/coconut-vanilla-deodorant", category: "Shopify / Personal care" },
  { url: "https://www.hydroflask.com/32-oz-wide-mouth", category: "Shopify / Bottles" },

  // Fashion / Apparel
  { url: "https://www.zara.com/us/en/cotton-t-shirt-p00722325.html", category: "Zara / T-shirt" },
  { url: "https://www2.hm.com/en_us/productpage.0970818001.html", category: "H&M / Apparel" },
  { url: "https://www.uniqlo.com/us/en/products/E449982-000/00", category: "Uniqlo / Apparel" },
  { url: "https://www.adidas.com/us/ultraboost-5-shoes/HQ6437.html", category: "Adidas / Shoes" },
  { url: "https://www.nordstrom.com/s/nike-dunk-low-retro-sneaker-men/6579130", category: "Nordstrom / Shoes" },
  { url: "https://www.gap.com/browse/product.do?pid=795187012", category: "Gap / Apparel" },

  // Electronics
  { url: "https://www.apple.com/shop/buy-iphone/iphone-16", category: "Apple / Phone" },
  { url: "https://store.google.com/us/product/pixel_9", category: "Google / Phone" },
  { url: "https://www.bose.com/p/headphones/bose-quietcomfort-ultra-headphones/QCUH-HEADPHONEARN.html", category: "Bose / Headphones" },
  { url: "https://www.sony.com/en/headphones/wh-1000xm5", category: "Sony / Headphones" },
  { url: "https://www.anker.com/products/a2337-usb-c-charger-67w", category: "Anker / Charger" },

  // Home / Furniture
  { url: "https://www.cb2.com/taper-black-marble-side-table/s547916", category: "CB2 / Furniture" },
  { url: "https://www.westelm.com/products/mid-century-bedside-table-h433/", category: "West Elm / Furniture" },

  // Grocery / Food
  { url: "https://www.instacart.com/store/whole-foods-market/product_page/365-by-whole-foods-market-organic-whole-milk-1-gal", category: "Instacart / Grocery" },
  { url: "https://www.thrive.market/p/primal-kitchen-classic-bbq-sauce", category: "Thrive / Food" },

  // Beauty / Skincare
  { url: "https://www.ulta.com/p/dream-cream-body-lotion-pimprod2003346", category: "Ulta / Skincare" },

  // Sporting goods / Outdoor
  { url: "https://www.yeti.com/drinkware/bottles/21071501392.html", category: "Yeti / Drinkware" },
  { url: "https://www.thenorthface.com/en-us/mens/mens-jackets-and-vests/mens-fleece-c210237/m-denali-jacket-pNF0A7UR2", category: "North Face / Jacket" },

  // Books / Media
  { url: "https://www.barnesandnoble.com/w/project-hail-mary-andy-weir/1137396811", category: "B&N / Book" },

  // Pet
  { url: "https://www.chewy.com/dp/54226", category: "Chewy / Pet food" },

  // Specialty / DTC
  { url: "https://www.warbyparker.com/eyeglasses/women/durand/crystal", category: "Warby Parker / Glasses" },
  { url: "https://www.casper.com/mattresses/original/", category: "Casper / Mattress" },
  { url: "https://www.away.com/suitcases/the-carry-on", category: "Away / Luggage" },
  { url: "https://www.everlane.com/products/mens-premium-weight-crew-tee-black", category: "Everlane / Apparel" },
  { url: "https://www.aesop.com/us/p/skin/hydrate/camellia-nut-facial-hydrating-cream/", category: "Aesop / Skincare" },
  { url: "https://www.lego.com/en-us/product/eiffel-tower-10307", category: "Lego / Toys" },
  { url: "https://www.dyson.com/vacuum-cleaners/cordless/v15/detect-absolute-yellow-iron", category: "Dyson / Vacuum" },

  // International
  { url: "https://www.asos.com/us/asos-design/asos-design-oversized-t-shirt-in-black/prd/203426899", category: "ASOS / Apparel" },
  { url: "https://www.decathlon.com/products/mens-mountain-hiking-waterproof-jacket-mh500", category: "Decathlon / Outdoor" },
  { url: "https://www.muji.com/us/products/cmdty/detail/4550344592045", category: "Muji / Home" },

  // Supplements / Health
  { url: "https://www.iherb.com/pr/nature-s-way-alive-once-daily-multi-vitamin-ultra-potency-60-tablets/14811", category: "iHerb / Vitamins" },

  // Marketplace
  { url: "https://www.etsy.com/listing/1020399732/custom-name-necklace-personalized", category: "Etsy / Jewelry" },
  { url: "https://www.ebay.com/itm/394944449784", category: "eBay / Marketplace" },
  { url: "https://www.target.com/p/apple-airpods-pro-2nd-generation/-/A-85978612", category: "Target / Electronics" },
  { url: "https://www.walmart.com/ip/Crayola-96ct-Crayons/17801992", category: "Walmart / Toys" },
  { url: "https://www.costco.com/kirkland-signature-organic-extra-virgin-olive-oil%2C-2-l.product.100334841.html", category: "Costco / Grocery" },
];

const CONCURRENCY = parseInt(process.env.BULK_TEST_CONCURRENCY ?? "1", 10);

interface TestResult {
  url: string;
  category: string;
  success: boolean;
  name?: string;
  price?: string;
  priceValid: boolean;
  error?: string;
  durationMs: number;
}

async function runTest(entry: { url: string; category: string }): Promise<TestResult> {
  const start = Date.now();
  try {
    const result = await discoverViaFirecrawl(entry.url);
    const durationMs = Date.now() - start;
    if (!result) {
      return { url: entry.url, category: entry.category, success: false, priceValid: false, error: "null result", durationMs };
    }
    const priceValid = isValidPrice(result.price);
    return {
      url: entry.url, category: entry.category, success: priceValid,
      name: result.name, price: result.price, priceValid,
      error: priceValid ? undefined : `invalid price: "${result.price}"`,
      durationMs,
    };
  } catch (err: any) {
    return { url: entry.url, category: entry.category, success: false, priceValid: false, error: err?.message ?? String(err), durationMs: Date.now() - start };
  }
}

async function main() {
  console.log(`\n=== Re-test Previously Failed URLs ===`);
  console.log(`URLs: ${failedUrls.length} (all previously failed) | Concurrency: ${CONCURRENCY}\n`);

  const results: TestResult[] = [];
  const queue = [...failedUrls];

  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map(runTest));
    for (const r of batchResults) {
      results.push(r);
      const status = r.success ? "NEW PASS" : "FAIL";
      const priceStr = r.price ? ` $${r.price}` : "";
      const nameStr = r.name ? ` "${r.name.slice(0, 50)}"` : "";
      const errStr = r.error ? ` (${r.error.slice(0, 60)})` : "";
      console.log(
        `[${String(results.length).padStart(2)}/${failedUrls.length}] ${status.padEnd(8)} ${(r.durationMs / 1000).toFixed(1).padStart(5)}s  ${r.category.padEnd(30)}${nameStr}${priceStr}${errStr}`,
      );
    }
  }

  const newPasses = results.filter((r) => r.success);
  const stillFailing = results.filter((r) => !r.success);
  const nullResults = stillFailing.filter((r) => r.error === "null result");
  const badPrices = stillFailing.filter((r) => r.error?.startsWith("invalid price"));
  const errors = stillFailing.filter((r) => r.error !== "null result" && !r.error?.startsWith("invalid price"));
  const totalMs = results.reduce((a, r) => a + r.durationMs, 0);

  console.log(`\n=== Summary ===`);
  console.log(`Previously failed:  ${failedUrls.length}`);
  console.log(`Now passing:        ${newPasses.length} (${((newPasses.length / failedUrls.length) * 100).toFixed(0)}% recovery)`);
  console.log(`Still failing:      ${stillFailing.length}`);
  console.log(`  Null result:      ${nullResults.length}`);
  console.log(`  Bad price:        ${badPrices.length}`);
  console.log(`  Errors:           ${errors.length}`);
  console.log(`Total time:         ${(totalMs / 1000).toFixed(0)}s`);
  console.log(`\nProjected overall:  ${20 + newPasses.length}/61 (${(((20 + newPasses.length) / 61) * 100).toFixed(0)}%)`);

  if (newPasses.length > 0) {
    console.log(`\n--- Newly Passing ---`);
    for (const r of newPasses) {
      console.log(`  ${r.category}: "${r.name}" $${r.price}`);
    }
  }

  if (stillFailing.length > 0) {
    console.log(`\n--- Still Failing ---`);
    for (const f of stillFailing) {
      const reason = f.error === "null result" ? "NULL" : f.error?.startsWith("invalid price") ? "BAD_PRICE" : "ERROR";
      console.log(`  [${reason}] ${f.category}: ${f.url}`);
    }
  }
}

main().catch(console.error);
