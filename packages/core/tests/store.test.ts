import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createWallet,
  getWallet,
  getWallets,
  getWalletByFundingToken,
  createOrder,
  getOrder,
  getOrders,
  getOrdersByWallet,
  updateOrder,
  updateOrderStatus,
  generateId,
} from "../src/store.js";
import type { Wallet, Order } from "../src/types.js";

let tmpDir: string;

function makeWallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    wallet_id: generateId("w"),
    address: "0x" + "a".repeat(40),
    private_key: "0x" + "b".repeat(64),
    funding_token: "tok_test_123",
    network: "base-sepolia",
    agent_name: "TestAgent",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    order_id: generateId("ord"),
    wallet_id: "bloon_w_test01",
    status: "awaiting_confirmation",
    product: {
      name: "Test Product",
      url: "https://example.com/product",
      price: "17.99",
      source: "example.com",
    },
    payment: {
      amount_usdc: "18.35",
      price: "17.99",
      fee: "0.36",
      fee_rate: "2%",
      route: "browserbase",
    },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloon-test-"));
  process.env.BLOON_DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.BLOON_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateId", () => {
  it("generates IDs with correct prefix format", () => {
    const id = generateId("w");
    expect(id).toMatch(/^bloon_w_[a-z0-9]{6}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId("w")));
    expect(ids.size).toBe(100);
  });
});

describe("wallet CRUD", () => {
  it("creates and reads a wallet", async () => {
    const wallet = makeWallet();
    await createWallet(wallet);

    const retrieved = getWallet(wallet.wallet_id);
    expect(retrieved).toEqual(wallet);
  });

  it("returns undefined for non-existent wallet", () => {
    expect(getWallet("bloon_w_nonexistent")).toBeUndefined();
  });

  it("lists all wallets", async () => {
    const w1 = makeWallet({ agent_name: "Agent1" });
    const w2 = makeWallet({ agent_name: "Agent2" });
    await createWallet(w1);
    await createWallet(w2);

    const all = getWallets();
    expect(all).toHaveLength(2);
  });

  it("finds wallet by funding token", async () => {
    const wallet = makeWallet({ funding_token: "unique_token_abc" });
    await createWallet(wallet);

    const found = getWalletByFundingToken("unique_token_abc");
    expect(found?.wallet_id).toBe(wallet.wallet_id);
  });
});

describe("order CRUD", () => {
  it("creates and reads an order", async () => {
    const order = makeOrder();
    await createOrder(order);

    const retrieved = getOrder(order.order_id);
    expect(retrieved).toEqual(order);
  });

  it("updates order status", async () => {
    const order = makeOrder();
    await createOrder(order);
    await updateOrderStatus(order.order_id, "processing");

    const retrieved = getOrder(order.order_id);
    expect(retrieved?.status).toBe("processing");
  });

  it("updates order with partial data", async () => {
    const order = makeOrder();
    await createOrder(order);
    await updateOrder(order.order_id, {
      tx_hash: "0xabc123",
      confirmed_at: new Date().toISOString(),
    });

    const retrieved = getOrder(order.order_id);
    expect(retrieved?.tx_hash).toBe("0xabc123");
    expect(retrieved?.confirmed_at).toBeDefined();
  });

  it("lists orders by wallet", async () => {
    const o1 = makeOrder({ wallet_id: "bloon_w_aaaaaa" });
    const o2 = makeOrder({ wallet_id: "bloon_w_aaaaaa" });
    const o3 = makeOrder({ wallet_id: "bloon_w_bbbbbb" });
    await createOrder(o1);
    await createOrder(o2);
    await createOrder(o3);

    const walletOrders = getOrdersByWallet("bloon_w_aaaaaa");
    expect(walletOrders).toHaveLength(2);
  });
});

describe("disk persistence", () => {
  it("persists wallets to disk and reloads", async () => {
    const wallet = makeWallet();
    await createWallet(wallet);

    // Verify file exists on disk
    const filePath = path.join(tmpDir, "wallets.json");
    expect(fs.existsSync(filePath)).toBe(true);

    // Read raw file and parse
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(raw.wallets).toHaveLength(1);
    expect(raw.wallets[0].wallet_id).toBe(wallet.wallet_id);

    // Re-read via store (simulates restart)
    const reloaded = getWallet(wallet.wallet_id);
    expect(reloaded).toEqual(wallet);
  });

  it("persists orders to disk and reloads", async () => {
    const order = makeOrder();
    await createOrder(order);
    await updateOrderStatus(order.order_id, "completed");

    const filePath = path.join(tmpDir, "orders.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const reloaded = getOrder(order.order_id);
    expect(reloaded?.status).toBe("completed");
  });
});
