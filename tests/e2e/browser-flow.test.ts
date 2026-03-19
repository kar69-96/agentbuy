import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createApp } from "@bloon/api/src/server.js";

// ---- Skip unless all credentials are available ----

const hasBrowserbase = !!process.env.BROWSERBASE_API_KEY;
const hasAnthropic = !!process.env.GOOGLE_API_KEY;

// ---- Test helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;

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
  const configPath = path.join(tmpDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
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

// ---- Scenarios B, C, D: Browser checkout flows ----

describe.skipIf(!hasBrowserbase || !hasAnthropic)(
  "E2E — Scenarios B, C, D: Browser checkout flows",
  () => {
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloon-e2e-browser-"));
      process.env.BLOON_DATA_DIR = tmpDir;
      setupConfig();

      // Clear domain cache (both tmp and default) so each run starts fresh
      const tmpCacheDir = path.join(tmpDir, "cache");
      fs.rmSync(tmpCacheDir, { recursive: true, force: true });
      const defaultCacheDir = path.join(os.homedir(), ".bloon", "cache");
      fs.rmSync(defaultCacheDir, { recursive: true, force: true });

      app = createApp();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.BLOON_DATA_DIR;
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
      "buy Shopify product with shipping → 200 quote with 2% fee",
      async () => {
        const res = await req("POST", "/api/buy", {
          url: "https://i-like-you-minneapolis.myshopify.com/products/bekah-worley-stickers",
          shipping: TEST_SHIPPING,
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.payment.fee_rate).toBe("2%");
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
      },
      300_000,
    );

    // Scenario D: Domain cache hit on second buy
    it(
      "second buy from same domain uses cached data",
      async () => {
        // First buy — cold start
        const buyRes1 = await req("POST", "/api/buy", {
          url: "https://i-like-you-minneapolis.myshopify.com/products/bekah-worley-stickers",
          shipping: TEST_SHIPPING,
        });
        expect(buyRes1.status).toBe(200);
        const buyJson1 = await buyRes1.json();

        await req("POST", "/api/confirm", { order_id: buyJson1.order_id });

        // Second buy — should use domain cache
        const buyRes2 = await req("POST", "/api/buy", {
          url: "https://i-like-you-minneapolis.myshopify.com/products/bekah-worley-stickers",
          shipping: TEST_SHIPPING,
        });
        expect(buyRes2.status).toBe(200);
      },
      180_000,
    );
  },
);
