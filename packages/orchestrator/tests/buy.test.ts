import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ShippingInfo, QueriesStore } from "@bloon/core";

// ---- Mock external packages ----

vi.mock("@bloon/checkout", () => ({
  discoverPrice: vi.fn(),
}));

import { discoverPrice } from "@bloon/checkout";
import { buy } from "../src/buy.js";

const mockedDiscoverPrice = vi.mocked(discoverPrice);

// ---- Test helpers ----

let tmpDir: string;

function setupConfig(): void {
  const configPath = path.join(tmpDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
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
  it("buy URL returns order with 2% fee", async () => {
    mockedDiscoverPrice.mockResolvedValue({
      name: "Test Product",
      price: "17.99",
      method: "scrape",
    });

    const order = await buy({
      url: "https://shop.example.com/product/123",
      shipping: testShipping,
    });

    expect(order.payment.price).toBe("17.99");
    expect(order.payment.fee).toBe("0.36");
    expect(order.payment.fee_rate).toBe("2%");
    expect(order.product.name).toBe("Test Product");
    expect(order.shipping).toEqual(testShipping);
    expect(order.status).toBe("awaiting_confirmation");
  });

  it("buy without shipping and no defaults throws SHIPPING_REQUIRED", async () => {
    await expect(
      buy({
        url: "https://shop.example.com/product/123",
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "SHIPPING_REQUIRED" }));
  });

  it("buy without shipping uses env defaults", async () => {
    process.env.SHIPPING_NAME = "Default User";
    process.env.SHIPPING_STREET = "456 Elm St";
    process.env.SHIPPING_CITY = "Boulder";
    process.env.SHIPPING_STATE = "CO";
    process.env.SHIPPING_ZIP = "80301";
    process.env.SHIPPING_COUNTRY = "US";
    process.env.SHIPPING_EMAIL = "default@test.com";
    process.env.SHIPPING_PHONE = "+10009998888";

    mockedDiscoverPrice.mockResolvedValue({
      name: "Default Ship Product",
      price: "10.00",
      method: "scrape",
    });

    const order = await buy({
      url: "https://shop.example.com/product/456",
    });

    expect(order.shipping).toBeDefined();
    expect(order.shipping!.name).toBe("Default User");
    expect(order.shipping!.city).toBe("Boulder");
  });

  it("buy with explicit shipping uses provided shipping", async () => {
    mockedDiscoverPrice.mockResolvedValue({
      name: "Explicit Ship Product",
      price: "15.00",
      method: "scrape",
    });

    const order = await buy({
      url: "https://shop.example.com/product/789",
      shipping: testShipping,
    });

    expect(order.shipping).toEqual(testShipping);
  });

  it("buy with selections stores them on order", async () => {
    mockedDiscoverPrice.mockResolvedValue({
      name: "Sneaker",
      price: "19.99",
      method: "scrape",
    });

    const order = await buy({
      url: "https://shop.example.com/sneaker",
      shipping: testShipping,
      selections: { Color: "Charcoal", Size: "10" },
    });

    expect(order.selections).toEqual({ Color: "Charcoal", Size: "10" });
  });

  it("buy with empty shipping.email throws MISSING_FIELD", async () => {
    await expect(
      buy({
        url: "https://shop.example.com/widget",
        shipping: { ...testShipping, email: "" },
      }),
    ).rejects.toThrow(
      expect.objectContaining({ code: "MISSING_FIELD" }),
    );
  });

  it("buy with blank selection value throws INVALID_SELECTION", async () => {
    await expect(
      buy({
        url: "https://shop.example.com/widget",
        shipping: testShipping,
        selections: { Color: "" },
      }),
    ).rejects.toThrow(
      expect.objectContaining({ code: "INVALID_SELECTION" }),
    );
  });

  it("buy with query_id uses cached query result (skips discovery)", async () => {
    const queryId = "bloon_qry_test01";
    const now = new Date();
    const store: QueriesStore = {
      queries: [{
        query_id: queryId,
        product: {
          name: "Cached Product",
          url: "https://shop.example.com/cached",
          price: "49.99",
          image_url: "https://img.com/cached.jpg",
          brand: "TestBrand",
          currency: "USD",
        },
        options: [{ name: "Size", values: ["S", "M", "L"] }],
        discovery_method: "firecrawl",
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      }],
    };
    fs.writeFileSync(path.join(tmpDir, "queries.json"), JSON.stringify(store));

    const order = await buy({
      query_id: queryId,
      shipping: testShipping,
      selections: { Size: "M" },
    });

    expect(order.product.name).toBe("Cached Product");
    expect(order.product.price).toBe("49.99");
    expect(order.product.brand).toBe("TestBrand");
    expect(order.product.currency).toBe("USD");
    expect(order.product.source).toBe("firecrawl");
    expect(order.payment.price).toBe("49.99");
    expect(order.payment.fee).toBe("1.00");
    expect(order.selections).toEqual({ Size: "M" });
    // discoverPrice should NOT have been called
    expect(mockedDiscoverPrice).not.toHaveBeenCalled();
  });

  it("buy with expired query_id throws QUERY_EXPIRED", async () => {
    const queryId = "bloon_qry_expired";
    const past = new Date(Date.now() - 60_000);
    const store: QueriesStore = {
      queries: [{
        query_id: queryId,
        product: { name: "Old", url: "https://shop.example.com/old", price: "10.00" },
        options: [],
        discovery_method: "scrape",
        created_at: new Date(past.getTime() - 600_000).toISOString(),
        expires_at: past.toISOString(),
      }],
    };
    fs.writeFileSync(path.join(tmpDir, "queries.json"), JSON.stringify(store));

    await expect(
      buy({ query_id: queryId, shipping: testShipping }),
    ).rejects.toThrow(expect.objectContaining({ code: "QUERY_EXPIRED" }));
  });

  it("buy with unknown query_id throws QUERY_NOT_FOUND", async () => {
    await expect(
      buy({ query_id: "bloon_qry_nonexistent", shipping: testShipping }),
    ).rejects.toThrow(expect.objectContaining({ code: "QUERY_NOT_FOUND" }));
  });

  it("buy without url or query_id throws MISSING_FIELD", async () => {
    await expect(
      buy({ shipping: testShipping }),
    ).rejects.toThrow(expect.objectContaining({ code: "MISSING_FIELD" }));
  });

  it("buy high-price product succeeds (no price cap)", async () => {
    mockedDiscoverPrice.mockResolvedValue({
      name: "Expensive Item",
      price: "100.00",
      method: "scrape",
    });

    const order = await buy({
      url: "https://shop.example.com/expensive",
      shipping: testShipping,
    });

    expect(order.payment.price).toBe("100.00");
    expect(order.payment.fee).toBe("2.00");
  });
});
