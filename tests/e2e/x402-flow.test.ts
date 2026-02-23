import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "@proxo/api/src/server.js";

// ---- Skip unless RPC + funded wallet are available ----

const hasRpc = !!process.env.BASE_RPC_URL;
const hasTestWallet = !!process.env.TEST_WALLET_PRIVATE_KEY;

// ---- Test helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;
let testWalletId: string;

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

// ---- Scenario A: Full x402 flow ----

describe.skipIf(!hasRpc || !hasTestWallet)(
  "E2E — Scenario A: x402 full flow",
  () => {
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxo-e2e-x402-"));
      process.env.PROXO_DATA_DIR = tmpDir;
      setupConfig();

      // Pre-seed wallet with the test private key
      const account = privateKeyToAccount(
        process.env.TEST_WALLET_PRIVATE_KEY as `0x${string}`,
      );

      const walletsPath = path.join(tmpDir, "wallets.json");
      testWalletId = "proxo_w_x402test";
      fs.writeFileSync(
        walletsPath,
        JSON.stringify({
          wallets: [
            {
              wallet_id: testWalletId,
              address: account.address,
              private_key: process.env.TEST_WALLET_PRIVATE_KEY,
              funding_token: "tok_x402_fund",
              network: "base-sepolia",
              agent_name: "x402TestAgent",
              created_at: new Date().toISOString(),
            },
          ],
        }),
      );

      app = createApp();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.PROXO_DATA_DIR;
    });

    it(
      "POST /api/wallets → 201 with wallet_id, address, funding_url",
      async () => {
        const res = await req("POST", "/api/wallets", {
          agent_name: "NewX402Agent",
        });
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.wallet_id).toBeDefined();
        expect(json.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(json.funding_url).toContain("/fund/");
      },
      30_000,
    );

    it(
      "GET /api/wallets/:id → 200 with live balance from chain",
      async () => {
        const res = await req("GET", `/api/wallets/${testWalletId}`);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.wallet_id).toBe(testWalletId);
        expect(json.balance_usdc).toBeDefined();
        expect(parseFloat(json.balance_usdc)).toBeGreaterThanOrEqual(0);
      },
      30_000,
    );

    it(
      "POST /api/buy with PayAI echo endpoint → 200 with x402 route and 0.5% fee",
      async () => {
        const res = await req("POST", "/api/buy", {
          url: "https://x402.payai.network/api/base-sepolia/paid-content",
          wallet_id: testWalletId,
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.payment.route).toBe("x402");
        expect(json.payment.fee_rate).toBe("0.5%");
        expect(json.status).toBe("awaiting_confirmation");
      },
      30_000,
    );

    it(
      "POST /api/confirm → 200 with receipt (PayAI auto-refunds)",
      async () => {
        // First, create a buy quote
        const buyRes = await req("POST", "/api/buy", {
          url: "https://x402.payai.network/api/base-sepolia/paid-content",
          wallet_id: testWalletId,
        });
        expect(buyRes.status).toBe(200);
        const buyJson = await buyRes.json();
        const orderId = buyJson.order_id;

        // Then confirm
        const confirmRes = await req("POST", "/api/confirm", {
          order_id: orderId,
        });
        expect(confirmRes.status).toBe(200);
        const confirmJson = await confirmRes.json();
        expect(confirmJson.status).toBe("completed");
        expect(confirmJson.receipt).toBeDefined();
        expect(confirmJson.receipt.tx_hash).toMatch(/^0x/);
      },
      60_000,
    );

    it(
      "GET /api/wallets/:id → transactions array includes the purchase",
      async () => {
        // Create + confirm an order first
        const buyRes = await req("POST", "/api/buy", {
          url: "https://x402.payai.network/api/base-sepolia/paid-content",
          wallet_id: testWalletId,
        });
        const buyJson = await buyRes.json();

        await req("POST", "/api/confirm", { order_id: buyJson.order_id });

        // Check transactions
        const walletRes = await req("GET", `/api/wallets/${testWalletId}`);
        const walletJson = await walletRes.json();
        expect(walletJson.transactions.length).toBeGreaterThanOrEqual(1);
        expect(walletJson.transactions[0].route).toBe("x402");
      },
      60_000,
    );
  },
);
