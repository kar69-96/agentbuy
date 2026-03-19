import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { BloonError, ErrorCodes } from "@bloon/core";
import type { Order } from "@bloon/core";

// ---- Mock external packages ----

vi.mock("@bloon/orchestrator", () => ({
  buy: vi.fn(),
  confirm: vi.fn(),
}));

import { buy, confirm } from "@bloon/orchestrator";
import { createApp } from "@bloon/api/src/server.js";

const mockedBuy = vi.mocked(buy);
const mockedConfirm = vi.mocked(confirm);

// ---- Test helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;

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

// ---- Setup / Teardown ----

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloon-e2e-errors-"));
  process.env.BLOON_DATA_DIR = tmpDir;
  setupConfig();
  vi.clearAllMocks();
  app = createApp();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.BLOON_DATA_DIR;
});

// ---- Scenario E: Error scenarios ----

describe("E2E — Scenario E: Error scenarios", () => {
  it("confirm with bad order_id → 404 ORDER_NOT_FOUND", async () => {
    mockedConfirm.mockRejectedValue(
      new BloonError(ErrorCodes.ORDER_NOT_FOUND, "Not found"),
    );

    const res = await req("POST", "/api/confirm", {
      order_id: "bloon_ord_nonexistent",
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("confirm expired order → 410 ORDER_EXPIRED", async () => {
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

  it("buy without shipping (browser route) → 400 SHIPPING_REQUIRED", async () => {
    mockedBuy.mockRejectedValue(
      new BloonError(ErrorCodes.SHIPPING_REQUIRED, "Shipping required"),
    );

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/product",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("SHIPPING_REQUIRED");
  });

  it("retry buy with shipping → 200 quote returned", async () => {
    const fakeOrder: Order = {
      order_id: "bloon_ord_retry",
      status: "awaiting_confirmation",
      product: {
        name: "Widget",
        url: "https://shop.example.com/widget",
        price: "10.00",
        source: "scrape",
      },
      payment: {
        total: "10.20",
        price: "10.00",
        fee: "0.20",
        fee_rate: "2%",
      },
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    };
    mockedBuy.mockResolvedValue(fakeOrder);

    const res = await req("POST", "/api/buy", {
      url: "https://shop.example.com/widget",
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
    expect(json.order_id).toBe("bloon_ord_retry");
    expect(json.status).toBe("awaiting_confirmation");
  });
});
