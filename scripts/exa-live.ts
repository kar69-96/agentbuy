/**
 * Quick live Exa discovery test against real URLs.
 * Usage: pnpm tsx scripts/exa-live.ts
 */
import "dotenv/config";
import { discoverViaExa } from "../packages/crawling/src/exa-extract.js";

const urls = [
  "https://www.allbirds.com/products/mens-tree-runners",
  "https://bombas.com/products/mens-tri-block-ankle-sock",
  "https://www.amazon.com/dp/B0D5CPLR2R",
  "https://www.target.com/p/stanley-quencher-h2-0-flowstate-tumbler-40oz/-/A-87790795",
];

async function main() {
  for (const url of urls) {
    const domain = new URL(url).hostname.replace("www.", "");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Testing: ${domain}`);
    console.log(`URL: ${url}`);
    console.log("=".repeat(60));

    const start = Date.now();
    const result = await discoverViaExa(url);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (!result) {
      console.log(`  Result: NULL (${elapsed}s)`);
      continue;
    }

    console.log(`  Name:     ${result.name}`);
    console.log(`  Price:    ${result.price}`);
    console.log(`  Brand:    ${result.brand ?? "(none)"}`);
    console.log(`  Currency: ${result.currency ?? "(none)"}`);
    console.log(`  Image:    ${result.image_url ? "yes" : "no"}`);
    console.log(`  Options:  ${result.options.length} groups`);
    for (const opt of result.options) {
      const prices = opt.prices
        ? ` (prices: ${Object.keys(opt.prices).length})`
        : "";
      console.log(`    - ${opt.name}: ${opt.values.length} values${prices}`);
    }
    console.log(`  Time:     ${elapsed}s`);
  }
}

main().catch(console.error);
