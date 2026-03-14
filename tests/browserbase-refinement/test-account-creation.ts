#!/usr/bin/env tsx
/**
 * Account creation fallback test harness.
 *
 * Tests the login-gate → account creation flow on sites that
 * require an account to checkout (no guest checkout option).
 *
 * Requires env vars:
 *   AGENTMAIL_ADDRESS   — fixed email for account creation
 *   AGENTMAIL_PASSWORD   — fixed password for account creation
 *   AGENTMAIL_API_KEY    — for polling verification codes
 *   BROWSERBASE_API_KEY  — Browserbase cloud browser
 *   BROWSERBASE_PROJECT_ID
 *   ANTHROPIC_API_KEY    — for Stagehand LLM
 *   + standard shipping env vars (SHIPPING_NAME, etc.)
 *
 * Usage:
 *   pnpm test:account-creation                   # run all URLs
 *   pnpm test:account-creation --only 0          # single URL by index
 *   pnpm test:account-creation "https://..."     # custom URL
 */
import "dotenv/config";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCheckout } from "@bloon/checkout";
import type { CheckoutInput, CheckoutResult } from "@bloon/checkout";
import { getDefaultShipping } from "@bloon/core";
import type { Order } from "@bloon/core";

// ---- Preflight checks ----

const REQUIRED_VARS = [
  "AGENTMAIL_ADDRESS",
  "AGENTMAIL_PASSWORD",
  "AGENTMAIL_API_KEY",
  "BROWSERBASE_API_KEY",
  "BROWSERBASE_PROJECT_ID",
];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// ---- Test URLs — sites that require login (no guest checkout) ----

interface TestUrl {
  name: string;
  url: string;
  notes?: string;
}

const TEST_URLS: TestUrl[] = [
  {
    name: "Target — Scotch-Brite Sponges",
    url: "https://www.target.com/p/scotch-brite-zero-scratch-scrub-sponges/-/A-52893690",
    notes:
      "Target requires login or guest; tests account creation fallback when guest is unavailable",
  },
  {
    name: "Amazon — USB Cable",
    url: "https://www.amazon.com/dp/B01GGKYKQM",
    notes: "Amazon requires sign-in for checkout, no guest option",
  },
];

// ---- Parse CLI args ----

const args = process.argv.slice(2);
const onlyArg = args.indexOf("--only");
const customUrl = args.find((a) => !a.startsWith("--") && a.startsWith("http"));

let selectedUrls: TestUrl[];

if (customUrl) {
  selectedUrls = [
    {
      name: `Custom URL`,
      url: customUrl,
      notes: "User-provided URL",
    },
  ];
} else if (onlyArg !== -1 && args[onlyArg + 1]) {
  const idx = parseInt(args[onlyArg + 1], 10);
  if (idx >= 0 && idx < TEST_URLS.length) {
    selectedUrls = [TEST_URLS[idx]!];
  } else {
    console.error(`Index ${idx} out of range (0–${TEST_URLS.length - 1})`);
    process.exit(1);
  }
} else {
  selectedUrls = TEST_URLS;
}

// ---- Resolve shipping ----

const shipping = getDefaultShipping();
if (!shipping) {
  console.error(
    "No shipping info: set SHIPPING_NAME + SHIPPING_STREET + etc. in .env",
  );
  process.exit(1);
}

// ---- Run tests ----

interface RunResult {
  name: string;
  url: string;
  success: boolean;
  failedStep?: string;
  error?: string;
  sessionId?: string;
  replayUrl?: string;
  durationSec: string;
  accountCreated?: boolean;
}

const results: RunResult[] = [];

console.log("=== Account Creation Checkout Test ===");
console.log(`Agent email:  ${process.env.AGENTMAIL_ADDRESS}`);
console.log(
  `Shipping:     ${shipping.name}, ${shipping.city}, ${shipping.state}`,
);
console.log(`URLs to test: ${selectedUrls.length}`);
console.log();

for (const testUrl of selectedUrls) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${testUrl.name}`);
  console.log(`URL:     ${testUrl.url}`);
  if (testUrl.notes) console.log(`Notes:   ${testUrl.notes}`);
  console.log("=".repeat(60));

  const order: Order = {
    order_id: `acct-test-${Date.now()}`,
    wallet_id: "test",
    status: "processing",
    product: {
      name: testUrl.name,
      url: testUrl.url,
      price: "0",
      source: new URL(testUrl.url).hostname,
    },
    payment: {
      amount_usdc: "0",
      price: "0",
      fee: "0",
      fee_rate: "0",
      route: "browserbase",
    },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };

  const input: CheckoutInput = {
    order,
    shipping,
    dryRun: true,
    sessionOptions: { stealth: true, proxies: true, logSession: true },
  };

  const startMs = Date.now();
  let result: CheckoutResult | null = null;

  try {
    result = await runCheckout(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      name: testUrl.name,
      url: testUrl.url,
      success: false,
      error: `CRASH: ${msg.slice(0, 200)}`,
      durationSec: ((Date.now() - startMs) / 1000).toFixed(1),
    });
    console.error(`  CRASH: ${msg.slice(0, 200)}`);
    continue;
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  results.push({
    name: testUrl.name,
    url: testUrl.url,
    success: result.success,
    failedStep: result.failedStep,
    error: result.errorMessage?.slice(0, 200),
    sessionId: result.sessionId,
    replayUrl: result.replayUrl,
    durationSec: elapsed,
  });

  console.log(`  Result:     ${result.success ? "PASS" : "FAIL"}`);
  console.log(`  Session:    ${result.sessionId}`);
  console.log(`  Replay:     ${result.replayUrl}`);
  if (result.finalTotal) console.log(`  Total:      ${result.finalTotal}`);
  if (result.failedStep) console.log(`  Failed at:  ${result.failedStep}`);
  if (result.errorMessage)
    console.log(`  Error:      ${result.errorMessage.slice(0, 150)}`);
  console.log(`  Duration:   ${elapsed}s`);
}

// ---- Summary ----

console.log(`\n\n${"=".repeat(60)}`);
console.log("ACCOUNT CREATION TEST SUMMARY");
console.log("=".repeat(60));
console.log();

const passed = results.filter((r) => r.success).length;
const failed = results.filter((r) => !r.success).length;
console.log(
  `Total: ${results.length}  |  Passed: ${passed}  |  Failed: ${failed}`,
);
console.log();

console.log("| Site | Result | Failed Step | Error | Duration | Replay |");
console.log("|------|--------|-------------|-------|----------|--------|");
for (const r of results) {
  const status = r.success ? "PASS" : "FAIL";
  const step = r.failedStep ?? "—";
  const err = r.error?.slice(0, 60) ?? "—";
  const replay = r.replayUrl ? `[link](${r.replayUrl})` : "—";
  console.log(
    `| ${r.name} | ${status} | ${step} | ${err} | ${r.durationSec}s | ${replay} |`,
  );
}

// ---- Log to file ----

const logPath = resolve(
  import.meta.dirname,
  "../../plans/testing/browserbase-refinement.md",
);

const entry = [
  "",
  `### Account Creation Test — ${new Date().toISOString().replace("T", " ").slice(0, 16)}`,
  "",
  `**Agent email:** ${process.env.AGENTMAIL_ADDRESS}`,
  `**Results:** ${passed}/${results.length} passed`,
  "",
  "| Site | Result | Failed Step | Error | Duration | Replay |",
  "|------|--------|-------------|-------|----------|--------|",
  ...results.map((r) => {
    const status = r.success ? "PASS" : "FAIL";
    const step = r.failedStep ?? "—";
    const err = r.error?.slice(0, 80) ?? "—";
    const replay = r.replayUrl ? `[link](${r.replayUrl})` : "—";
    return `| ${r.name} | ${status} | ${step} | ${err} | ${r.durationSec}s | ${replay} |`;
  }),
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

process.exit(failed > 0 ? 1 : 0);
