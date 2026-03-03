#!/usr/bin/env tsx
/**
 * Multi-URL checkout loop runner.
 * Runs dry-run checkouts against a curated set of URLs and logs structured results.
 *
 * Usage:
 *   pnpm test:checkout:loop              # run all URLs
 *   pnpm test:checkout:loop --tier 1     # run only tier 1
 *   pnpm test:checkout:loop --only 0     # run single URL by index
 */
import "dotenv/config";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCheckout } from "@bloon/checkout";
import type { CheckoutInput, CheckoutResult } from "@bloon/checkout";
import { getDefaultShipping } from "@bloon/core";
import type { Order } from "@bloon/core";

// ---- Test URLs ----

interface TestUrl {
  name: string;
  url: string;
  tier: 1 | 2 | 3;
  notes?: string;
}

const TEST_URLS: TestUrl[] = [
  // Tier 1 — Simple Shopify stores (guest checkout, minimal variants)
  {
    name: "Shopify — Ugmonk Gather (simple product)",
    url: "https://ugmonk.com/products/gather-basic-set-maple",
    tier: 1,
    notes: "Clean Shopify store, single product, no variant selection needed",
  },
  {
    name: "Shopify — Allbirds Socks",
    url: "https://www.allbirds.com/products/mens-trino-sprinter-anklet-socks",
    tier: 1,
    notes: "Shopify Plus, size selection required",
  },
  {
    name: "Shopify — Tentree T-shirt",
    url: "https://www.tentree.com/products/mens-tentree-logo-classic-t-shirt-meteorite-black",
    tier: 1,
    notes: "Shopify, size/color selection",
  },
  // Tier 2 — More complex flows
  {
    name: "Target — Scotch-Brite Sponges",
    url: "https://www.target.com/p/scotch-brite-zero-scratch-scrub-sponges/-/A-52893690",
    tier: 2,
    notes: "Multi-step checkout, address autocomplete, bot detection",
  },
  {
    name: "Best Buy — USB-C Cable",
    url: "https://www.bestbuy.com/site/insignia-6-usb-a-to-usb-c-charge-and-sync-cable-charcoal/6410839.p?skuId=6410839",
    tier: 2,
    notes: "Electronics, warranty upsells, multi-step",
  },
];

// ---- Parse CLI args ----

const args = process.argv.slice(2);
const tierArg = args.indexOf("--tier");
const onlyArg = args.indexOf("--only");

let selectedUrls = TEST_URLS;

if (tierArg !== -1 && args[tierArg + 1]) {
  const tier = parseInt(args[tierArg + 1], 10) as 1 | 2 | 3;
  selectedUrls = TEST_URLS.filter((t) => t.tier === tier);
}

if (onlyArg !== -1 && args[onlyArg + 1]) {
  const idx = parseInt(args[onlyArg + 1], 10);
  if (idx >= 0 && idx < TEST_URLS.length) {
    selectedUrls = [TEST_URLS[idx]];
  }
}

// ---- Resolve shipping ----

const shipping = getDefaultShipping();
if (!shipping) {
  console.error(
    "No shipping info: set SHIPPING_NAME + SHIPPING_STREET + ... env vars",
  );
  process.exit(1);
}

// ---- Run loop ----

interface RunResult {
  test: TestUrl;
  result?: CheckoutResult;
  error?: string;
  durationSec: string;
}

const results: RunResult[] = [];

console.log("=== Checkout Loop Runner ===");
console.log(`Sites:    ${selectedUrls.length}`);
console.log(`Shipping: ${shipping.name}, ${shipping.city}, ${shipping.state}`);
console.log();

for (const test of selectedUrls) {
  console.log(`--- [${test.name}] ---`);
  console.log(`URL:   ${test.url}`);
  console.log(`Tier:  ${test.tier}`);

  const order: Order = {
    order_id: `loop-${Date.now()}`,
    wallet_id: "test",
    status: "processing",
    product: {
      name: test.name,
      url: test.url,
      price: "0",
      source: new URL(test.url).hostname,
    },
    payment: {
      amount_usdc: "0",
      price: "0",
      fee: "0",
      fee_rate: "0",
      route: "browserbase",
    },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };

  const input: CheckoutInput = {
    order,
    shipping,
    dryRun: true,
    sessionOptions: { stealth: true, proxies: true, logSession: true },
  };

  const startMs = Date.now();
  try {
    const result = await runCheckout(input);
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    results.push({ test, result, durationSec: elapsed });

    const status = result.success ? "PASS" : "FAIL";
    console.log(`Result: ${status}`);
    if (result.failedStep) console.log(`Step:   ${result.failedStep}`);
    if (result.errorMessage) console.log(`Error:  ${result.errorMessage.slice(0, 150)}`);
    console.log(`Total:  ${result.finalTotal ?? "—"}`);
    console.log(`Replay: ${result.replayUrl}`);
    console.log(`Time:   ${elapsed}s`);
  } catch (err) {
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ test, error: msg, durationSec: elapsed });
    console.log(`Result: CRASH`);
    console.log(`Error:  ${msg.slice(0, 150)}`);
    console.log(`Time:   ${elapsed}s`);
  }

  console.log();
}

// ---- Summary table ----

const passed = results.filter((r) => r.result?.success).length;
const failed = results.length - passed;

console.log("=== SUMMARY ===");
console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
console.log();
console.log(
  "Site".padEnd(42) +
  "Result".padEnd(10) +
  "Failed Step".padEnd(24) +
  "Time".padEnd(8) +
  "Error",
);
console.log("-".repeat(120));

for (const r of results) {
  const status = r.error ? "CRASH" : r.result?.success ? "PASS" : "FAIL";
  const step = r.result?.failedStep ?? "—";
  const errMsg = (r.error ?? r.result?.errorMessage ?? "—").slice(0, 50);
  console.log(
    r.test.name.padEnd(42) +
    status.padEnd(10) +
    step.padEnd(24) +
    `${r.durationSec}s`.padEnd(8) +
    errMsg,
  );
}

// ---- Append to run log ----

const logPath = resolve(
  import.meta.dirname,
  "../../plans/testing/browserbase-refinement.md",
);

const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
const lines: string[] = [
  "",
  `### Loop Run — ${timestamp}`,
  "",
  `**Sites tested:** ${selectedUrls.length} | **Passed:** ${passed} | **Failed:** ${failed}`,
  "",
  "| Site | Tier | Result | Failed Step | Error | Duration | Replay |",
  "|------|------|--------|-------------|-------|----------|--------|",
];

for (const r of results) {
  const status = r.error ? "CRASH" : r.result?.success ? "PASS" : "FAIL";
  const step = r.result?.failedStep ?? "—";
  const errMsg = (r.error ?? r.result?.errorMessage ?? "—").slice(0, 80);
  const replay = r.result
    ? `[replay](${r.result.replayUrl})`
    : "—";
  lines.push(
    `| ${r.test.name} | ${r.test.tier} | ${status} | ${step} | ${errMsg} | ${r.durationSec}s | ${replay} |`,
  );
}

lines.push("", "---", "");

try {
  appendFileSync(logPath, lines.join("\n"));
  console.log(`\nRun logged to ${logPath}`);
} catch {
  console.warn("\nCould not append run log (non-fatal)");
}
