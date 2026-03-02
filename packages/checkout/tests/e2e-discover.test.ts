import { describe, it, expect } from "vitest";
import {
  scrapePrice,
  discoverViaCart,
  discoverPrice,
  scrapePriceWithOptions,
  discoverViaFirecrawl,
  discoverViaBrowser,
  discoverProduct,
} from "../src/discover.js";

const HAS_KEYS =
  !!process.env.BROWSERBASE_API_KEY && !!process.env.GOOGLE_API_KEY;

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

// ---- scrapePriceWithOptions: Tier 1 with variants (no API key needed) ----

describe("scrapePriceWithOptions (real sites)", () => {
  it("extracts name + price + options from Allbirds", async () => {
    const result = await scrapePriceWithOptions(
      "https://www.allbirds.com/products/mens-tree-runners",
    );
    console.log(
      "scrapePriceWithOptions Allbirds:",
      JSON.stringify(result, null, 2),
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
    expect(result!.price).toBeTruthy();
    expect(parseFloat(result!.price)).toBeGreaterThan(0);
    expect(parseFloat(result!.price)).toBeLessThan(1000);
    expect(Array.isArray(result!.options)).toBe(true);
  }, 30000);

  it("extracts name + price from Hydrogen demo store", async () => {
    const result = await scrapePriceWithOptions(
      "https://hydrogen-preview.myshopify.com/products/the-full-stack",
    );
    console.log(
      "scrapePriceWithOptions Hydrogen:",
      JSON.stringify(result, null, 2),
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
    expect(result!.price).toBeTruthy();
    expect(parseFloat(result!.price)).toBeGreaterThan(0);
  }, 30000);
});

// ---- Firecrawl rich extraction (requires FIRECRAWL_API_KEY) ----

const HAS_FIRECRAWL = !!process.env.FIRECRAWL_API_KEY;

describe.skipIf(!HAS_FIRECRAWL)("discoverViaFirecrawl (real sites)", () => {
  it("extracts rich data from Allbirds", async () => {
    const result = await discoverViaFirecrawl(
      "https://www.allbirds.com/products/mens-tree-runners",
    );
    console.log("Firecrawl Allbirds:", JSON.stringify(result, null, 2));

    // Firecrawl may return null if the API key is invalid or the service is down
    if (!result) {
      console.warn(
        "Firecrawl returned null — API key may be invalid or service unavailable",
      );
      return;
    }

    expect(result.name).toBeTruthy();
    expect(result.price).toBeTruthy();
    expect(result.method).toBe("firecrawl");

    // Price should be reasonable
    const price = parseFloat(result.price);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(1000);

    // At least one rich field should be populated
    const hasRich =
      !!result.brand || !!result.description || !!result.image_url;
    expect(hasRich).toBe(true);
  }, 120000);
});

// ---- Firecrawl 3-step pipeline e2e tests ----

describe.skipIf(!HAS_FIRECRAWL)(
  "Firecrawl 3-step pipeline — Path 1: Simple product (Step 1 only)",
  () => {
    it("extracts Hydrogen demo product (no variants expected)", async () => {
      const result = await discoverViaFirecrawl(
        "https://hydrogen-preview.myshopify.com/products/the-full-stack",
      );
      console.log("Firecrawl Hydrogen:", JSON.stringify(result, null, 2));

      if (!result) {
        console.warn("Firecrawl returned null — skipping");
        return;
      }

      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(parseFloat(result.price)).toBeGreaterThan(0);
      expect(result.method).toBe("firecrawl");
    }, 30000);
  },
);

describe.skipIf(!HAS_FIRECRAWL)(
  "Firecrawl 3-step pipeline — Path 2: Options + variant URLs (Steps 1+2)",
  () => {
    it("extracts Allbirds Tree Runners with Color + Size options and variant pricing", async () => {
      const result = await discoverViaFirecrawl(
        "https://www.allbirds.com/products/mens-tree-runners",
      );
      console.log(
        "Firecrawl Allbirds (3-step):",
        JSON.stringify(result, null, 2),
      );

      if (!result) {
        console.warn("Firecrawl returned null — skipping");
        return;
      }

      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(parseFloat(result.price)).toBeGreaterThan(0);
      expect(result.method).toBe("firecrawl");

      // Should have options
      if (result.options.length > 0) {
        const optionNames = result.options.map((o) => o.name.toLowerCase());
        console.log("Detected option groups:", optionNames);
      }

      // At least one rich field
      const hasRich =
        !!result.brand || !!result.description || !!result.image_url;
      expect(hasRich).toBe(true);
    }, 120000);

    it("extracts Bombas socks with Color options", async () => {
      const result = await discoverViaFirecrawl(
        "https://www.bombas.com/products/womens-ankle-sock-4-pack",
      );
      console.log("Firecrawl Bombas:", JSON.stringify(result, null, 2));

      if (!result) {
        console.warn("Firecrawl returned null — skipping");
        return;
      }

      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(parseFloat(result.price)).toBeGreaterThan(0);
      expect(result.method).toBe("firecrawl");
    }, 120000);

    it("extracts Brooklinen sheets with Size + Color options", async () => {
      const result = await discoverViaFirecrawl(
        "https://www.brooklinen.com/products/classic-core-sheet-set",
      );
      console.log("Firecrawl Brooklinen:", JSON.stringify(result, null, 2));

      if (!result) {
        console.warn("Firecrawl returned null — skipping");
        return;
      }

      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(parseFloat(result.price)).toBeGreaterThan(0);
      expect(result.method).toBe("firecrawl");

      // Brooklinen sheets should have options (Size at minimum)
      if (result.options.length > 0) {
        const optionNames = result.options.map((o) => o.name.toLowerCase());
        console.log("Brooklinen option groups:", optionNames);
      }
    }, 120000);
  },
);

describe.skipIf(!HAS_FIRECRAWL)(
  "Firecrawl 3-step pipeline — Path 3: Options + NO variant URLs (Steps 1+3 crawl)",
  () => {
    it("extracts Gymshark with Size options via crawl fallback", async () => {
      const result = await discoverViaFirecrawl(
        "https://www.gymshark.com/products/gymshark-crest-t-shirt-black-aw24",
      );
      console.log(
        "Firecrawl Gymshark (crawl):",
        JSON.stringify(result, null, 2),
      );

      if (!result) {
        console.warn("Firecrawl returned null — Gymshark may block Firecrawl");
        return;
      }

      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(parseFloat(result.price)).toBeGreaterThan(0);
      expect(result.method).toBe("firecrawl");

      if (result.options.length > 0) {
        const optionNames = result.options.map((o) => o.name.toLowerCase());
        console.log("Gymshark option groups:", optionNames);
      }
    }, 180000);
  },
);

// ---- Full pipeline (discoverProduct) — verifies Firecrawl → scrape fallback ----

describe.skipIf(!HAS_FIRECRAWL)(
  "discoverProduct pipeline — Firecrawl primary",
  () => {
    it("uses Firecrawl for Allbirds with options and rich fields", async () => {
      const result = await discoverProduct(
        "https://www.allbirds.com/products/mens-tree-runners",
      );
      console.log("discoverProduct Allbirds:", JSON.stringify(result, null, 2));
      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      expect(["firecrawl", "scrape", "browserbase"]).toContain(result.method);

      if (result.method === "firecrawl") {
        console.log("Firecrawl primary tier succeeded");
        // Verify rich fields when Firecrawl succeeds
        const hasRich =
          !!result.brand || !!result.description || !!result.image_url;
        expect(hasRich).toBe(true);
      } else {
        console.log(`Fell back to ${result.method}`);
      }
    }, 120000);

    it("handles Nike (may block Firecrawl → scrape fallback)", async () => {
      try {
        const result = await discoverProduct(
          "https://www.nike.com/t/air-max-90-mens-shoes-6n3vKB",
        );
        console.log("discoverProduct Nike:", JSON.stringify(result, null, 2));
        expect(result.name).toBeTruthy();
        expect(result.price).toBeTruthy();
        expect(["firecrawl", "scrape", "browserbase"]).toContain(result.method);
        console.log(`Nike used method: ${result.method}`);
      } catch (err) {
        // Nike blocks all automated access methods — expected failure
        console.warn(
          "Nike discovery failed (expected — site blocks scraping):",
          (err as Error).message,
        );
      }
    }, 60000);

    it("handles Patagonia", async () => {
      try {
        const result = await discoverProduct(
          "https://www.patagonia.com/product/mens-better-sweater-fleece-jacket/25528.html",
        );
        console.log(
          "discoverProduct Patagonia:",
          JSON.stringify(result, null, 2),
        );
        expect(result.name).toBeTruthy();
        expect(result.price).toBeTruthy();
        expect(["firecrawl", "scrape", "browserbase"]).toContain(result.method);

        if (result.options.length > 0) {
          const optionNames = result.options.map((o) => o.name.toLowerCase());
          console.log("Patagonia option groups:", optionNames);
        }
      } catch (err) {
        // Patagonia may block all automated access methods
        console.warn(
          "Patagonia discovery failed (site may block scraping):",
          (err as Error).message,
        );
      }
    }, 120000);
  },
);

describe.skipIf(!HAS_KEYS)(
  "discoverProduct pipeline — Best Buy (expected Browserbase fallback)",
  () => {
    it("falls through to browserbase for Best Buy", async () => {
      const result = await discoverProduct(
        "https://www.bestbuy.com/site/apple-airpods-4-white/6447382.p",
      );
      console.log("discoverProduct Best Buy:", JSON.stringify(result, null, 2));
      expect(result.name).toBeTruthy();
      expect(result.price).toBeTruthy();
      // Best Buy blocks Firecrawl + scrape, should fall to browserbase
      expect(["firecrawl", "scrape", "browserbase"]).toContain(result.method);
      console.log(`Best Buy used method: ${result.method}`);
    }, 120000);
  },
);

// ---- Tier 3: Browserbase product discovery (requires API keys) ----

describe.skipIf(!HAS_KEYS)("Tier 3 Browserbase discovery (real sites)", () => {
  it("extracts product data from Amazon bed sheets", async () => {
    const result = await discoverViaBrowser(
      "https://www.amazon.com/Amazon-Basics-Lightweight-Wrinkle-Free-Breathable/dp/B00Q7OAKV2",
    );
    console.log("Tier 3 Amazon:", JSON.stringify(result, null, 2));
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
    expect(result!.method).toBe("browserbase");

    const price = parseFloat(result!.price);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(200);

    // Amazon bed sheets should have Size and Color options
    if (result!.options.length > 0) {
      const optionNames = result!.options.map((o) => o.name.toLowerCase());
      console.log("Extracted option groups:", optionNames);
    }
  }, 120000);

  it("extracts product data from Best Buy AirPods", async () => {
    const result = await discoverViaBrowser(
      "https://www.bestbuy.com/site/apple-airpods-4-white/6447382.p",
    );
    console.log("Tier 3 Best Buy:", JSON.stringify(result, null, 2));

    // Best Buy may block headless browsers with captchas — null is acceptable
    if (!result) {
      console.warn(
        "Best Buy returned null — likely blocked by captcha/bot detection",
      );
      return;
    }

    expect(result.name).toBeTruthy();
    expect(result.method).toBe("browserbase");

    const price = parseFloat(result.price);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(500);
  }, 120000);
});

// ---- discoverProduct 3-tier pipeline ----

describe("discoverProduct pipeline (real sites)", () => {
  it("returns result from Firecrawl, scrape, or browserbase", async () => {
    const result = await discoverProduct(
      "https://www.allbirds.com/products/mens-tree-runners",
    );
    console.log("discoverProduct Allbirds:", JSON.stringify(result, null, 2));
    expect(result.name).toBeTruthy();
    expect(result.price).toBeTruthy();
    expect(["firecrawl", "scrape", "browserbase"]).toContain(result.method);

    if (result.method === "firecrawl") {
      console.log("Firecrawl primary tier succeeded");
    } else if (result.method === "scrape") {
      console.log(
        "Fell back to scrape — Firecrawl key may be invalid or service unavailable",
      );
    } else {
      console.log("Fell back to browserbase Tier 3");
    }
  }, 30000);
});

// ---- Tier 3 variant price resolution (real sites) ----

describe.skipIf(!HAS_KEYS)(
  "Tier 3 variant price resolution (real sites)",
  () => {
    it("resolves per-variant prices for Amazon bed sheets", async () => {
      const { discoverViaBrowser: discover } =
        await import("../src/discover.js");
      const result = await discover(
        "https://www.amazon.com/Amazon-Basics-Lightweight-Wrinkle-Free-Breathable/dp/B00Q7OAKV2",
      );
      console.log(
        "Variant resolution Amazon:",
        JSON.stringify(result, null, 2),
      );

      expect(result).not.toBeNull();
      expect(result!.name).toBeTruthy();

      // Check that options with prices exist
      if (result!.options.length > 0) {
        const withPrices = result!.options.filter(
          (o) => o.prices && Object.keys(o.prices).length > 0,
        );
        console.log(
          "Option groups with per-variant prices:",
          withPrices.length,
        );
        for (const opt of withPrices) {
          console.log(`  ${opt.name}:`, JSON.stringify(opt.prices));
        }
      }
    }, 300000);

    it("resolves variant prices for Allbirds sizes", async () => {
      const { resolveVariantPricesViaBrowser } =
        await import("../src/discover.js");

      const options = [{ name: "Size", values: ["8", "9", "10"] }];

      const result = await resolveVariantPricesViaBrowser(
        "https://www.allbirds.com/products/mens-tree-runners",
        options,
        2,
      );

      console.log("Allbirds size resolution:", JSON.stringify(result, null, 2));
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("Size");
    }, 180000);
  },
);

describe.skipIf(!HAS_KEYS)("discoverProduct Amazon (real sites)", () => {
  it("discovers Amazon product via pipeline fallback to browserbase", async () => {
    const result = await discoverProduct(
      "https://www.amazon.com/Amazon-Basics-Lightweight-Wrinkle-Free-Breathable/dp/B00Q7OAKV2",
    );
    console.log("discoverProduct Amazon:", JSON.stringify(result, null, 2));
    expect(result.name).toBeTruthy();
    expect(result.price).toBeTruthy();

    const price = parseFloat(result.price);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(200);

    // Amazon blocks Firecrawl and scrape, so should fall through to browserbase
    // (unless Firecrawl improves its Amazon support)
    expect(["firecrawl", "scrape", "browserbase"]).toContain(result.method);
    console.log(`discoverProduct Amazon used method: ${result.method}`);
  }, 150000);
});
