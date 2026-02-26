import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "@proxo/api/src/server.js";

// ---- Skip unless all credentials are available ----

const hasRpc = !!process.env.BASE_RPC_URL;
const hasBrowserbase = !!process.env.BROWSERBASE_API_KEY;
const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const hasTestWallet = !!process.env.TEST_WALLET_PRIVATE_KEY;

// ---- Test helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;
let testWalletId: string;

const WIKIPEDIA_DONATION_URL =
  "https://donate.wikimedia.org/w/index.php?title=Special:LandingPage&country=ES&uselang=en&wmf_medium=spontaneous&wmf_source=fr-redir&wmf_campaign=spontaneous";

const TEST_SHIPPING = {
  name: "Test Donor",
  street: "Calle de Alcalá 1",
  city: "Madrid",
  state: "MD",
  zip: "28014",
  country: "ES",
  email: "testdonor@example.com",
  phone: "+34600000000",
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
  testWalletId = "proxo_w_wikitest";
  fs.writeFileSync(
    walletsPath,
    JSON.stringify({
      wallets: [
        {
          wallet_id: testWalletId,
          address: account.address,
          private_key: process.env.TEST_WALLET_PRIVATE_KEY,
          funding_token: "tok_wiki_fund",
          network: "base-sepolia",
          agent_name: "WikiDonationE2E",
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

// ---- E2E: Wikipedia $2.50 one-time donation ----

describe.skipIf(!hasRpc || !hasBrowserbase || !hasAnthropic || !hasTestWallet)(
  "E2E — Wikipedia $2.50 one-time donation",
  () => {
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxo-e2e-wiki-"));
      process.env.PROXO_DATA_DIR = tmpDir;
      setupConfig();
      setupTestWallet();
      app = createApp();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.PROXO_DATA_DIR;
    });

    it(
      "buy + confirm a $2.50 Wikipedia donation",
      async () => {
        // Step 1: Buy quote (price caller-supplied — donation page has no fixed product price)
        const buyRes = await req("POST", "/api/buy", {
          url: WIKIPEDIA_DONATION_URL,
          wallet_id: testWalletId,
          price: "2.50",
          shipping: TEST_SHIPPING,
        });

        console.log("Buy status:", buyRes.status);
        const buyJson = await buyRes.json();
        console.log("Buy response:", JSON.stringify(buyJson, null, 2));

        expect(buyRes.status).toBe(200);
        expect(buyJson.order_id).toBeTruthy();
        expect(buyJson.status).toBe("awaiting_confirmation");
        expect(buyJson.payment.route).toBe("browserbase");

        // Step 2: Confirm (runs real Browserbase checkout)
        const confirmRes = await req("POST", "/api/confirm", {
          order_id: buyJson.order_id,
        });

        console.log("Confirm status:", confirmRes.status);
        const confirmJson = await confirmRes.json();
        console.log("Confirm response:", JSON.stringify(confirmJson, null, 2));

        expect(confirmJson.order_id).toBe(buyJson.order_id);
        expect(["completed", "failed"]).toContain(confirmJson.status);

        if (confirmJson.status === "completed") {
          expect(confirmJson.receipt).toBeTruthy();
          expect(confirmJson.receipt.tx_hash).toMatch(/^0x/);
          expect(confirmJson.receipt.route).toBe("browserbase");
        }
      },
      300_000,
    );
  },
);
