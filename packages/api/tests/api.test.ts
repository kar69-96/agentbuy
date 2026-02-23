import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Order, Receipt } from "@proxo/core";

// ---- Mock external packages ----

vi.mock("@proxo/wallet", () => ({
  createWallet: vi.fn(),
  getBalance: vi.fn(),
  generateQR: vi.fn(),
}));

vi.mock("@proxo/orchestrator", () => ({
  buy: vi.fn(),
  confirm: vi.fn(),
}));

import { createWallet, getBalance, generateQR } from "@proxo/wallet";
import { buy, confirm } from "@proxo/orchestrator";
import { createApp } from "../src/server.js";

const mockedCreateWallet = vi.mocked(createWallet);
const mockedGetBalance = vi.mocked(getBalance);
const mockedGenerateQR = vi.mocked(generateQR);
const mockedBuy = vi.mocked(buy);
const mockedConfirm = vi.mocked(confirm);

// ---- Test helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;

const TEST_WALLET_ID = "proxo_w_test01";
const TEST_ADDRESS = "0x" + "a".repeat(40);
const TEST_FUNDING_TOKEN = "tok_test_fund_abc";

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
          funding_token: TEST_FUNDING_TOKEN,
          network: "base-sepolia",
          agent_name: "TestAgent",
          created_at: "2026-02-20T00:00:00.000Z",
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

function setupOrder(overrides: Partial<Order> = {}): Order {
  const order: Order = {
    order_id: "proxo_ord_test01",
    wallet_id: TEST_WALLET_ID,
    status: "awaiting_confirmation",
    product: {
      name: "Test Product",
      url: "https://shop.example.com/product/123",
      price: "17.99",
      source: "scrape",
    },
    payment: {
      amount_usdc: "18.89",
      price: "17.99",
      fee: "0.90",
      fee_rate: "5%",
      route: "browserbase",
    },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  };

  const ordersPath = path.join(tmpDir, "orders.json");
  let store: { orders: Order[] };
  try {
    store = JSON.parse(fs.readFileSync(ordersPath, "utf-8"));
  } catch {
    store = { orders: [] };
  }
  store.orders.push(order);
  fs.writeFileSync(ordersPath, JSON.stringify(store));
  return order;
}

async function req(method: string, pathStr: string, body?: unknown) {
  const url = `http://localhost${pathStr}`;
  const init: RequestInit = { method, headers: {} };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return app.request(url, init);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxo-api-test-"));
  process.env.PROXO_DATA_DIR = tmpDir;
  setupWallet();
  setupConfig();
  vi.clearAllMocks();
  app = createApp();
  mockedGetBalance.mockResolvedValue("50.00");
  mockedGenerateQR.mockResolvedValue("data:image/png;base64,FAKE_QR");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.PROXO_DATA_DIR;
});

// ---- POST /api/wallets ----

describe("POST /api/wallets", () => {
  it("creates wallet and returns 201", async () => {
    mockedCreateWallet.mockResolvedValue({
      wallet_id: "proxo_w_new01",
      address: "0x" + "f".repeat(40),
      private_key: "0x" + "1".repeat(64),
      funding_token: "tok_new",
      network: "base-sepolia",
      agent_name: "New Agent",
      created_at: "2026-02-20T01:00:00.000Z",
    });

    const res = await req("POST", "/api/wallets", { agent_name: "New Agent" });
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.wallet_id).toBe("proxo_w_new01");
    expect(json.address).toBe("0x" + "f".repeat(40));
    expect(json.balance_usdc).toBe("50.00");
    expect(json.funding_url).toContain("/fund/tok_new");
    expect(json.network).toBe("base-sepolia");
    expect(json.agent_name).toBe("New Agent");
  });

  it("returns 400 MISSING_FIELD when agent_name is missing", async () => {
    const res = await req("POST", "/api/wallets", {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("returns 400 MISSING_FIELD when agent_name is empty string", async () => {
    const res = await req("POST", "/api/wallets", { agent_name: "  " });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("funding_url contains funding_token, not wallet_id", async () => {
    mockedCreateWallet.mockResolvedValue({
      wallet_id: "proxo_w_secret",
      address: "0x" + "f".repeat(40),
      private_key: "0x" + "1".repeat(64),
      funding_token: "tok_public_safe",
      network: "base-sepolia",
      agent_name: "Agent",
      created_at: "2026-02-20T01:00:00.000Z",
    });

    const res = await req("POST", "/api/wallets", { agent_name: "Agent" });
    const json = await res.json();
    expect(json.funding_url).toContain("tok_public_safe");
    expect(json.funding_url).not.toContain("proxo_w_secret");
  });
});

// ---- GET /api/wallets/:wallet_id ----

describe("GET /api/wallets/:wallet_id", () => {
  it("returns wallet details with 200", async () => {
    const res = await req("GET", `/api/wallets/${TEST_WALLET_ID}`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.wallet_id).toBe(TEST_WALLET_ID);
    expect(json.balance_usdc).toBe("50.00");
    expect(json.transactions).toEqual([]);
  });

  it("returns 404 for invalid wallet_id", async () => {
    const res = await req("GET", "/api/wallets/proxo_w_nonexistent");
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("WALLET_NOT_FOUND");
  });

  it("includes transactions from completed orders", async () => {
    setupOrder({
      order_id: "proxo_ord_done",
      status: "completed",
      completed_at: "2026-02-20T02:00:00.000Z",
    });

    const res = await req("GET", `/api/wallets/${TEST_WALLET_ID}`);
    const json = await res.json();
    expect(json.transactions.length).toBe(1);
    expect(json.transactions[0].order_id).toBe("proxo_ord_done");
    expect(json.transactions[0].product).toBe("Test Product");
  });

  it("balance reflects mocked chain value", async () => {
    mockedGetBalance.mockResolvedValue("123.45");
    const res = await req("GET", `/api/wallets/${TEST_WALLET_ID}`);
    const json = await res.json();
    expect(json.balance_usdc).toBe("123.45");
  });
});

// ---- POST /api/buy ----

describe("POST /api/buy", () => {
  it("returns buy quote with 200", async () => {
    const fakeOrder: Order = {
      order_id: "proxo_ord_buy01",
      wallet_id: TEST_WALLET_ID,
      status: "awaiting_confirmation",
      product: {
        name: "Widget",
        url: "https://shop.example.com/widget",
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
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    };
    mockedBuy.mockResolvedValue(fakeOrder);

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/widget",
      wallet_id: TEST_WALLET_ID,
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.order_id).toBe("proxo_ord_buy01");
    expect(json.product.name).toBe("Widget");
    expect(json.product.source).toBe("shop.example.com");
    expect(json.payment.item_price).toBe("10.00");
    expect(json.payment.fee).toBe("0.50");
    expect(json.payment.total).toBe("10.50");
    expect(json.payment.route).toBe("browserbase");
    expect(json.payment.wallet_balance).toBe("50.00");
    expect(json.status).toBe("awaiting_confirmation");
    expect(json.expires_in).toBeGreaterThan(0);
  });

  it("returns 400 MISSING_FIELD when url is missing", async () => {
    const res = await req("POST", "/api/buy", { wallet_id: TEST_WALLET_ID });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("returns 400 MISSING_FIELD when wallet_id is missing", async () => {
    const res = await req("POST", "/api/buy", {
      url: "https://example.com",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("propagates INVALID_URL from orchestrator", async () => {
    const { ProxoError, ErrorCodes } = await import("@proxo/core");
    mockedBuy.mockRejectedValue(
      new ProxoError(ErrorCodes.INVALID_URL, "Invalid URL"),
    );

    const res = await req("POST", "/api/buy", {
      url: "not-a-url",
      wallet_id: TEST_WALLET_ID,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_URL");
  });

  it("propagates WALLET_NOT_FOUND from orchestrator", async () => {
    const { ProxoError, ErrorCodes } = await import("@proxo/core");
    mockedBuy.mockRejectedValue(
      new ProxoError(ErrorCodes.WALLET_NOT_FOUND, "Not found"),
    );

    const res = await req("POST", "/api/buy", {
      url: "https://example.com",
      wallet_id: "proxo_w_bad",
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("WALLET_NOT_FOUND");
  });

  it("propagates INSUFFICIENT_BALANCE from orchestrator", async () => {
    const { ProxoError, ErrorCodes } = await import("@proxo/core");
    mockedBuy.mockRejectedValue(
      new ProxoError(ErrorCodes.INSUFFICIENT_BALANCE, "Not enough"),
    );

    const res = await req("POST", "/api/buy", {
      url: "https://example.com",
      wallet_id: TEST_WALLET_ID,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INSUFFICIENT_BALANCE");
  });
});

// ---- POST /api/confirm ----

describe("POST /api/confirm", () => {
  it("returns completed order with receipt on success", async () => {
    const receipt: Receipt = {
      product: "Widget",
      merchant: "shop.example.com",
      route: "browserbase",
      price: "10.00",
      fee: "0.50",
      total_paid: "10.50",
      tx_hash: "0xabc123",
      timestamp: "2026-02-20T03:00:00.000Z",
      order_number: "ORD-123",
    };

    const completedOrder: Order = {
      order_id: "proxo_ord_conf01",
      wallet_id: TEST_WALLET_ID,
      status: "completed",
      product: {
        name: "Widget",
        url: "https://shop.example.com/widget",
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
      receipt,
      created_at: "2026-02-20T02:00:00.000Z",
      expires_at: "2026-02-20T02:05:00.000Z",
      confirmed_at: "2026-02-20T02:01:00.000Z",
      completed_at: "2026-02-20T03:00:00.000Z",
    };

    mockedConfirm.mockResolvedValue({ order: completedOrder, receipt });

    const res = await req("POST", "/api/confirm", {
      order_id: "proxo_ord_conf01",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.order_id).toBe("proxo_ord_conf01");
    expect(json.status).toBe("completed");
    expect(json.receipt.product).toBe("Widget");
    expect(json.receipt.tx_hash).toBe("0xabc123");
    expect(json.receipt.order_number).toBe("ORD-123");
  });

  it("returns 400 MISSING_FIELD when order_id is missing", async () => {
    const res = await req("POST", "/api/confirm", {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("propagates ORDER_NOT_FOUND from orchestrator", async () => {
    const { ProxoError, ErrorCodes } = await import("@proxo/core");
    mockedConfirm.mockRejectedValue(
      new ProxoError(ErrorCodes.ORDER_NOT_FOUND, "Not found"),
    );

    const res = await req("POST", "/api/confirm", {
      order_id: "proxo_ord_bad",
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("propagates ORDER_EXPIRED from orchestrator", async () => {
    const { ProxoError, ErrorCodes } = await import("@proxo/core");
    mockedConfirm.mockRejectedValue(
      new ProxoError(ErrorCodes.ORDER_EXPIRED, "Expired"),
    );

    const res = await req("POST", "/api/confirm", {
      order_id: "proxo_ord_expired",
    });
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.error.code).toBe("ORDER_EXPIRED");
  });

  it("returns 200 with failed status when checkout failed with tx_hash", async () => {
    const { ProxoError, ErrorCodes } = await import("@proxo/core");

    // Set up a failed order in the store with tx_hash
    setupOrder({
      order_id: "proxo_ord_fail01",
      status: "failed",
      error: {
        code: "CHECKOUT_FAILED",
        message: "Checkout timed out",
        tx_hash: "0xfailed123",
        refund_status: "pending_manual",
      },
    });

    mockedConfirm.mockRejectedValue(
      new ProxoError(ErrorCodes.CHECKOUT_FAILED, "Checkout timed out"),
    );

    const res = await req("POST", "/api/confirm", {
      order_id: "proxo_ord_fail01",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.order_id).toBe("proxo_ord_fail01");
    expect(json.status).toBe("failed");
    expect(json.error.code).toBe("CHECKOUT_FAILED");
    expect(json.error.tx_hash).toBe("0xfailed123");
    expect(json.error.refund_status).toBe("pending_manual");
  });

  it("returns existing receipt for already completed order", async () => {
    const receipt: Receipt = {
      product: "Already Done",
      merchant: "shop.example.com",
      route: "browserbase",
      price: "5.00",
      fee: "0.25",
      total_paid: "5.25",
      tx_hash: "0xalready",
      timestamp: "2026-02-20T00:00:00.000Z",
    };

    const order: Order = {
      order_id: "proxo_ord_already",
      wallet_id: TEST_WALLET_ID,
      status: "completed",
      product: {
        name: "Already Done",
        url: "https://shop.example.com/done",
        price: "5.00",
        source: "scrape",
      },
      payment: {
        amount_usdc: "5.25",
        price: "5.00",
        fee: "0.25",
        fee_rate: "5%",
        route: "browserbase",
      },
      receipt,
      created_at: "2026-02-20T00:00:00.000Z",
      expires_at: "2026-02-20T00:05:00.000Z",
    };

    mockedConfirm.mockResolvedValue({ order, receipt });

    const res = await req("POST", "/api/confirm", {
      order_id: "proxo_ord_already",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("completed");
    expect(json.receipt.tx_hash).toBe("0xalready");
  });
});

// ---- GET /fund/:token ----

describe("GET /fund/:token", () => {
  it("returns HTML page with QR code and balance", async () => {
    const res = await req("GET", `/fund/${TEST_FUNDING_TOKEN}`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("data:image/png;base64,FAKE_QR");
    expect(html).toContain(TEST_ADDRESS);
    expect(html).toContain("50.00");
    expect(html).toContain("Base Sepolia");
  });

  it("returns 404 HTML for invalid token", async () => {
    const res = await req("GET", "/fund/invalid_token_xyz");
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Not Found");
  });

  it("HTML does not contain wallet_id or private_key", async () => {
    const res = await req("GET", `/fund/${TEST_FUNDING_TOKEN}`);
    const html = await res.text();
    expect(html).not.toContain(TEST_WALLET_ID);
    expect(html).not.toContain("b".repeat(64));
  });

  it("HTML contains network indicator", async () => {
    const res = await req("GET", `/fund/${TEST_FUNDING_TOKEN}`);
    const html = await res.text();
    expect(html).toContain("testnet");
  });
});

// ---- GET /fund/:token/balance ----

describe("GET /fund/:token/balance", () => {
  it("returns JSON balance for valid token", async () => {
    const res = await req("GET", `/fund/${TEST_FUNDING_TOKEN}/balance`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.balance_usdc).toBe("50.00");
  });

  it("returns 404 for invalid token", async () => {
    const res = await req("GET", "/fund/invalid_token_xyz/balance");
    expect(res.status).toBe(404);
  });

  it("response does not contain wallet_id", async () => {
    const res = await req("GET", `/fund/${TEST_FUNDING_TOKEN}/balance`);
    const text = await res.text();
    expect(text).not.toContain(TEST_WALLET_ID);
  });
});

// ---- Error handler ----

describe("error handler", () => {
  it("returns 500 with generic message for unknown errors", async () => {
    mockedBuy.mockRejectedValue(new Error("something unexpected"));

    const res = await req("POST", "/api/buy", {
      url: "https://example.com",
      wallet_id: TEST_WALLET_ID,
    });
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error.code).toBe("INTERNAL_ERROR");
    expect(json.error.message).toBe("Internal server error");
  });
});
