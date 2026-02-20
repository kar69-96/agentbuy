import { describe, it, expect } from "vitest";
import { extractJsonLd, extractMetaTag, scrapePrice } from "../src/discover.js";

describe("extractJsonLd", () => {
  it("extracts Product from JSON-LD", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">
      {"@type": "Product", "name": "Test Widget", "offers": {"price": "19.99"}}
      </script>
      </head></html>
    `;
    const result = extractJsonLd(html);
    expect(result).not.toBeNull();
    expect(result!["@type"]).toBe("Product");
    expect(result!["name"]).toBe("Test Widget");
  });

  it("extracts Product from @graph array", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">
      {"@graph": [
        {"@type": "WebSite", "name": "My Shop"},
        {"@type": "Product", "name": "Widget Pro", "offers": {"price": "29.99"}}
      ]}
      </script>
      </head></html>
    `;
    const result = extractJsonLd(html);
    expect(result).not.toBeNull();
    expect(result!["name"]).toBe("Widget Pro");
  });

  it("returns null when no JSON-LD found", () => {
    const html = "<html><head><title>No JSON-LD</title></head></html>";
    expect(extractJsonLd(html)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">{invalid json}</script>
      </head></html>
    `;
    expect(extractJsonLd(html)).toBeNull();
  });

  it("returns null when JSON-LD has no Product type", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">
      {"@type": "WebSite", "name": "My Site"}
      </script>
      </head></html>
    `;
    expect(extractJsonLd(html)).toBeNull();
  });
});

describe("extractMetaTag", () => {
  it("extracts og:title", () => {
    const html = `<meta property="og:title" content="Cool Product">`;
    expect(extractMetaTag(html, "og:title")).toBe("Cool Product");
  });

  it("extracts product:price:amount", () => {
    const html = `<meta property="product:price:amount" content="24.99">`;
    expect(extractMetaTag(html, "product:price:amount")).toBe("24.99");
  });

  it("handles reversed attribute order", () => {
    const html = `<meta content="Test Name" property="og:title">`;
    expect(extractMetaTag(html, "og:title")).toBe("Test Name");
  });

  it("returns null for missing tag", () => {
    const html = `<meta property="og:description" content="Some desc">`;
    expect(extractMetaTag(html, "og:title")).toBeNull();
  });
});

describe("scrapePrice", () => {
  it("returns null for non-existent URL", async () => {
    const result = await scrapePrice(
      "https://this-domain-should-not-exist-12345.com/product",
    );
    expect(result).toBeNull();
  });
});
