/**
 * NL Search E2E — POST /api/query { query: "..." }
 *
 * These tests hit the real Exa API and perform live URL reachability checks.
 * They are meant for manual verification of search result quality.
 *
 * Requirements:
 *   - EXA_API_KEY must be set in environment
 *   - BLOON_DATA_DIR is set to a temp dir automatically
 *
 * Run:
 *   EXA_API_KEY=... npx vitest run tests/e2e/nl-search.test.ts
 *
 * Each test prints the full JSON response so you can review results.
 * Assertions only check shape — not specific product names or prices,
 * since Exa results vary by day.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createApp } from "@bloon/api/src/server.js";

// ---- Skip if no EXA key ----

const hasExa = !!process.env.EXA_API_KEY;

// ---- Helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;

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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloon-nl-search-"));
  process.env.BLOON_DATA_DIR = tmpDir;
  setupConfig();
  app = createApp();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.BLOON_DATA_DIR;
});

async function query(q: string) {
  const res = await app.request("http://localhost/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

function assertSearchShape(body: unknown) {
  const b = body as Record<string, unknown>;
  expect(b.type).toBe("search");
  expect(typeof b.query).toBe("string");
  expect(Array.isArray(b.products)).toBe(true);

  const meta = b.search_metadata as Record<string, unknown>;
  expect(typeof meta).toBe("object");
  expect(typeof meta.total_found).toBe("number");

  for (const item of b.products as Array<Record<string, unknown>>) {
    const product = item.product as Record<string, unknown>;
    expect(typeof product.name).toBe("string");
    expect(product.name.length).toBeGreaterThan(0);
    expect(typeof product.url).toBe("string");
    expect(product.url).toMatch(/^https?:\/\//);
    expect(typeof product.price).toBe("string");
    expect(parseFloat(product.price as string)).toBeGreaterThan(0);
    expect(typeof product.source).toBe("string");

    expect(Array.isArray(item.options)).toBe(true);
    expect(Array.isArray(item.required_fields)).toBe(true);
    expect(typeof item.route).toBe("string");
    expect(item.discovery_method).toBe("exa_search");
    expect(typeof item.relevance_score).toBe("number");
  }
}

// ---- Input validation (no real Exa calls) ----

describe("POST /api/query — NL search input validation", () => {
  it("returns 400 when neither url nor query is provided", async () => {
    const res = await app.request("http://localhost/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    const err = json.error as Record<string, unknown>;
    expect(err.code).toBe("MISSING_FIELD");
  });

  it("returns 400 when both url and query are provided", async () => {
    const res = await app.request("http://localhost/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://amazon.com/dp/B08EXAMPLE",
        query: "towels on amazon",
      }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    const err = json.error as Record<string, unknown>;
    expect(err.code).toBe("MISSING_FIELD");
  });

  it("returns 400 for a blank query string", async () => {
    const res = await app.request("http://localhost/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "  " }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    const err = json.error as Record<string, unknown>;
    expect(err.code).toBe("MISSING_FIELD");
  });

  it("returns 400 for a single-char query (too short)", async () => {
    const res = await app.request("http://localhost/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "a" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    const err = json.error as Record<string, unknown>;
    expect(err.code).toBe("MISSING_FIELD");
  });

  it("returns 503 SEARCH_UNAVAILABLE when EXA_API_KEY is missing", async () => {
    const saved = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;

    const res = await app.request("http://localhost/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "bath towels" }),
    });
    expect(res.status).toBe(503);
    const json = await res.json() as Record<string, unknown>;
    const err = json.error as Record<string, unknown>;
    expect(err.code).toBe("SEARCH_UNAVAILABLE");

    if (saved) process.env.EXA_API_KEY = saved;
  });
});

// ---- Live search queries (require EXA_API_KEY) ----

describe("POST /api/query — NL search, live Exa results", { timeout: 60_000, skip: !hasExa }, () => {

  it('query: "bath towels"', async () => {
    const { status, body } = await query("bath towels");
    console.log("\n=== bath towels ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    assertSearchShape(body);
  });

  it('query: "wireless earbuds on amazon"', async () => {
    const { status, body } = await query("wireless earbuds on amazon");
    console.log("\n=== wireless earbuds on amazon ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    assertSearchShape(body);
    const b = body as Record<string, unknown>;
    const meta = b.search_metadata as Record<string, unknown>;
    const domainFilter = meta.domain_filter as string[] | undefined;
    if (domainFilter) expect(domainFilter).toContain("amazon.com");
    for (const item of b.products as Array<Record<string, unknown>>) {
      expect((item.product as Record<string, unknown>).url as string).toContain("amazon.com");
    }
  });

  it('query: "yoga mat for beginners"', async () => {
    const { status, body } = await query("yoga mat for beginners");
    console.log("\n=== yoga mat for beginners ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    assertSearchShape(body);
    const products = (body as Record<string, unknown>).products as Array<unknown>;
    expect(products.length).toBeGreaterThan(0);
    expect(products.length).toBeLessThanOrEqual(5);
  });

  it('query: "coffee grinder"', async () => {
    const { status, body } = await query("coffee grinder");
    console.log("\n=== coffee grinder ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    assertSearchShape(body);
  });

  it('query: "phone case for iPhone 15"', async () => {
    const { status, body } = await query("phone case for iPhone 15");
    console.log("\n=== phone case for iPhone 15 ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    assertSearchShape(body);
  });

  it('query: "mens running shoes"', async () => {
    const { status, body } = await query("mens running shoes");
    console.log("\n=== mens running shoes ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    assertSearchShape(body);
  });

  it('query: "kitchen towels from target"', async () => {
    const { status, body } = await query("kitchen towels from target");
    console.log("\n=== kitchen towels from target ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    assertSearchShape(body);
    const b = body as Record<string, unknown>;
    const meta = b.search_metadata as Record<string, unknown>;
    const domainFilter = meta.domain_filter as string[] | undefined;
    if (domainFilter) expect(domainFilter).toContain("target.com");
  });

  it('query: "notebook journal"', async () => {
    const { status, body } = await query("notebook journal");
    console.log("\n=== notebook journal ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    assertSearchShape(body);
  });

  it('query: "sunscreen SPF 50"', async () => {
    const { status, body } = await query("sunscreen SPF 50");
    console.log("\n=== sunscreen SPF 50 ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    assertSearchShape(body);
  });

  it('query: "desk lamp"', async () => {
    const { status, body } = await query("desk lamp");
    console.log("\n=== desk lamp ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.type).toBe("search");
    expect(b.query).toBe("desk lamp");
    const meta = b.search_metadata as Record<string, unknown>;
    expect(typeof meta.total_found).toBe("number");
  });

  it('query: "t-shirt on amazon" — required_fields include shipping + selections when options exist', async () => {
    const { status, body } = await query("t-shirt on amazon");
    console.log("\n=== t-shirt on amazon (required_fields check) ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    for (const item of b.products as Array<Record<string, unknown>>) {
      const fields = (item.required_fields as Array<Record<string, unknown>>).map((f) => f.field as string);
      expect(fields).toContain("shipping.name");
      expect(fields).toContain("shipping.email");
      expect(fields).toContain("shipping.street");
      if ((item.options as Array<unknown>).length > 0) {
        expect(fields).toContain("selections");
      }
    }
  });

  it('query: "water bottle" — results capped at 5', async () => {
    const { status, body } = await query("water bottle");
    console.log("\n=== water bottle (count check) ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    const products = (body as Record<string, unknown>).products as Array<unknown>;
    expect(products.length).toBeGreaterThanOrEqual(1);
    expect(products.length).toBeLessThanOrEqual(5);
  });

  it('query: "hand soap" — all returned URLs are valid', async () => {
    const { status, body } = await query("hand soap");
    console.log("\n=== hand soap (URL check) ===");
    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(200);
    for (const item of (body as Record<string, unknown>).products as Array<Record<string, unknown>>) {
      const url = (item.product as Record<string, unknown>).url as string;
      expect(url).toMatch(/^https?:\/\//);
      console.log(`  URL: ${url}`);
    }
  });
});
