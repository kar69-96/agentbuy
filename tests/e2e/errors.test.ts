import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ProxoError, ErrorCodes } from "@proxo/core";
import type { Order } from "@proxo/core";

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
import { createApp } from "@proxo/api/src/server.js";

const mockedCreateWallet = vi.mocked(createWallet);
const mockedGetBalance = vi.mocked(getBalance);
const mockedGenerateQR = vi.mocked(generateQR);
const mockedBuy = vi.mocked(buy);
const mockedConfirm = vi.mocked(confirm);

// ---- Test helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;

const TEST_WALLET_ID = "proxo_w_e2e01";
const TEST_ADDRESS = "0x" + "a".repeat(40);
const TEST_FUNDING_TOKEN = "tok_e2e_fund";

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
          agent_name: "E2EAgent",
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

async function req(method: string, pathStr: string, body?: unknown) {
  const url = `http://localhost${pathStr}`;
  const init: RequestInit = { method, headers: {} };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return app.request(url, init);
}

// ---- Setup / Teardown ----

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxo-e2e-errors-"));
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

// ---- Scenario E: Error scenarios ----

describe("E2E — Scenario E: Error scenarios", () => {
  it("full flow: create wallet → get wallet → response shapes chain correctly", async () => {
    mockedCreateWallet.mockResolvedValue({
      wallet_id: "proxo_w_new",
      address: "0x" + "f".repeat(40),
      private_key: "0x" + "1".repeat(64),
      funding_token: "tok_new",
      network: "base-sepolia",
      agent_name: "FlowAgent",
      created_at: "2026-02-22T00:00:00.000Z",
    });

    // Create wallet
    const createRes = await req("POST", "/api/wallets", {
      agent_name: "FlowAgent",
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.wallet_id).toBe("proxo_w_new");
    expect(created.address).toBeDefined();
    expect(created.funding_url).toContain("/fund/tok_new");
    expect(created.balance_usdc).toBe("50.00");

    // Get wallet (uses the pre-seeded wallet from setupWallet)
    const getRes = await req("GET", `/api/wallets/${TEST_WALLET_ID}`);
    expect(getRes.status).toBe(200);
    const wallet = await getRes.json();
    expect(wallet.wallet_id).toBe(TEST_WALLET_ID);
    expect(wallet.balance_usdc).toBe("50.00");
    expect(wallet.transactions).toEqual([]);
  });

  it("buy $30 product → 400 PRICE_EXCEEDS_LIMIT", async () => {
    mockedBuy.mockRejectedValue(
      new ProxoError(
        ErrorCodes.PRICE_EXCEEDS_LIMIT,
        "Price exceeds $25 limit",
      ),
    );

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/expensive",
      wallet_id: TEST_WALLET_ID,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("PRICE_EXCEEDS_LIMIT");
  });

  it("buy with insufficient balance → 400 INSUFFICIENT_BALANCE", async () => {
    mockedBuy.mockRejectedValue(
      new ProxoError(
        ErrorCodes.INSUFFICIENT_BALANCE,
        "Not enough USDC",
      ),
    );

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/product",
      wallet_id: TEST_WALLET_ID,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("buy with bad wallet_id → 404 WALLET_NOT_FOUND", async () => {
    mockedBuy.mockRejectedValue(
      new ProxoError(ErrorCodes.WALLET_NOT_FOUND, "Not found"),
    );

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/product",
      wallet_id: "proxo_w_nonexistent",
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("WALLET_NOT_FOUND");
  });

  it("confirm with bad order_id → 404 ORDER_NOT_FOUND", async () => {
    mockedConfirm.mockRejectedValue(
      new ProxoError(ErrorCodes.ORDER_NOT_FOUND, "Not found"),
    );

    const res = await req("POST", "/api/confirm", {
      order_id: "proxo_ord_nonexistent",
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("confirm expired order → 410 ORDER_EXPIRED", async () => {
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

  it("buy without shipping (browser route) → 400 SHIPPING_REQUIRED", async () => {
    mockedBuy.mockRejectedValue(
      new ProxoError(ErrorCodes.SHIPPING_REQUIRED, "Shipping required"),
    );

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/product",
      wallet_id: TEST_WALLET_ID,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("SHIPPING_REQUIRED");
  });

  it("retry buy with shipping → 200 quote returned", async () => {
    const fakeOrder: Order = {
      order_id: "proxo_ord_retry",
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
      shipping: {
        name: "Test User",
        street: "123 Main St",
        city: "Austin",
        state: "TX",
        zip: "78701",
        country: "US",
        email: "test@example.com",
        phone: "512-555-0100",
      },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.order_id).toBe("proxo_ord_retry");
    expect(json.payment.route).toBe("browserbase");
    expect(json.status).toBe("awaiting_confirmation");
  });
});
