import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ShippingInfo } from "@bloon/core";

// ---- Mock external packages ----

vi.mock("@bloon/x402", () => ({
  detectRoute: vi.fn(),
}));

vi.mock("@bloon/wallet", () => ({
  getBalance: vi.fn(),
}));

vi.mock("@bloon/checkout", () => ({
  discoverPrice: vi.fn(),
}));

import { detectRoute } from "@bloon/x402";
import { getBalance } from "@bloon/wallet";
import { discoverPrice } from "@bloon/checkout";
import { buy } from "../src/buy.js";

const mockedDetectRoute = vi.mocked(detectRoute);
const mockedGetBalance = vi.mocked(getBalance);
const mockedDiscoverPrice = vi.mocked(discoverPrice);

// ---- Test helpers ----

let tmpDir: string;

const TEST_WALLET_ID = "bloon_w_test01";
const TEST_ADDRESS = "0x" + "a".repeat(40);

function setupWallet(): void {
  const walletsPath = path.join(tmpDir, "wallets.json");
  fs.writeFileSync(
    walletsPath,
    JSON.stringify({
      wallets: [
        {
          wallet_id: TEST_WALLET_ID,
          address: TEST_ADDRESS,
          private_key: "0x" + "b".repeat(64),
          funding_token: "tok_test",
          network: "base-sepolia",
          agent_name: "TestAgent",
          created_at: new Date().toISOString(),
        },
      ],
    }),
  );
}

function setupConfig(): void {
  const configPath = path.join(tmpDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      master_wallet: {
        address: "0x" + "c".repeat(40),
        private_key: "0x" + "d".repeat(64),
      },
      network: "base-sepolia",
      usdc_contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      max_transaction_amount: 25,
      default_order_expiry_seconds: 300,
      port: 3000,
    }),
  );
}

const testShipping: ShippingInfo = {
  name: "Test User",
  street: "123 Main St",
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
  email: "test@test.com",
  phone: "+10001112222",
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloon-buy-test-"));
  process.env.BLOON_DATA_DIR = tmpDir;
  setupWallet();
  setupConfig();
  vi.clearAllMocks();
  // Clear shipping defaults
  delete process.env.SHIPPING_NAME;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.BLOON_DATA_DIR;
});

// ---- Tests ----

describe("buy", () => {
  it("buy x402 URL returns order with route x402 and 2% fee", async () => {
    mockedDetectRoute.mockResolvedValue({
      route: "x402",
      requirements: {
        scheme: "exact",
        network: "eip155:84532",
        maxAmountRequired: "0.10",
        payTo: "0x" + "e".repeat(40),
        asset: "USDC",
        description: "Echo Service",
      },
    });
    mockedGetBalance.mockResolvedValue("10.00");

    const order = await buy({
      url: "https://x402.example.com/api",
      wallet_id: TEST_WALLET_ID,
    });

    expect(order.payment.route).toBe("x402");
    expect(order.payment.price).toBe("0.10");
    expect(order.payment.fee).toBe("0.002");
    expect(order.payment.fee_rate).toBe("2%");
    expect(order.product.name).toBe("Echo Service");
    expect(order.status).toBe("awaiting_confirmation");
    expect(order.shipping).toBeUndefined();
  });

  it("buy normal URL returns order with route browserbase and 2% fee", async () => {
    mockedDetectRoute.mockResolvedValue({ route: "browserbase" });
    mockedDiscoverPrice.mockResolvedValue({
      name: "Test Product",
      price: "17.99",
      method: "scrape",
    });
    mockedGetBalance.mockResolvedValue("50.00");

    const order = await buy({
      url: "https://shop.example.com/product/123",
      wallet_id: TEST_WALLET_ID,
      shipping: testShipping,
    });

    expect(order.payment.route).toBe("browserbase");
    expect(order.payment.price).toBe("17.99");
    expect(order.payment.fee).toBe("0.36");
    expect(order.payment.fee_rate).toBe("2%");
    expect(order.product.name).toBe("Test Product");
    expect(order.shipping).toEqual(testShipping);
  });

  it("buy browserbase without shipping and no defaults throws SHIPPING_REQUIRED", async () => {
    mockedDetectRoute.mockResolvedValue({ route: "browserbase" });

    await expect(
      buy({
        url: "https://shop.example.com/product/123",
        wallet_id: TEST_WALLET_ID,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "SHIPPING_REQUIRED" }));
  });

  it("buy browserbase without shipping uses env defaults", async () => {
    process.env.SHIPPING_NAME = "Default User";
    process.env.SHIPPING_STREET = "456 Elm St";
    process.env.SHIPPING_CITY = "Boulder";
    process.env.SHIPPING_STATE = "CO";
    process.env.SHIPPING_ZIP = "80301";
    process.env.SHIPPING_COUNTRY = "US";
    process.env.SHIPPING_EMAIL = "default@test.com";
    process.env.SHIPPING_PHONE = "+10009998888";

    mockedDetectRoute.mockResolvedValue({ route: "browserbase" });
    mockedDiscoverPrice.mockResolvedValue({
      name: "Default Ship Product",
      price: "10.00",
      method: "scrape",
    });
    mockedGetBalance.mockResolvedValue("50.00");

    const order = await buy({
      url: "https://shop.example.com/product/456",
      wallet_id: TEST_WALLET_ID,
    });

    expect(order.shipping).toBeDefined();
    expect(order.shipping!.name).toBe("Default User");
    expect(order.shipping!.city).toBe("Boulder");
  });

  it("buy with explicit shipping uses provided shipping", async () => {
    mockedDetectRoute.mockResolvedValue({ route: "browserbase" });
    mockedDiscoverPrice.mockResolvedValue({
      name: "Explicit Ship Product",
      price: "15.00",
      method: "scrape",
    });
    mockedGetBalance.mockResolvedValue("50.00");

    const order = await buy({
      url: "https://shop.example.com/product/789",
      wallet_id: TEST_WALLET_ID,
      shipping: testShipping,
    });

    expect(order.shipping).toEqual(testShipping);
  });

  it("buy x402 does not require shipping", async () => {
    mockedDetectRoute.mockResolvedValue({
      route: "x402",
      requirements: {
        scheme: "exact",
        network: "eip155:84532",
        maxAmountRequired: "1.00",
        payTo: "0x" + "e".repeat(40),
        asset: "USDC",
      },
    });
    mockedGetBalance.mockResolvedValue("10.00");

    // No shipping provided, no env defaults — should still succeed
    const order = await buy({
      url: "https://x402.example.com/api",
      wallet_id: TEST_WALLET_ID,
    });

    expect(order.payment.route).toBe("x402");
    expect(order.shipping).toBeUndefined();
  });

  it("buy unfunded wallet throws INSUFFICIENT_BALANCE", async () => {
    mockedDetectRoute.mockResolvedValue({
      route: "x402",
      requirements: {
        scheme: "exact",
        network: "eip155:84532",
        maxAmountRequired: "5.00",
        payTo: "0x" + "e".repeat(40),
        asset: "USDC",
      },
    });
    mockedGetBalance.mockResolvedValue("0.00");

    await expect(
      buy({
        url: "https://x402.example.com/api",
        wallet_id: TEST_WALLET_ID,
      }),
    ).rejects.toThrow(
      expect.objectContaining({ code: "INSUFFICIENT_BALANCE" }),
    );
  });

  it("buy with selections stores them on order", async () => {
    mockedDetectRoute.mockResolvedValue({ route: "browserbase" });
    mockedDiscoverPrice.mockResolvedValue({
      name: "Sneaker",
      price: "19.99",
      method: "scrape",
    });
    mockedGetBalance.mockResolvedValue("50.00");

    const order = await buy({
      url: "https://shop.example.com/sneaker",
      wallet_id: TEST_WALLET_ID,
      shipping: testShipping,
      selections: { Color: "Charcoal", Size: "10" },
    });

    expect(order.selections).toEqual({ Color: "Charcoal", Size: "10" });
  });

  it("buy with empty shipping.email throws MISSING_FIELD", async () => {
    mockedDetectRoute.mockResolvedValue({ route: "browserbase" });
    mockedDiscoverPrice.mockResolvedValue({
      name: "Widget",
      price: "10.00",
      method: "scrape",
    });
    mockedGetBalance.mockResolvedValue("50.00");

    await expect(
      buy({
        url: "https://shop.example.com/widget",
        wallet_id: TEST_WALLET_ID,
        shipping: { ...testShipping, email: "" },
      }),
    ).rejects.toThrow(
      expect.objectContaining({ code: "MISSING_FIELD" }),
    );
  });

  it("buy with blank selection value throws INVALID_SELECTION", async () => {
    mockedDetectRoute.mockResolvedValue({ route: "browserbase" });
    mockedDiscoverPrice.mockResolvedValue({
      name: "Widget",
      price: "10.00",
      method: "scrape",
    });
    mockedGetBalance.mockResolvedValue("50.00");

    await expect(
      buy({
        url: "https://shop.example.com/widget",
        wallet_id: TEST_WALLET_ID,
        shipping: testShipping,
        selections: { Color: "" },
      }),
    ).rejects.toThrow(
      expect.objectContaining({ code: "INVALID_SELECTION" }),
    );
  });

  it("buy x402 with selections still succeeds (selections ignored at checkout)", async () => {
    mockedDetectRoute.mockResolvedValue({
      route: "x402",
      requirements: {
        scheme: "exact",
        network: "eip155:84532",
        maxAmountRequired: "1.00",
        payTo: "0x" + "e".repeat(40),
        asset: "USDC",
      },
    });
    mockedGetBalance.mockResolvedValue("10.00");

    const order = await buy({
      url: "https://x402.example.com/api",
      wallet_id: TEST_WALLET_ID,
      selections: { Color: "Red" },
    });

    expect(order.payment.route).toBe("x402");
    expect(order.shipping).toBeUndefined();
    // Selections are stored on order but unused for x402 route
  });

  it("buy price > $25 throws PRICE_EXCEEDS_LIMIT", async () => {
    mockedDetectRoute.mockResolvedValue({
      route: "x402",
      requirements: {
        scheme: "exact",
        network: "eip155:84532",
        maxAmountRequired: "30.00",
        payTo: "0x" + "e".repeat(40),
        asset: "USDC",
      },
    });
    mockedGetBalance.mockResolvedValue("100.00");

    await expect(
      buy({
        url: "https://x402.example.com/api",
        wallet_id: TEST_WALLET_ID,
      }),
    ).rejects.toThrow(
      expect.objectContaining({ code: "PRICE_EXCEEDS_LIMIT" }),
    );
  });
});
