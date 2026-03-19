/**
 * Live Diffbot Product API test against real product URLs.
 * Usage: pnpm tsx scripts/diffbot-live.ts
 *
 * Diffbot auto-extracts structured product data — zero schema config needed.
 * GET https://api.diffbot.com/v3/product?token=TOKEN&url=URL
 */
import "dotenv/config";

const DIFFBOT_TOKEN = process.env.DIFFBOT_TOKEN;
if (!DIFFBOT_TOKEN) {
  console.error("DIFFBOT_TOKEN is required. Add it to .env");
  process.exit(1);
}

const urls = [
  "https://www.allbirds.com/products/mens-tree-runners",
  "https://bombas.com/products/mens-tri-block-ankle-sock",
  "https://www.amazon.com/dp/B0D5CPLR2R",
  "https://www.target.com/p/stanley-quencher-h2-0-flowstate-tumbler-40oz/-/A-87790795",
];

interface DiffbotProduct {
  type: string;
  title: string;
  brand?: string;
  offerPrice?: string;
  offerPriceDetails?: {
    symbol?: string;
    amount?: number;
    text?: string;
  };
  regularPrice?: string;
  regularPriceDetails?: {
    symbol?: string;
    amount?: number;
    text?: string;
  };
  availability?: boolean;
  sku?: string;
  upc?: string;
  mpn?: string;
  category?: string;
  images?: Array<{
    url: string;
    primary?: boolean;
  }>;
  specs?: Record<string, string>;
  multipleProducts?: boolean;
}

interface DiffbotResponse {
  request: {
    pageUrl: string;
    api: string;
  };
  objects?: DiffbotProduct[];
}

async function testDiffbot(url: string): Promise<void> {
  const start = Date.now();
  const apiUrl = `https://api.diffbot.com/v3/product?token=${DIFFBOT_TOKEN}&url=${encodeURIComponent(url)}&timeout=30000`;

  const res = await fetch(apiUrl, {
    signal: AbortSignal.timeout(35_000),
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!res.ok) {
    const body = await res.text();
    console.log(`  FAILED (${res.status}): ${body.slice(0, 200)}`);
    return;
  }

  const data = (await res.json()) as DiffbotResponse;
  const product = data.objects?.[0];

  if (!product) {
    console.log(`  No product extracted (${elapsed}s)`);
    return;
  }

  console.log(`  Name:         ${product.title}`);
  console.log(`  Price:        ${product.offerPrice ?? "(none)"}`);
  if (product.offerPriceDetails?.amount) {
    console.log(`  Price (num):  ${product.offerPriceDetails.amount}`);
  }
  if (product.regularPrice && product.regularPrice !== product.offerPrice) {
    console.log(`  Orig Price:   ${product.regularPrice}`);
  }
  console.log(`  Brand:        ${product.brand ?? "(none)"}`);
  console.log(`  Available:    ${product.availability ?? "unknown"}`);
  console.log(`  SKU:          ${product.sku ?? "(none)"}`);
  console.log(`  UPC:          ${product.upc ?? "(none)"}`);
  console.log(`  Category:     ${product.category ?? "(none)"}`);
  console.log(`  Images:       ${product.images?.length ?? 0}`);
  console.log(`  Has variants: ${product.multipleProducts ?? false}`);
  if (product.specs) {
    const specKeys = Object.keys(product.specs);
    console.log(`  Specs:        ${specKeys.length} fields (${specKeys.slice(0, 5).join(", ")})`);
  }
  console.log(`  Time:         ${elapsed}s`);
}

// ---- Main ----

async function main() {
  console.log("=== Diffbot Product API ===\n");

  for (const url of urls) {
    const domain = new URL(url).hostname.replace("www.", "");
    console.log(`\n--- ${domain} ---`);
    console.log(`URL: ${url}`);
    await testDiffbot(url);
  }
}

main().catch(console.error);
