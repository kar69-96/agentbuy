/**
 * Buy endpoint e2e checkout tests.
 *
 * These tests assume query + approval have already happened.
 * They call runCheckout directly with a pre-built Order,
 * exercising the full Browserbase → Stagehand → checkout flow
 * as a dry-run (no real purchase).
 *
 * Requires: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, GOOGLE_API_KEY
 * (or ANTHROPIC_API_KEY depending on Stagehand model config)
 *
 * Run:
 *   pnpm vitest run tests/buy/checkout.test.ts
 *   pnpm vitest run tests/buy/checkout.test.ts -t "Target"
 */
import { describe, it, expect } from "vitest";
import { runCheckout } from "@bloon/checkout";
import type { CheckoutInput } from "@bloon/checkout";
import type { Order, ShippingInfo } from "@bloon/core";

// ---- Guard: fail hard if Browserbase keys are missing ----

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

requireEnv("BROWSERBASE_API_KEY");
requireEnv("BROWSERBASE_PROJECT_ID");
requireEnv("GOOGLE_API_KEY");

// ---- Shared fixtures ----

const TEST_SHIPPING: ShippingInfo = {
  name: "John Doe",
  street: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  country: "US",
  email: "john@example.com",
  phone: "5125550100",
};

function buildOrder(overrides: {
  url: string;
  name?: string;
  price?: string;
  selections?: Record<string, string>;
}): Order {
  const url = overrides.url;
  return {
    order_id: `test-${Date.now()}`,
    wallet_id: "bloon_w_test01",
    status: "processing",
    product: {
      name: overrides.name ?? "Test Product",
      url,
      price: overrides.price ?? "0",
      source: new URL(url).hostname,
    },
    payment: {
      amount_usdc: "0",
      price: overrides.price ?? "0",
      fee: "0",
      fee_rate: "0",
      route: "browserbase",
    },
    shipping: TEST_SHIPPING,
    selections: overrides.selections,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
}

function buildInput(
  order: Order,
  opts?: { dryRun?: boolean; selections?: Record<string, string> },
): CheckoutInput {
  return {
    order,
    shipping: TEST_SHIPPING,
    selections: opts?.selections ?? order.selections,
    dryRun: opts?.dryRun ?? true,
    sessionOptions: { stealth: true, proxies: true, logSession: true },
  };
}

function logResult(
  label: string,
  result: Awaited<ReturnType<typeof runCheckout>>,
): void {
  console.log(`\n--- ${label} ---`);
  console.log(`  Success:   ${result.success}`);
  console.log(`  Session:   ${result.sessionId}`);
  console.log(`  Replay:    ${result.replayUrl}`);
  console.log(`  Total:     ${result.finalTotal ?? "(not extracted)"}`);
  if (result.failedStep) console.log(`  Failed at: ${result.failedStep}`);
  if (result.errorMessage)
    console.log(`  Error:     ${result.errorMessage.slice(0, 200)}`);
  console.log(`  Duration:  ${(result.durationMs ?? 0) / 1000}s`);
}

// ---- Tests ----

describe("Buy checkout — Shopify stores", () => {
  it("Allbirds — add to cart + guest checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.allbirds.com/products/mens-tree-runners",
      name: "Men's Tree Runners",
      price: "100.00",
      selections: { Size: "10" },
    });
    const result = await runCheckout(buildInput(order));
    logResult("Allbirds", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("ColourPop — eyeshadow checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://colourpop.com/products/frog",
      name: "Super Shock Shadow Frog",
      price: "5.25",
    });
    const result = await runCheckout(buildInput(order));
    logResult("ColourPop", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Bombas — ankle sock checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://bombas.com/products/mens-tri-block-ankle-sock",
      name: "Men's Tri-Block Ankle Sock",
      price: "14.00",
      selections: { Size: "M" },
    });
    const result = await runCheckout(buildInput(order));
    logResult("Bombas", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);
});

describe("Buy checkout — Major retailers", () => {
  it("Cotopaxi — Allpita Mini Bag checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.cotopaxi.com/products/allpita-mini-bag-del-dia",
      name: "Allpita Mini Bag - Del Dia",
      price: "15.00",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Cotopaxi", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Patagonia — headband checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.patagonia.com/product/re-tool-fleece-headband/22251.html",
      name: "Re-Tool Fleece Headband",
      price: "25.00",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Patagonia", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("REI — merino socks checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.rei.com/product/165398/rei-co-op-merino-wool-lightweight-hiking-crew-socks",
      name: "REI Co-op Merino Wool Hiking Crew Socks",
      price: "18.95",
    });
    const result = await runCheckout(buildInput(order));
    logResult("REI", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Best Buy — Apple USB-C cable checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.bestbuy.com/product/apple-usb-c-woven-charge-cable-1m-white/JJGCQ3YKVW",
      name: "Apple USB-C Woven Charge Cable (1m)",
      price: "14.99",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Best Buy", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Amazon — Reebok Vintage Sneakers checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.amazon.com/Reebok-Vintage-Sneakers-Top-Chalk-Paperwhite/dp/B07DPL9H6H",
      name: "Reebok Vintage Sneakers",
      price: "84.99",
      selections: { Size: "10" },
    });
    const result = await runCheckout(buildInput(order));
    logResult("Amazon", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);
});

describe("Buy checkout — Specialty / niche stores", () => {
  it("Nike — Air Force 1 checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.nike.com/t/air-force-1-07-mens-shoes-5QFp5Z/CW2288-111",
      name: "Nike Air Force 1 '07",
      price: "115.00",
      selections: { Size: "10" },
    });
    const result = await runCheckout(buildInput(order));
    logResult("Nike", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Etsy — shark stud earrings checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.etsy.com/listing/1560610481/mismatched-shark-stud-screw-back-flat",
      name: "Mismatched Shark Stud Earrings",
      price: "18.08",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Etsy", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Nordstrom — apparel checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.nordstrom.com/s/zella-live-in-high-waist-leggings/4312529",
      name: "Zella Live In High Waist Leggings",
      price: "59.00",
      selections: { Size: "M" },
    });
    const result = await runCheckout(buildInput(order));
    logResult("Nordstrom", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Adafruit — resistor pack checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.adafruit.com/product/4294",
      name: "Through-Hole Resistors 1.0K ohm 5% 1/4W Pack of 25",
      price: "0.75",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Adafruit", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("MVMT — watch strap checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.mvmt.com/strap-guide/mens-strap-guide/field/field---22mm-grey-nylon/M0492.html",
      name: "Field 22mm Grey Nylon Watch Strap",
      price: "19.20",
    });
    const result = await runCheckout(buildInput(order));
    logResult("MVMT", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Anker — USB-C cable checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.anker.com/products/a8752",
      name: "2-Pack Nylon USB-C to USB-C Cable 3.3ft",
      price: "9.99",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Anker", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);
});

describe("Buy checkout — Donation / payment-only", () => {
  it("Wikipedia — donation flow (dry-run)", async () => {
    const order = buildOrder({
      url: "https://donate.wikimedia.org/",
      name: "Wikipedia Donation",
      price: "5.00",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Wikipedia", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Stripe — payment demo checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://stripe-payments-demo.appspot.com",
      name: "Stripe Payments Demo",
      price: "10.00",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Stripe", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);
});

