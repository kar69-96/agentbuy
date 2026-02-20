import { describe, it, expect } from "vitest";
import { scrapePrice, discoverViaCart, discoverPrice } from "../src/discover.js";

const HAS_KEYS =
  !!process.env.BROWSERBASE_API_KEY && !!process.env.ANTHROPIC_API_KEY;

// ---- Tier 1: Server-side scrape against real sites ----

describe("Tier 1 scrape (real sites)", () => {
  it("scrapes a Shopify product via JSON-LD (Allbirds)", async () => {
    const result = await scrapePrice(
      "https://www.allbirds.com/products/mens-tree-runners",
    );
    console.log("Allbirds:", JSON.stringify(result, null, 2));
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
    expect(result!.price).toBeTruthy();
    expect(result!.method).toBe("scrape");
    // Price should be a decimal like "100.00", not cents
    expect(parseFloat(result!.price)).toBeLessThan(1000);
  }, 30000);

  it("scrapes Hydrogen demo store via JSON-LD", async () => {
    const result = await scrapePrice(
      "https://hydrogen-preview.myshopify.com/products/the-full-stack",
    );
    console.log("Hydrogen:", JSON.stringify(result, null, 2));
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
    expect(result!.price).toBeTruthy();
    // Price should be normalized to dollars, not cents
    expect(parseFloat(result!.price)).toBeLessThan(10000);
  }, 30000);

  it("scrapes a Shopify store via JSON-LD (Gymshark)", async () => {
    const result = await scrapePrice(
      "https://www.gymshark.com/products/gymshark-crest-t-shirt-black-aw24",
    );
    console.log("Gymshark:", JSON.stringify(result, null, 2));
    // Gymshark may or may not be scrapeable — log either way
    if (result) {
      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
    }
  }, 30000);

  it("returns null for bot-blocked site (Best Buy)", async () => {
    const result = await scrapePrice(
      "https://www.bestbuy.com/site/apple-airpods-4-white/6447382.p",
    );
    console.log("BestBuy:", result);
    // Best Buy blocks server-side scraping — Tier 2 would be needed
    expect(result).toBeNull();
  }, 30000);
});

// ---- Tier 2: Browserbase cart discovery (requires API keys) ----

describe.skipIf(!HAS_KEYS)("Tier 2 discovery via cart (real sites)", () => {
  const testShipping = {
    name: "John Doe",
    street: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    country: "US",
    email: "john@example.com",
    phone: "512-555-0100",
  };

  it("discovers price on Hydrogen demo Shopify store", async () => {
    const result = await discoverViaCart(
      "https://hydrogen-preview.myshopify.com/products/the-full-stack",
      testShipping,
    );
    console.log("Tier 2 Hydrogen:", JSON.stringify(result, null, 2));
    expect(result.name).toBeTruthy();
    expect(result.price).toBeTruthy();
    expect(result.method).toBe("browserbase_cart");
    // Price should be stripped of currency symbol
    expect(result.price).not.toContain("$");
  }, 120000);
});

// ---- discoverPrice: Tier 1 → Tier 2 fallback ----

describe.skipIf(!HAS_KEYS)("discoverPrice fallback (real sites)", () => {
  const testShipping = {
    name: "John Doe",
    street: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    country: "US",
    email: "john@example.com",
    phone: "512-555-0100",
  };

  it("uses Tier 1 for Shopify sites with JSON-LD", async () => {
    const result = await discoverPrice(
      "https://www.allbirds.com/products/mens-tree-runners",
      testShipping,
    );
    console.log("discoverPrice Allbirds:", JSON.stringify(result, null, 2));
    expect(result.method).toBe("scrape"); // Should be fast Tier 1
    expect(result.price).toBeTruthy();
  }, 30000);
});
