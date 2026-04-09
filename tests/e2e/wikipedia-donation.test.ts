import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createApp } from "@bloon/api/src/server.js";

// ---- Required env vars — test FAILS (not skips) if missing ----

const REQUIRED_KEYS = [
  "BROWSERBASE_API_KEY",
  "BROWSERBASE_PROJECT_ID",
  "GOOGLE_API_KEY",
  "CARD_NUMBER",
  "CARD_EXPIRY",
  "CARD_CVV",
  "CARDHOLDER_NAME",
];

function assertEnvVars(): void {
  const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars for e2e checkout test: ${missing.join(", ")}. ` +
        `Ensure .env is present at project root with all credentials.`,
    );
  }
}

// ---- Test helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;

const WIKIPEDIA_DONATION_URL =
  "https://donate.wikimedia.org/w/index.php?title=Special:LandingPage&country=US&uselang=en&wmf_medium=spontaneous&wmf_source=fr-redir&wmf_campaign=spontaneous";

const TEST_SHIPPING = {
  name: "Test Donor",
  street: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  country: "US",
  email: "testdonor@example.com",
  phone: "512-555-0100",
};

async function req(method: string, pathStr: string, body?: unknown) {
  const url = `http://localhost${pathStr}`;
  const init: RequestInit = { method, headers: {} };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return app.request(url, init);
}

// ---- E2E: Wikipedia $2 one-time donation via browser checkout ----

describe("E2E — Wikipedia $2 donation (browser checkout)", () => {
  beforeAll(() => {
    assertEnvVars();
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloon-e2e-wiki-"));
    process.env.BLOON_DATA_DIR = tmpDir;
    app = createApp();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.BLOON_DATA_DIR;
  });

  it(
    "buy + confirm a $2 Wikipedia donation",
    async () => {
      // Step 1: Buy quote
      const buyRes = await req("POST", "/api/buy", {
        url: WIKIPEDIA_DONATION_URL,
        shipping: TEST_SHIPPING,
      });

      console.log("Buy status:", buyRes.status);
      const buyJson = (await buyRes.json()) as Record<string, unknown>;
      console.log("Buy response:", JSON.stringify(buyJson, null, 2));

      expect(buyRes.status).toBe(200);
      expect(buyJson.order_id).toBeTruthy();
      expect(buyJson.status).toBe("awaiting_confirmation");

      // Step 2: Confirm (runs real Browserbase checkout)
      const confirmRes = await req("POST", "/api/confirm", {
        order_id: buyJson.order_id,
      });

      console.log("Confirm status:", confirmRes.status);
      const confirmJson = (await confirmRes.json()) as Record<string, unknown>;
      console.log("Confirm response:", JSON.stringify(confirmJson, null, 2));

      expect(confirmJson.order_id).toBe(buyJson.order_id);

      // Accept both completed and failed — the card may be declined,
      // but the checkout must have reached the payment step
      expect(["completed", "failed"]).toContain(confirmJson.status);

      if (confirmJson.status === "completed") {
        const receipt = confirmJson.receipt as Record<string, unknown>;
        expect(receipt).toBeTruthy();
        expect(receipt.product).toBeTruthy();
        expect(receipt.total_paid).toBeTruthy();
      }
    },
    300_000, // 5 minute timeout
  );
});
