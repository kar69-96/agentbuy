import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Order } from "@proxo/core";

// ---- Mock external packages ----

vi.mock("@proxo/wallet", () => ({
  transferUSDC: vi.fn(),
}));

vi.mock("@proxo/x402", () => ({
  payX402: vi.fn(),
}));

vi.mock("@proxo/checkout", () => ({
  runCheckout: vi.fn(),
}));

import { transferUSDC } from "@proxo/wallet";
import { payX402 } from "@proxo/x402";
import { runCheckout } from "@proxo/checkout";
import { confirm } from "../src/confirm.js";

const mockedTransferUSDC = vi.mocked(transferUSDC);
const mockedPayX402 = vi.mocked(payX402);
const mockedRunCheckout = vi.mocked(runCheckout);

// ---- Test helpers ----

let tmpDir: string;

const WALLET_ID = "proxo_w_test01";
const WALLET_ADDRESS = "0x" + "a".repeat(40);
const WALLET_KEY = "0x" + "b".repeat(64);
const MASTER_ADDRESS = "0x" + "c".repeat(40);

function writeStore(filename: string, data: unknown): void {
  fs.writeFileSync(path.join(tmpDir, filename), JSON.stringify(data, null, 2));
}

function setupWallet(): void {
  writeStore("wallets.json", {
    wallets: [
      {
        wallet_id: WALLET_ID,
        address: WALLET_ADDRESS,
        private_key: WALLET_KEY,
        funding_token: "tok_test",
        network: "base-sepolia",
        agent_name: "TestAgent",
        created_at: new Date().toISOString(),
      },
    ],
  });
}

function setupConfig(): void {
  writeStore("config.json", {
    master_wallet: {
      address: MASTER_ADDRESS,
      private_key: "0x" + "d".repeat(64),
    },
    network: "base-sepolia",
    usdc_contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    max_transaction_amount: 25,
    default_order_expiry_seconds: 300,
    port: 3000,
  });
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    order_id: "proxo_ord_test01",
    wallet_id: WALLET_ID,
    status: "awaiting_confirmation",
    product: {
      name: "Test Product",
      url: "https://example.com/product",
      price: "10.00",
      source: "scrape",
    },
    payment: {
      amount_usdc: "10.50",
      price: "10.00",
      fee: "0.50",
      fee_rate: "5%",
      route: "browserbase",
    },
    shipping: {
      name: "Test User",
      street: "123 Main St",
      city: "Denver",
      state: "CO",
      zip: "80202",
      country: "US",
      email: "test@test.com",
      phone: "+10001112222",
    },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  };
}

function seedOrder(order: Order): void {
  writeStore("orders.json", { orders: [order] });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxo-confirm-test-"));
  process.env.PROXO_DATA_DIR = tmpDir;
  setupWallet();
  setupConfig();
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.PROXO_DATA_DIR;
});

// ---- Tests ----

describe("confirm", () => {
  it("confirm x402 order transfers fee and pays service, returns receipt", async () => {
    const order = makeOrder({
      payment: {
        amount_usdc: "0.1005",
        price: "0.10",
        fee: "0.0005",
        fee_rate: "0.5%",
        route: "x402",
      },
      product: {
        name: "Echo Service",
        url: "https://x402.example.com/api",
        price: "0.10",
        source: "x402",
      },
      shipping: undefined,
    });
    seedOrder(order);

    mockedTransferUSDC.mockResolvedValue({
      tx_hash: "0xfee_hash_123",
      from: WALLET_ADDRESS,
      to: MASTER_ADDRESS,
      amount: "0.0005",
    });

    mockedPayX402.mockResolvedValue({
      response: { echo: "hello" },
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const result = await confirm({ order_id: "proxo_ord_test01" });

    expect(result.receipt.route).toBe("x402");
    expect(result.receipt.tx_hash).toBe("0xfee_hash_123");
    expect(result.receipt.response).toEqual({ echo: "hello" });
    expect(result.receipt.price).toBe("0.10");
    expect(result.receipt.fee).toBe("0.0005");

    // Verify fee-only transfer
    expect(mockedTransferUSDC).toHaveBeenCalledWith(
      WALLET_KEY,
      MASTER_ADDRESS,
      "0.0005",
    );

    // Verify x402 payment
    expect(mockedPayX402).toHaveBeenCalledWith(
      "https://x402.example.com/api",
      WALLET_KEY,
    );
  });

  it("confirm browser order transfers full amount and checks out, returns receipt", async () => {
    const order = makeOrder();
    seedOrder(order);

    mockedTransferUSDC.mockResolvedValue({
      tx_hash: "0xfull_hash_456",
      from: WALLET_ADDRESS,
      to: MASTER_ADDRESS,
      amount: "10.50",
    });

    mockedRunCheckout.mockResolvedValue({
      success: true,
      orderNumber: "ORD-12345",
      sessionId: "sess_abc",
      replayUrl: "https://browserbase.com/replay/abc",
    });

    const result = await confirm({ order_id: "proxo_ord_test01" });

    expect(result.receipt.route).toBe("browserbase");
    expect(result.receipt.tx_hash).toBe("0xfull_hash_456");
    expect(result.receipt.order_number).toBe("ORD-12345");
    expect(result.receipt.browserbase_session_id).toBe("sess_abc");

    // Verify full amount transfer
    expect(mockedTransferUSDC).toHaveBeenCalledWith(
      WALLET_KEY,
      MASTER_ADDRESS,
      "10.50",
    );
  });

  it("confirm expired order throws ORDER_EXPIRED", async () => {
    const order = makeOrder({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    seedOrder(order);

    await expect(
      confirm({ order_id: "proxo_ord_test01" }),
    ).rejects.toThrow(expect.objectContaining({ code: "ORDER_EXPIRED" }));

    // Verify status updated to expired in store
    const stored = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "orders.json"), "utf-8"),
    );
    expect(stored.orders[0].status).toBe("expired");
  });

  it("confirm already completed order returns existing receipt", async () => {
    const existingReceipt = {
      product: "Test Product",
      merchant: "example.com",
      route: "browserbase" as const,
      price: "10.00",
      fee: "0.50",
      total_paid: "10.50",
      tx_hash: "0xexisting_hash",
      timestamp: "2026-01-01T00:00:00.000Z",
      order_number: "ORD-99999",
    };

    const order = makeOrder({
      status: "completed",
      receipt: existingReceipt,
    });
    seedOrder(order);

    const result = await confirm({ order_id: "proxo_ord_test01" });

    expect(result.receipt).toEqual(existingReceipt);
    // No transfers should have been called
    expect(mockedTransferUSDC).not.toHaveBeenCalled();
    expect(mockedRunCheckout).not.toHaveBeenCalled();
  });

  it("confirm where USDC sent but checkout fails preserves tx_hash and sets failed", async () => {
    const order = makeOrder();
    seedOrder(order);

    mockedTransferUSDC.mockResolvedValue({
      tx_hash: "0xsent_but_failed",
      from: WALLET_ADDRESS,
      to: MASTER_ADDRESS,
      amount: "10.50",
    });

    mockedRunCheckout.mockRejectedValue(new Error("Browser session crashed"));

    await expect(
      confirm({ order_id: "proxo_ord_test01" }),
    ).rejects.toThrow(expect.objectContaining({ code: "CHECKOUT_FAILED" }));

    // Verify order in store has failed status with tx_hash preserved
    const stored = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "orders.json"), "utf-8"),
    );
    const failedOrder = stored.orders[0];
    expect(failedOrder.status).toBe("failed");
    expect(failedOrder.error.tx_hash).toBe("0xsent_but_failed");
    expect(failedOrder.error.refund_status).toBe("pending_manual");
    expect(failedOrder.error.code).toBe("CHECKOUT_FAILED");
  });
});
