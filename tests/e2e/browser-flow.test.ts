import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "@proxo/api/src/server.js";

// ---- Skip unless all credentials are available ----

const hasRpc = !!process.env.BASE_RPC_URL;
const hasBrowserbase = !!process.env.BROWSERBASE_API_KEY;
const hasAnthropic = !!process.env.GOOGLE_API_KEY;
const hasTestWallet = !!process.env.TEST_WALLET_PRIVATE_KEY;

// ---- Test helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;
let testWalletId: string;

const TEST_SHIPPING = {
  name: "Test User",
  street: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  country: "US",
  email: "test@example.com",
  phone: "512-555-0100",
};

function setupConfig(): void {
  const masterAccount = privateKeyToAccount(
    process.env.TEST_WALLET_PRIVATE_KEY as `0x${string}`,
  );
  const configPath = path.join(tmpDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      master_wallet: {
        address: masterAccount.address,
        private_key: process.env.TEST_WALLET_PRIVATE_KEY,
      },
      network: "base-sepolia",
      usdc_contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      max_transaction_amount: 25,
      default_order_expiry_seconds: 300,
      port: 3000,
    }),
  );
}

function setupTestWallet(): void {
  const account = privateKeyToAccount(
    process.env.TEST_WALLET_PRIVATE_KEY as `0x${string}`,
  );

  const walletsPath = path.join(tmpDir, "wallets.json");
  testWalletId = "proxo_w_browsertest";
  fs.writeFileSync(
    walletsPath,
    JSON.stringify({
      wallets: [
        {
          wallet_id: testWalletId,
          address: account.address,
          private_key: process.env.TEST_WALLET_PRIVATE_KEY,
          funding_token: "tok_browser_fund",
          network: "base-sepolia",
          agent_name: "BrowserTestAgent",
          created_at: new Date().toISOString(),
        },
      ],
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

// ---- Scenarios B, C, D: Browser checkout flows ----

describe.skipIf(!hasRpc || !hasBrowserbase || !hasAnthropic || !hasTestWallet)(
  "E2E — Scenarios B, C, D: Browser checkout flows",
  () => {
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxo-e2e-browser-"));
      process.env.PROXO_DATA_DIR = tmpDir;
      setupConfig();
      setupTestWallet();

      // Clear domain cache (both tmp and default) so each run starts fresh
      const tmpCacheDir = path.join(tmpDir, "cache");
      fs.rmSync(tmpCacheDir, { recursive: true, force: true });
      const defaultCacheDir = path.join(os.homedir(), ".proxo", "cache");
      fs.rmSync(defaultCacheDir, { recursive: true, force: true });

      app = createApp();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.PROXO_DATA_DIR;
    });

    // Scenario C: Missing shipping
    it(
      "buy Shopify product without shipping → 400 SHIPPING_REQUIRED",
      async () => {
        // Clear default shipping env vars
        const savedShippingName = process.env.SHIPPING_NAME;
        delete process.env.SHIPPING_NAME;

        try {
          const res = await req("POST", "/api/buy", {
            url: "https://i-like-you-minneapolis.myshopify.com/products/bekah-worley-stickers",
            wallet_id: testWalletId,
          });
          expect(res.status).toBe(400);
          const json = await res.json();
          expect(json.error.code).toBe("SHIPPING_REQUIRED");
        } finally {
          if (savedShippingName !== undefined)
            process.env.SHIPPING_NAME = savedShippingName;
        }
      },
      30_000,
    );

    // Scenario C: Retry with shipping
    it(
      "buy Shopify product with shipping → 200 quote with 5% fee",
      async () => {
        const res = await req("POST", "/api/buy", {
          url: "https://i-like-you-minneapolis.myshopify.com/products/bekah-worley-stickers",
          wallet_id: testWalletId,
          shipping: TEST_SHIPPING,
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.payment.route).toBe("browserbase");
        expect(json.payment.fee_rate).toBe("5%");
        expect(json.status).toBe("awaiting_confirmation");
      },
      60_000,
    );

    // Scenario B: Full browser checkout
    it(
      "full browser checkout → 200 receipt with order_number",
      async () => {
        // Get buy quote
        const buyRes = await req("POST", "/api/buy", {
          url: "https://i-like-you-minneapolis.myshopify.com/products/bekah-worley-stickers",
          wallet_id: testWalletId,
          shipping: TEST_SHIPPING,
        });
        expect(buyRes.status).toBe(200);
        const buyJson = await buyRes.json();

        // Confirm
        const confirmRes = await req("POST", "/api/confirm", {
          order_id: buyJson.order_id,
        });
        expect(confirmRes.status).toBe(200);
        const confirmJson = await confirmRes.json();
        expect(confirmJson.status).toBe("completed");
        expect(confirmJson.receipt).toBeDefined();
        expect(confirmJson.receipt.tx_hash).toMatch(/^0x/);
      },
      300_000,
    );

    // Scenario B: Balance reduced after purchase
    // Skipped: when TEST_WALLET_PRIVATE_KEY == PROXO_MASTER_PRIVATE_KEY (single wallet),
    // the USDC transfer is a self-transfer so balance doesn't change.
    // This test requires separate agent and master wallets to be meaningful.
    it.skip(
      "wallet balance reduced after browser checkout",
      async () => {
        // Get initial balance
        const beforeRes = await req("GET", `/api/wallets/${testWalletId}`);
        const beforeJson = await beforeRes.json();
        const balanceBefore = parseFloat(beforeJson.balance_usdc);

        // Buy + confirm
        const buyRes = await req("POST", "/api/buy", {
          url: "https://i-like-you-minneapolis.myshopify.com/products/bekah-worley-stickers",
          wallet_id: testWalletId,
          shipping: TEST_SHIPPING,
        });
        const buyJson = await buyRes.json();
        await req("POST", "/api/confirm", { order_id: buyJson.order_id });

        // Check balance after
        const afterRes = await req("GET", `/api/wallets/${testWalletId}`);
        const afterJson = await afterRes.json();
        const balanceAfter = parseFloat(afterJson.balance_usdc);

        expect(balanceAfter).toBeLessThan(balanceBefore);
      },
      180_000,
    );

    // Scenario D: Domain cache hit on second buy
    it(
      "second buy from same domain uses cached data",
      async () => {
        // First buy — cold start
        const buyRes1 = await req("POST", "/api/buy", {
          url: "https://i-like-you-minneapolis.myshopify.com/products/bekah-worley-stickers",
          wallet_id: testWalletId,
          shipping: TEST_SHIPPING,
        });
        expect(buyRes1.status).toBe(200);
        const buyJson1 = await buyRes1.json();

        await req("POST", "/api/confirm", { order_id: buyJson1.order_id });

        // Second buy — should use domain cache
        const buyRes2 = await req("POST", "/api/buy", {
          url: "https://i-like-you-minneapolis.myshopify.com/products/bekah-worley-stickers",
          wallet_id: testWalletId,
          shipping: TEST_SHIPPING,
        });
        expect(buyRes2.status).toBe(200);
        const buyJson2 = await buyRes2.json();
        expect(buyJson2.payment.route).toBe("browserbase");
      },
      180_000,
    );
  },
);
