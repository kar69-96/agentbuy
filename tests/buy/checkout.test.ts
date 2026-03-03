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

  it("Bombas — add socks to cart + guest checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.bombas.com/products/womens-ankle-sock-4-pack",
      name: "Women's Ankle Sock 4-Pack",
      price: "49.80",
      selections: { Size: "M" },
    });
    const result = await runCheckout(buildInput(order));
    logResult("Bombas", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Glossier — Balm Dotcom checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.glossier.com/products/balm-dotcom",
      name: "Balm Dotcom",
      price: "19.00",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Glossier", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);
});

describe("Buy checkout — Major retailers", () => {
  it("Target — Stanley tumbler checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.target.com/p/stanley-quencher-h2-0-flowstate-tumbler-40oz/-/A-87154432",
      name: "Stanley Quencher H2.0 FlowState Tumbler 40oz",
      price: "20.00",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Target", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Best Buy — AirPods checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.bestbuy.com/site/apple-airpods-4-white/6447382.p",
      name: "Apple AirPods 4",
      price: "20.00",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Best Buy", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Walmart — Crayola crayons checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.walmart.com/ip/Crayola-Crayons-24-Ct-School-Supplies-for-Kids/17730162",
      name: "Crayola Crayons 24 Ct",
      price: "3.49",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Walmart", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Amazon — cheap item checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.amazon.com/dp/B0D1XD1ZV3",
      name: "Test Amazon Product",
      price: "15.00",
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

  it("Etsy — handmade item checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.etsy.com/listing/1055173658/personalized-leather-journal",
      name: "Personalized Leather Journal",
      price: "25.00",
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

  it("Home Depot — hardware item checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.homedepot.com/p/HDX-Yellow-Heavy-Duty-100-ft-12-3-Outdoor-Extension-Cord-HD-277-525/100661449",
      name: "HDX 100ft Extension Cord",
      price: "25.00",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Home Depot", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("B&H Photo — electronics checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.bhphotovideo.com/c/product/1773759-REG/sandisk_sdssde61_1t00_g25_1tb_extreme_portable_ssd.html",
      name: "SanDisk 1TB Extreme Portable SSD",
      price: "89.99",
    });
    const result = await runCheckout(buildInput(order));
    logResult("B&H Photo", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Apple — accessory checkout (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.apple.com/shop/product/MK2C3LL/A/magic-keyboard-with-touch-id-for-mac-models-with-apple-silicon",
      name: "Magic Keyboard with Touch ID",
      price: "199.00",
    });
    const result = await runCheckout(buildInput(order));
    logResult("Apple", result);

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

describe("Buy checkout — with variant selections", () => {
  it("Allbirds — specific size selection (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.allbirds.com/products/mens-tree-runners",
      name: "Men's Tree Runners",
      price: "100.00",
      selections: { Size: "10" },
    });
    const result = await runCheckout(buildInput(order));
    logResult("Allbirds (Size 10)", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);

  it("Allbirds — color + size selection (dry-run)", async () => {
    const order = buildOrder({
      url: "https://www.allbirds.com/products/mens-tree-runners",
      name: "Men's Tree Runners",
      price: "100.00",
      selections: { Color: "Basin Blue", Size: "10" },
    });
    const result = await runCheckout(buildInput(order));
    logResult("Allbirds (Basin Blue, Size 10)", result);

    expect(result.sessionId).toBeTruthy();
    expect(result.replayUrl).toContain("browserbase.com");
  }, 180_000);
});
