#!/usr/bin/env tsx
/**
 * Dry-run checkout test harness.
 *
 * Usage:
 *   pnpm test:checkout "https://some-store.com/products/widget"
 *   pnpm test:checkout "https://target.com/p/item" --shipping-json ./shipping.json
 */
import "dotenv/config";
import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCheckout } from "@proxo/checkout";
import type { CheckoutInput } from "@proxo/checkout";
import { getDefaultShipping } from "@proxo/core";
import type { ShippingInfo, Order } from "@proxo/core";

// ---- CLI args ----

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
if (!url) {
  console.error("Usage: pnpm test:checkout <product-url> [--shipping-json <path>]");
  process.exit(1);
}

let shippingOverride: ShippingInfo | undefined;
const jsonIdx = args.indexOf("--shipping-json");
if (jsonIdx !== -1 && args[jsonIdx + 1]) {
  const raw = readFileSync(resolve(args[jsonIdx + 1]), "utf-8");
  shippingOverride = JSON.parse(raw) as ShippingInfo;
}

// ---- Resolve shipping ----

const shipping = shippingOverride ?? getDefaultShipping();
if (!shipping) {
  console.error(
    "No shipping info: provide --shipping-json or set SHIPPING_NAME + env vars",
  );
  process.exit(1);
}

// ---- Build minimal Order for dry-run ----

const order: Order = {
  order_id: `dryrun-${Date.now()}`,
  wallet_id: "test",
  status: "processing",
  product: {
    name: "Dry-run test product",
    url,
    price: "0",
    source: new URL(url).hostname,
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

// ---- Run ----

const input: CheckoutInput = {
  order,
  shipping,
  dryRun: true,
  sessionOptions: { stealth: true, proxies: true, logSession: true },
};

console.log("=== Dry-Run Checkout Test ===");
console.log(`URL:      ${url}`);
console.log(`Shipping: ${shipping.name}, ${shipping.city}, ${shipping.state}`);
console.log();

const startMs = Date.now();
try {
  const result = await runCheckout(input);
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log("--- Result ---");
  console.log(`Success:    ${result.success}`);
  console.log(`Session:    ${result.sessionId}`);
  console.log(`Replay:     ${result.replayUrl}`);
  console.log(`Total:      ${result.finalTotal ?? "(not extracted)"}`);
  if (result.failedStep) {
    console.log(`Failed at:  ${result.failedStep}`);
  }
  if (result.errorMessage) {
    console.log(`Error:      ${result.errorMessage}`);
  }
  console.log(`Duration:   ${elapsed}s`);

  // ---- Append to run log ----
  const logPath = resolve(
    import.meta.dirname,
    "../../plans/testing/browserbase-refinement.md",
  );
  const entry = [
    "",
    `### Run — ${new Date().toISOString().replace("T", " ").slice(0, 16)}`,
    "",
    `**URL:** ${url}`,
    `**Session:** [${result.sessionId}](${result.replayUrl})`,
    `**Result:** ${result.success ? "SUCCESS (dry-run)" : "FAILURE"}`,
    ...(result.failedStep ? [`**Failed step:** ${result.failedStep}`] : []),
    ...(result.errorMessage ? [`**Error:** ${result.errorMessage.slice(0, 200)}`] : []),
    `**Extracted total:** ${result.finalTotal ?? "—"}`,
    `**Duration:** ${elapsed}s`,
    "",
    "---",
    "",
  ].join("\n");

  try {
    appendFileSync(logPath, entry);
    console.log(`\nRun logged to ${logPath}`);
  } catch {
    console.warn("Could not append run log (non-fatal)");
  }
} catch (err) {
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.error("--- FAILED ---");
  console.error(`Error:    ${err instanceof Error ? err.message : err}`);
  console.error(`Duration: ${elapsed}s`);
  process.exit(1);
}
