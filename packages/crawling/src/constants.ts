export const FIRECRAWL_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Product name or title" },
    price: { type: "string", description: "Current selling price" },
    original_price: {
      type: "string",
      description: "Original price before discount",
    },
    currency: { type: "string", description: "Currency code, e.g. USD, EUR" },
    brand: { type: "string", description: "Brand or manufacturer" },
    image_url: { type: "string", description: "Main product image URL" },
    description: { type: "string", description: "Short product description" },
    options: {
      type: "array",
      description:
        "ALL product variant option groups (Color, Size, Style, Material, etc.)",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          values: { type: "array", items: { type: "string" } },
        },
      },
    },
    variant_urls: {
      type: "array",
      description:
        "URLs for other variants of this same product (color swatches, style links, etc.)",
      items: { type: "string" },
    },
  },
} as const;

export const FIRECRAWL_EXTRACT_PROMPT =
  "Extract all product details exhaustively. Include EVERY variant group visible " +
  "on the page (Color swatches, Size buttons, Style selectors, etc.). For variant_urls, " +
  "include the href of every color swatch or variant link that loads a different variant.";

export const MAX_VARIANT_EXTRACT = 20;
export const CRAWL_PAGE_LIMIT = 25;
export const VARIANT_EXTRACT_CONCURRENCY = 5;
export const FIRECRAWL_POLL_INTERVAL_MS = 2000;
