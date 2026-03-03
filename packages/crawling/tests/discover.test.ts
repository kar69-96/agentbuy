import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discoverViaFirecrawl } from "../src/discover.js";

// Use a test base URL for all Firecrawl mock tests
const TEST_BASE_URL = "https://api.firecrawl.dev";

describe("discoverViaFirecrawl", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("returns null when FIRECRAWL_API_KEY not set", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when API returns non-OK", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("error", { status: 500 }));
    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).toBeNull();
  });

  it("returns null when extract has no name/price", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { json: { description: "A product" } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).toBeNull();
  });

  it("maps all fields from full response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Tree Runner",
              price: "98.00",
              original_price: "120.00",
              currency: "USD",
              brand: "Allbirds",
              image_url: "https://img.com/main.jpg",
              description: "Lightweight running shoe",
              options: [
                {
                  name: "Size",
                  values: ["9", "10", "11"],
                  prices: { "9": "$89.00", "10": "$89.00", "11": "$95.00" },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Tree Runner");
    expect(result!.price).toBe("98.00");
    expect(result!.original_price).toBe("120.00");
    expect(result!.currency).toBe("USD");
    expect(result!.brand).toBe("Allbirds");
    expect(result!.image_url).toBe("https://img.com/main.jpg");
    expect(result!.description).toBe("Lightweight running shoe");
    expect(result!.options).toHaveLength(1);
    expect(result!.options[0].name).toBe("Size");
    expect(result!.options[0].prices).toEqual({
      "9": "89.00",
      "10": "89.00",
      "11": "95.00",
    });
    expect(result!.method).toBe("firecrawl");
  });

  it("strips currency symbol from price", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { json: { name: "Widget", price: "$99.99" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result!.price).toBe("99.99");
  });

  it("returns empty options when not in extract", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { json: { name: "Simple Item", price: "10.00" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result!.options).toEqual([]);
  });

  it("strips currency from option prices", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Sneaker",
              price: "$120.00",
              options: [
                {
                  name: "Size",
                  values: ["9", "10"],
                  prices: { "9": "$110.00", "10": "€120.00" },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    expect(result!.options[0].prices).toEqual({
      "9": "110.00",
      "10": "120.00",
    });
  });

  it("sends POST to /v1/scrape with correct body", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { json: { name: "Test", price: "10.00" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await discoverViaFirecrawl("https://example.com/product");

    expect(fetchSpy).toHaveBeenCalledWith(
      `${TEST_BASE_URL}/v1/scrape`,
      expect.objectContaining({
        method: "POST",
      }),
    );

    // Verify body contains url, formats, jsonOptions
    const callArgs = fetchSpy.mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.url).toBe("https://example.com/product");
    expect(body.formats).toEqual(["json"]);
    expect(body.jsonOptions).toBeDefined();
    expect(body.jsonOptions.schema).toBeDefined();
    expect(body.jsonOptions.prompt).toBeDefined();
  });
});

// ---- Scrape error handling tests (replaces async polling) ----

describe("discoverViaFirecrawl — scrape error handling", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("returns null when scrape response indicates failure", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).toBeNull();
  });

  it("returns null when fetch rejects (e.g. timeout)", async () => {
    fetchSpy.mockRejectedValueOnce(
      new DOMException("The operation was aborted", "AbortError"),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).toBeNull();
  });

  it("returns data directly without polling (synchronous scrape)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { json: { name: "Sync Product", price: "29.99" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Sync Product");

    // Only one fetch call (no polling)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ---- Step 2: Variant URL resolution via /scrape ----

describe("discoverViaFirecrawl — Step 2: variant URL resolution", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("resolves per-variant prices from variant URLs", async () => {
    // Step 1: product with options + variant_urls
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Sneaker",
              price: "$100.00",
              options: [{ name: "Color", values: ["Red", "Blue"] }],
              variant_urls: [
                "https://example.com/sneaker-red",
                "https://example.com/sneaker-blue",
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Step 2: variant URL extracts
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Sneaker - Red",
              price: "$95.00",
              options: [{ name: "Color", values: ["Red"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Sneaker - Blue",
              price: "$110.00",
              options: [{ name: "Color", values: ["Blue"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/sneaker");
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(1);

    const colorOpt = result!.options[0];
    expect(colorOpt.name).toBe("Color");
    expect(colorOpt.prices).toBeDefined();
    expect(colorOpt.prices!["Red"]).toBe("95.00");
    expect(colorOpt.prices!["Blue"]).toBe("110.00");
  });

  it("caps variant URLs at MAX_VARIANT_EXTRACT (20)", async () => {
    const manyUrls = Array.from(
      { length: 25 },
      (_, i) => `https://example.com/variant-${i}`,
    );

    // Step 1: product with 25 variant URLs
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Product",
              price: "$50.00",
              options: [{ name: "Color", values: ["A"] }],
              variant_urls: manyUrls,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Mock all variant extracts to return null (we're just counting calls)
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { json: {} } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await discoverViaFirecrawl("https://example.com/product");

    // 1 (Step 1) + 20 (capped variant URLs) = 21 total calls
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(21);
  });

  it("omits prices when all variants have same price (same-price filter)", async () => {
    // Step 1
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Shirt",
              price: "$30.00",
              options: [{ name: "Color", values: ["Red", "Blue"] }],
              variant_urls: [
                "https://example.com/shirt-red",
                "https://example.com/shirt-blue",
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Both variants return same price
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Shirt",
              price: "$30.00",
              options: [{ name: "Color", values: ["Red"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Shirt",
              price: "$30.00",
              options: [{ name: "Color", values: ["Blue"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/shirt");
    expect(result).not.toBeNull();
    const colorOpt = result!.options[0];
    expect(colorOpt.prices).toBeUndefined();
  });

  it("handles variant extract failure gracefully for some URLs", async () => {
    // Step 1
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Shoe",
              price: "$80.00",
              options: [{ name: "Color", values: ["Red", "Blue", "Green"] }],
              variant_urls: [
                "https://example.com/shoe-red",
                "https://example.com/shoe-blue",
                "https://example.com/shoe-green",
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Red succeeds
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Shoe",
              price: "$80.00",
              options: [{ name: "Color", values: ["Red"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    // Blue fails
    fetchSpy.mockResolvedValueOnce(new Response("error", { status: 500 }));
    // Green succeeds with different price
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Shoe",
              price: "$90.00",
              options: [{ name: "Color", values: ["Green"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/shoe");
    expect(result).not.toBeNull();
    const colorOpt = result!.options[0];
    // Should still have prices from successful extracts
    expect(colorOpt.prices).toBeDefined();
    expect(colorOpt.prices!["Red"]).toBe("80.00");
    expect(colorOpt.prices!["Green"]).toBe("90.00");
    // Blue was not resolved
    expect(colorOpt.prices!["Blue"]).toBeUndefined();
  });
});

// ---- Step 3: Crawl fallback ----

describe("discoverViaFirecrawl — Step 3: crawl fallback", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("triggers crawl when options exist but no variant_urls", async () => {
    // Step 1: options but no variant_urls
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Crest T-Shirt",
              price: "$25.00",
              options: [{ name: "Size", values: ["S", "M", "L"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Step 3: /crawl returns async job
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, id: "crawl-001" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Poll: completed with relevant pages
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "completed",
          data: [
            {
              extract: {
                name: "Crest T-Shirt Black",
                price: "$25.00",
                options: [{ name: "Size", values: ["S"] }],
              },
            },
            {
              extract: {
                name: "Crest T-Shirt White",
                price: "$30.00",
                options: [{ name: "Size", values: ["M"] }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/tshirt");
    expect(result).not.toBeNull();

    // Verify /crawl was called (second fetch call)
    expect(fetchSpy.mock.calls[1]![0]).toBe(
      `${TEST_BASE_URL}/v1/crawl`,
    );

    const sizeOpt = result!.options[0];
    expect(sizeOpt.name).toBe("Size");
    expect(sizeOpt.prices).toBeDefined();
    expect(sizeOpt.prices!["S"]).toBe("25.00");
    expect(sizeOpt.prices!["M"]).toBe("30.00");
  });

  it("filters crawled pages with different product names", async () => {
    // Step 1
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Classic Core Sheet Set",
              price: "$100.00",
              options: [{ name: "Size", values: ["Twin", "Queen"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Crawl
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, id: "crawl-002" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "completed",
          data: [
            {
              extract: {
                name: "Classic Core Sheet Set - Twin",
                price: "$90.00",
                options: [{ name: "Size", values: ["Twin"] }],
              },
            },
            {
              extract: {
                name: "Completely Different Product - Pillow",
                price: "$50.00",
                options: [{ name: "Size", values: ["Queen"] }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/sheets");
    expect(result).not.toBeNull();

    const sizeOpt = result!.options[0];
    // Only the matching product page should contribute
    expect(sizeOpt.prices).toBeUndefined(); // Only one matching page, can't build multi-price map
  });

  it("returns options without prices when crawl returns all same prices", async () => {
    // Step 1
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Uniform Product",
              price: "$50.00",
              options: [{ name: "Color", values: ["Red", "Blue"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Crawl
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, id: "crawl-003" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "completed",
          data: [
            {
              extract: {
                name: "Uniform Product Red",
                price: "$50.00",
                options: [{ name: "Color", values: ["Red"] }],
              },
            },
            {
              extract: {
                name: "Uniform Product Blue",
                price: "$50.00",
                options: [{ name: "Color", values: ["Blue"] }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    const colorOpt = result!.options[0];
    expect(colorOpt.prices).toBeUndefined();
  });

  it("degrades gracefully when crawl times out", async () => {
    // Step 1
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Timeout Product",
              price: "$40.00",
              options: [{ name: "Size", values: ["S", "M"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Crawl POST
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, id: "crawl-timeout" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // All polls: still processing (timeout)
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ status: "processing" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Timeout Product");
    // Options returned without prices (graceful degradation)
    expect(result!.options).toHaveLength(1);
    expect(result!.options[0].prices).toBeUndefined();
  }, 180_000);
});

// ---- Pipeline routing tests ----

describe("discoverViaFirecrawl — pipeline routing", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("only runs Step 1 when no options found", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { json: { name: "Simple Product", price: "$10.00" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    expect(result!.options).toEqual([]);
    // Only one fetch call (Step 1)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("runs Step 2 when options + variant_urls, does NOT crawl", async () => {
    // Step 1: options + variant_urls
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Product",
              price: "$50.00",
              options: [{ name: "Color", values: ["Red"] }],
              variant_urls: ["https://example.com/product-red"],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Step 2: variant URL extract
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Product Red",
              price: "$50.00",
              options: [{ name: "Color", values: ["Red"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await discoverViaFirecrawl("https://example.com/product");

    // Step 1 + Step 2 variant extract = 2 calls (no /crawl)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Verify no /crawl call
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain("/v1/crawl");
    }
  });

  it("runs Step 3 (crawl) when options + no variant_urls", async () => {
    // Step 1: options but no variant_urls
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Product",
              price: "$50.00",
              options: [{ name: "Size", values: ["S", "M"] }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Step 3: crawl POST
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, id: "crawl-routing" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Crawl poll: completed with empty data
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "completed", data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await discoverViaFirecrawl("https://example.com/product");

    // Verify /crawl was called
    expect(String(fetchSpy.mock.calls[1]![0])).toContain("/v1/crawl");
  });
});

// ---- Field passthrough tests ----

describe("discoverViaFirecrawl — field passthrough", () => {
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  const originalBaseUrl = process.env.FIRECRAWL_BASE_URL;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = TEST_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.FIRECRAWL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.FIRECRAWL_BASE_URL;
    }
    fetchSpy.mockRestore();
  });

  it("passes description from extract to result", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Product",
              price: "10.00",
              description: "A great product for everyone",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/product");
    expect(result).not.toBeNull();
    expect(result!.description).toBe("A great product for everyone");
  });

  it("passes brand, image_url, currency, original_price correctly", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            json: {
              name: "Premium Widget",
              price: "$99.99",
              original_price: "$149.99",
              currency: "EUR",
              brand: "WidgetCo",
              image_url: "https://img.example.com/widget.jpg",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await discoverViaFirecrawl("https://example.com/widget");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("WidgetCo");
    expect(result!.image_url).toBe("https://img.example.com/widget.jpg");
    expect(result!.currency).toBe("EUR");
    expect(result!.original_price).toBe("149.99");
    expect(result!.price).toBe("99.99");
  });
});
