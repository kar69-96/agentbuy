import { describe, it, expect } from "vitest";
import type { Order } from "@bloon/core";
import { buildReceipt } from "../src/receipts.js";

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    order_id: "bloon_ord_test01",
    wallet_id: "bloon_w_test01",
    status: "processing",
    product: {
      name: "Test Product",
      url: "https://shop.example.com/product/123",
      price: "10.00",
      source: "scrape",
    },
    payment: {
      amount_usdc: "10.20",
      price: "10.00",
      fee: "0.20",
      fee_rate: "2%",
      route: "browserbase",
    },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  };
}

describe("buildReceipt", () => {
  it("builds receipt for browserbase checkout", () => {
    const order = makeOrder();
    const receipt = buildReceipt({
      order,
      tx_hash: "0xabc123",
      checkoutResult: {
        success: true,
        orderNumber: "ORD-999",
        sessionId: "sess_xyz",
        replayUrl: "https://browserbase.com/replay/xyz",
      },
    });

    expect(receipt.product).toBe("Test Product");
    expect(receipt.merchant).toBe("shop.example.com");
    expect(receipt.route).toBe("browserbase");
    expect(receipt.price).toBe("10.00");
    expect(receipt.fee).toBe("0.20");
    expect(receipt.total_paid).toBe("10.20");
    expect(receipt.tx_hash).toBe("0xabc123");
    expect(receipt.order_number).toBe("ORD-999");
    expect(receipt.browserbase_session_id).toBe("sess_xyz");
    expect(receipt.response).toBeUndefined();
  });

  it("builds receipt for x402 payment", () => {
    const order = makeOrder({
      payment: {
        amount_usdc: "0.102",
        price: "0.10",
        fee: "0.002",
        fee_rate: "2%",
        route: "x402",
      },
      product: {
        name: "Echo Service",
        url: "https://x402.example.com/api",
        price: "0.10",
        source: "x402",
      },
    });

    const receipt = buildReceipt({
      order,
      tx_hash: "0xdef456",
      x402Result: {
        response: { echo: "hello" },
        status: 200,
        headers: { "content-type": "application/json" },
      },
    });

    expect(receipt.route).toBe("x402");
    expect(receipt.price).toBe("0.10");
    expect(receipt.fee).toBe("0.002");
    expect(receipt.total_paid).toBe("0.102");
    expect(receipt.tx_hash).toBe("0xdef456");
    expect(receipt.response).toEqual({ echo: "hello" });
    expect(receipt.order_number).toBeUndefined();
    expect(receipt.browserbase_session_id).toBeUndefined();
  });

  it("extracts merchant hostname from product URL", () => {
    const order = makeOrder({
      product: {
        name: "Widget",
        url: "https://www.amazon.com/dp/B08N5WRWNW",
        price: "24.99",
        source: "scrape",
      },
    });

    const receipt = buildReceipt({ order, tx_hash: "0x123" });
    expect(receipt.merchant).toBe("www.amazon.com");
  });
});
