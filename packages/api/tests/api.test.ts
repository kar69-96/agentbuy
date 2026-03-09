import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Order, Receipt } from "@bloon/core";

// ---- Mock external packages ----

vi.mock("@bloon/wallet", () => ({
  createWallet: vi.fn(),
  getBalance: vi.fn(),
  generateQR: vi.fn(),
}));

vi.mock("@bloon/orchestrator", () => ({
  buy: vi.fn(),
  confirm: vi.fn(),
  query: vi.fn(),
  searchQuery: vi.fn(),
}));

import { createWallet, getBalance, generateQR } from "@bloon/wallet";
import { buy, confirm, query, searchQuery } from "@bloon/orchestrator";
import { createApp } from "../src/server.js";

const mockedCreateWallet = vi.mocked(createWallet);
const mockedGetBalance = vi.mocked(getBalance);
const mockedGenerateQR = vi.mocked(generateQR);
const mockedBuy = vi.mocked(buy);
const mockedConfirm = vi.mocked(confirm);
const mockedQuery = vi.mocked(query);
const mockedSearchQuery = vi.mocked(searchQuery);

// ---- Test helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;

const TEST_WALLET_ID = "bloon_w_test01";
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
    order_id: "bloon_ord_test01",
    wallet_id: TEST_WALLET_ID,
    status: "awaiting_confirmation",
    product: {
      name: "Test Product",
      url: "https://shop.example.com/product/123",
      price: "17.99",
      source: "scrape",
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloon-api-test-"));
  process.env.BLOON_DATA_DIR = tmpDir;
  setupWallet();
  setupConfig();
  vi.clearAllMocks();
  app = createApp();
  mockedGetBalance.mockResolvedValue("50.00");
  mockedGenerateQR.mockResolvedValue("data:image/png;base64,FAKE_QR");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.BLOON_DATA_DIR;
});

// ---- POST /api/wallets ----

describe("POST /api/wallets", () => {
  it("creates wallet and returns 201", async () => {
    mockedCreateWallet.mockResolvedValue({
      wallet_id: "bloon_w_new01",
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
    expect(json.wallet_id).toBe("bloon_w_new01");
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
      wallet_id: "bloon_w_secret",
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
    expect(json.funding_url).not.toContain("bloon_w_secret");
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
    const res = await req("GET", "/api/wallets/bloon_w_nonexistent");
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("WALLET_NOT_FOUND");
  });

  it("includes transactions from completed orders", async () => {
    setupOrder({
      order_id: "bloon_ord_done",
      status: "completed",
      completed_at: "2026-02-20T02:00:00.000Z",
    });

    const res = await req("GET", `/api/wallets/${TEST_WALLET_ID}`);
    const json = await res.json();
    expect(json.transactions.length).toBe(1);
    expect(json.transactions[0].order_id).toBe("bloon_ord_done");
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
      order_id: "bloon_ord_buy01",
      wallet_id: TEST_WALLET_ID,
      status: "awaiting_confirmation",
      product: {
        name: "Widget",
        url: "https://shop.example.com/widget",
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
    };
    mockedBuy.mockResolvedValue(fakeOrder);

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/widget",
      wallet_id: TEST_WALLET_ID,
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.order_id).toBe("bloon_ord_buy01");
    expect(json.product.name).toBe("Widget");
    expect(json.product.source).toBe("shop.example.com");
    expect(json.payment.item_price).toBe("10.00");
    expect(json.payment.fee).toBe("0.20");
    expect(json.payment.total).toBe("10.20");
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
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedBuy.mockRejectedValue(
      new BloonError(ErrorCodes.INVALID_URL, "Invalid URL"),
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
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedBuy.mockRejectedValue(
      new BloonError(ErrorCodes.WALLET_NOT_FOUND, "Not found"),
    );

    const res = await req("POST", "/api/buy", {
      url: "https://example.com",
      wallet_id: "bloon_w_bad",
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("WALLET_NOT_FOUND");
  });

  it("propagates INSUFFICIENT_BALANCE from orchestrator", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedBuy.mockRejectedValue(
      new BloonError(ErrorCodes.INSUFFICIENT_BALANCE, "Not enough"),
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
      fee: "0.20",
      total_paid: "10.20",
      tx_hash: "0xabc123",
      timestamp: "2026-02-20T03:00:00.000Z",
      order_number: "ORD-123",
    };

    const completedOrder: Order = {
      order_id: "bloon_ord_conf01",
      wallet_id: TEST_WALLET_ID,
      status: "completed",
      product: {
        name: "Widget",
        url: "https://shop.example.com/widget",
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
      receipt,
      created_at: "2026-02-20T02:00:00.000Z",
      expires_at: "2026-02-20T02:05:00.000Z",
      confirmed_at: "2026-02-20T02:01:00.000Z",
      completed_at: "2026-02-20T03:00:00.000Z",
    };

    mockedConfirm.mockResolvedValue({ order: completedOrder, receipt });

    const res = await req("POST", "/api/confirm", {
      order_id: "bloon_ord_conf01",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.order_id).toBe("bloon_ord_conf01");
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
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedConfirm.mockRejectedValue(
      new BloonError(ErrorCodes.ORDER_NOT_FOUND, "Not found"),
    );

    const res = await req("POST", "/api/confirm", {
      order_id: "bloon_ord_bad",
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("propagates ORDER_EXPIRED from orchestrator", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedConfirm.mockRejectedValue(
      new BloonError(ErrorCodes.ORDER_EXPIRED, "Expired"),
    );

    const res = await req("POST", "/api/confirm", {
      order_id: "bloon_ord_expired",
    });
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.error.code).toBe("ORDER_EXPIRED");
  });

  it("returns 200 with failed status when checkout failed with tx_hash", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");

    // Set up a failed order in the store with tx_hash
    setupOrder({
      order_id: "bloon_ord_fail01",
      status: "failed",
      error: {
        code: "CHECKOUT_FAILED",
        message: "Checkout timed out",
        tx_hash: "0xfailed123",
        refund_status: "pending_manual",
      },
    });

    mockedConfirm.mockRejectedValue(
      new BloonError(ErrorCodes.CHECKOUT_FAILED, "Checkout timed out"),
    );

    const res = await req("POST", "/api/confirm", {
      order_id: "bloon_ord_fail01",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.order_id).toBe("bloon_ord_fail01");
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
      fee: "0.10",
      total_paid: "5.10",
      tx_hash: "0xalready",
      timestamp: "2026-02-20T00:00:00.000Z",
    };

    const order: Order = {
      order_id: "bloon_ord_already",
      wallet_id: TEST_WALLET_ID,
      status: "completed",
      product: {
        name: "Already Done",
        url: "https://shop.example.com/done",
        price: "5.00",
        source: "scrape",
      },
      payment: {
        amount_usdc: "5.10",
        price: "5.00",
        fee: "0.10",
        fee_rate: "2%",
        route: "browserbase",
      },
      receipt,
      created_at: "2026-02-20T00:00:00.000Z",
      expires_at: "2026-02-20T00:05:00.000Z",
    };

    mockedConfirm.mockResolvedValue({ order, receipt });

    const res = await req("POST", "/api/confirm", {
      order_id: "bloon_ord_already",
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

// ---- POST /api/query ----

describe("POST /api/query", () => {
  it("returns 200 with product, options, required_fields", async () => {
    mockedQuery.mockResolvedValue({
      product: {
        name: "Cool Shoes",
        url: "https://shop.example.com/shoes",
        price: "89.99",
        image_url: "https://shop.example.com/shoes.jpg",
      },
      options: [{ name: "Size", values: ["9", "10", "11"] }],
      required_fields: [
        { field: "shipping.email", label: "Email" },
        { field: "selections", label: "Product options (Size)" },
      ],
      route: "browserbase",
      discovery_method: "scrape",
    });

    const res = await req("POST", "/api/query", {
      url: "https://shop.example.com/shoes",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.product.name).toBe("Cool Shoes");
    expect(json.product.source).toBe("shop.example.com");
    expect(json.options).toHaveLength(1);
    expect(json.options[0].name).toBe("Size");
    expect(json.required_fields).toHaveLength(2);
    expect(json.route).toBe("browserbase");
    expect(json.discovery_method).toBe("scrape");
  });

  it("returns 400 MISSING_FIELD when url is missing", async () => {
    const res = await req("POST", "/api/query", {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("propagates QUERY_FAILED from orchestrator", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedQuery.mockRejectedValue(
      new BloonError(ErrorCodes.QUERY_FAILED, "Discovery failed"),
    );

    const res = await req("POST", "/api/query", {
      url: "https://shop.example.com/broken",
    });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error.code).toBe("QUERY_FAILED");
  });

  // ---- NL search path ----

  it("returns 400 MISSING_FIELD when both url and query are sent", async () => {
    const res = await req("POST", "/api/query", {
      url: "https://shop.example.com/shoes",
      query: "shoes",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
    expect(json.error.message).toContain("not both");
  });

  it("returns 400 MISSING_FIELD when query is empty string", async () => {
    const res = await req("POST", "/api/query", { query: "" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("returns 400 MISSING_FIELD when query is whitespace only", async () => {
    const res = await req("POST", "/api/query", { query: "   " });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("MISSING_FIELD");
  });

  it("returns 200 search response for { query } with correct shape", async () => {
    const { type } = await import("@bloon/core");
    mockedSearchQuery.mockResolvedValue({
      type: "search",
      query: "towels on amazon under $15",
      products: [
        {
          product: {
            name: "Cotton Towels",
            url: "https://amazon.com/dp/B08EXAMPLE",
            price: "12.99",
            brand: "Basics",
            image_url: "https://amazon.com/img.jpg",
          },
          options: [{ name: "Color", values: ["White", "Gray"] }],
          required_fields: [
            { field: "shipping.name", label: "Full name" },
            { field: "shipping.email", label: "Email address" },
            { field: "selections", label: "Product options (Color)" },
          ],
          route: "browserbase",
          discovery_method: "exa_search",
          relevance_score: 0.92,
        },
      ],
      search_metadata: {
        total_found: 1,
        domain_filter: ["amazon.com"],
        price_filter: { max: 15 },
      },
    });

    const res = await req("POST", "/api/query", {
      query: "towels on amazon under $15",
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.type).toBe("search");
    expect(json.query).toBe("towels on amazon under $15");
    expect(json.products).toHaveLength(1);
    expect(json.products[0].product.name).toBe("Cotton Towels");
    expect(json.products[0].product.source).toBe("amazon.com");
    expect(json.products[0].product.price).toBe("12.99");
    expect(json.products[0].discovery_method).toBe("exa_search");
    expect(json.products[0].route).toBe("browserbase");
    expect(json.products[0].relevance_score).toBe(0.92);
    expect(json.products[0].options).toHaveLength(1);
    expect(json.products[0].required_fields.length).toBeGreaterThan(0);
    expect(json.search_metadata.total_found).toBe(1);
    expect(json.search_metadata.domain_filter).toEqual(["amazon.com"]);
    expect(json.search_metadata.price_filter).toEqual({ max: 15 });
  });

  it("routes { query } to searchQuery, not query", async () => {
    mockedSearchQuery.mockResolvedValue({
      type: "search",
      query: "socks",
      products: [],
      search_metadata: { total_found: 0 },
    });

    await req("POST", "/api/query", { query: "socks" });

    expect(mockedSearchQuery).toHaveBeenCalledWith({ query: "socks" });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("routes { url } to query, not searchQuery", async () => {
    mockedQuery.mockResolvedValue({
      product: { name: "Shoe", url: "https://example.com/shoe", price: "50.00" },
      options: [],
      required_fields: [],
      route: "browserbase",
      discovery_method: "scrape",
    });

    await req("POST", "/api/query", { url: "https://example.com/shoe" });

    expect(mockedQuery).toHaveBeenCalled();
    expect(mockedSearchQuery).not.toHaveBeenCalled();
  });

  it("propagates SEARCH_NO_RESULTS as 404", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedSearchQuery.mockRejectedValue(
      new BloonError(ErrorCodes.SEARCH_NO_RESULTS, "No products found"),
    );

    const res = await req("POST", "/api/query", { query: "nonexistent xyzabc" });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("SEARCH_NO_RESULTS");
  });

  it("propagates SEARCH_UNAVAILABLE as 503", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedSearchQuery.mockRejectedValue(
      new BloonError(ErrorCodes.SEARCH_UNAVAILABLE, "EXA_API_KEY not set"),
    );

    const res = await req("POST", "/api/query", { query: "towels" });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe("SEARCH_UNAVAILABLE");
  });

  it("propagates SEARCH_RATE_LIMITED as 429", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedSearchQuery.mockRejectedValue(
      new BloonError(ErrorCodes.SEARCH_RATE_LIMITED, "Rate limit exceeded"),
    );

    const res = await req("POST", "/api/query", { query: "towels" });
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.code).toBe("SEARCH_RATE_LIMITED");
  });

  it("search response products include source hostname", async () => {
    mockedSearchQuery.mockResolvedValue({
      type: "search",
      query: "sneakers",
      products: [
        {
          product: {
            name: "Air Max",
            url: "https://nike.com/products/air-max",
            price: "110.00",
          },
          options: [],
          required_fields: [],
          route: "browserbase",
          discovery_method: "exa_search",
          relevance_score: 0.88,
        },
      ],
      search_metadata: { total_found: 1 },
    });

    const res = await req("POST", "/api/query", { query: "sneakers" });
    const json = await res.json();
    expect(json.products[0].product.source).toBe("nike.com");
  });

  it("search response with invalid product URL still formats without crashing", async () => {
    mockedSearchQuery.mockResolvedValue({
      type: "search",
      query: "towels",
      products: [
        {
          product: {
            name: "Towel",
            url: "not-a-url",
            price: "5.00",
          },
          options: [],
          required_fields: [],
          route: "browserbase",
          discovery_method: "exa_search",
          relevance_score: 0.7,
        },
      ],
      search_metadata: { total_found: 1 },
    });

    const res = await req("POST", "/api/query", { query: "towels" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.products[0].product.source).toBe("unknown");
  });
});

// ---- POST /api/buy with selections ----

describe("POST /api/buy (selections)", () => {
  it("passes selections through to orchestrator", async () => {
    const fakeOrder: Order = {
      order_id: "bloon_ord_sel01",
      wallet_id: TEST_WALLET_ID,
      status: "awaiting_confirmation",
      product: {
        name: "Sneaker",
        url: "https://shop.example.com/sneaker",
        price: "89.99",
        source: "scrape",
      },
      payment: {
        amount_usdc: "91.79",
        price: "89.99",
        fee: "1.80",
        fee_rate: "2%",
        route: "browserbase",
      },
      selections: { Color: "Charcoal", Size: "10" },
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    };
    mockedBuy.mockResolvedValue(fakeOrder);

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/sneaker",
      wallet_id: TEST_WALLET_ID,
      selections: { Color: "Charcoal", Size: "10" },
    });
    expect(res.status).toBe(200);

    // Verify selections were passed to buy()
    expect(mockedBuy).toHaveBeenCalledWith(
      expect.objectContaining({
        selections: { Color: "Charcoal", Size: "10" },
      }),
    );
  });

  it("propagates INVALID_SELECTION from orchestrator", async () => {
    const { BloonError, ErrorCodes } = await import("@bloon/core");
    mockedBuy.mockRejectedValue(
      new BloonError(ErrorCodes.INVALID_SELECTION, "Bad selection"),
    );

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/widget",
      wallet_id: TEST_WALLET_ID,
      selections: { Color: "" },
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INVALID_SELECTION");
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
