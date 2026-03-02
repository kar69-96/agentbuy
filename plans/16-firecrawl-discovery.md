# Firecrawl Product Discovery Pipeline

Firecrawl is the **primary** product discovery tier. It runs before server-side scraping and Browserbase. The goal: extract product info, variant options, and per-variant pricing without launching a browser session.

## Environment

```
FIRECRAWL_API_KEY=fc-...
```

Required. If not set, Firecrawl tier is skipped entirely and discovery falls through to server-side scrape → Browserbase.

## Pipeline Overview

```
/extract on product URL (always — 1 API call)
    │
    ├── No options detected → done (simple product)
    │
    ├── Options + variant URLs detected → /extract on each variant URL → done
    │
    └── Options detected + NO variant URLs → /crawl (maxDepth: 1) → done
```

Three paths, mutually exclusive. Every product query starts with Step 1. Steps 2 and 3 only run when needed.

## Step 1: `/extract` on Product URL

**Always runs.** Single API call that extracts structured product data from the rendered page.

**Endpoint:** `POST https://api.firecrawl.dev/v1/extract`

**What it extracts:**

| Field | Description |
|-------|-------------|
| `name` | Product name / title |
| `price` | Current selling price |
| `original_price` | Price before discount (if on sale) |
| `currency` | Currency code (USD, EUR, etc.) |
| `brand` | Brand or manufacturer |
| `image_url` | Main product image |
| `description` | Short product description |
| `options` | Array of option groups, each with `name`, `values[]`, and optional `prices{}` |
| `variant_urls` | URLs linking to other variants of the same product |

**Also requests `"links"` format** — returns all URLs on the page. Used for future-proofing and URL pattern validation (e.g., cross-referencing LLM-detected variant URLs against actual page links).

**Decision after Step 1:**

- If `options` is empty → product has no variants. Return result. Done.
- If `options` has entries AND `variant_urls` is non-empty → go to Step 2.
- If `options` has entries AND `variant_urls` is empty → go to Step 3.

## Step 2: `/extract` on Each Variant URL

**Runs when:** Step 1 found option groups (Color, Size, etc.) **and** variant URLs.

For each variant URL, make a separate `/extract` call with the same product schema. Each call returns the product name, price, and selected options for that specific variant.

**Caps:**
- Max 20 variant URLs per product (to control credit spend)
- Calls run in parallel

**Result:** Build a per-option price map by comparing prices across variant pages. For example, if the Red variant page shows $29.99 and the Blue variant page shows $34.99, the Color option gets `prices: { "Red": "29.99", "Blue": "34.99" }`.

**Same-price filter:** If all resolved prices are identical, omit the `prices` map (variants don't affect price).

## Step 3: `/crawl` from Product URL

**Runs when:** Step 1 found option groups **but no variant URLs**. This means the page has selectors/swatches for variants but the LLM couldn't find distinct URLs for each variant.

**Endpoint:** `POST https://api.firecrawl.dev/v1/crawl`

**Configuration:**
- `maxDepth: 1` — only follow links one level deep from the product page
- Same domain only
- Extraction schema applied to every discovered page
- Limit: 25 pages max

**Result:** Filter crawled pages for ones that look like variants of the original product:
- Same or very similar product name
- Different price or different option selections
- URL structurally similar to the original (same path prefix, different slug or query param)

Build per-variant price map from matching pages, same as Step 2.

## Credit Cost

| Step | Credits | When |
|------|---------|------|
| Step 1 (product extract) | ~1 | Always |
| Step 2 (variant extracts) | ~1 per variant URL | Only when variant URLs found |
| Step 3 (crawl) | ~1 per crawled page | Only when options exist but no variant URLs |

Worst case for a product with 20 variant URLs: ~21 credits. Typical Shopify product with 5 colors: ~6 credits. Simple product with no variants: ~1 credit.

## Firecrawl Extraction Schema

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Product name or title" },
    "price": { "type": "string", "description": "Current selling price" },
    "original_price": { "type": "string", "description": "Original price before discount, if on sale" },
    "currency": { "type": "string", "description": "Currency code, e.g. USD, EUR" },
    "brand": { "type": "string", "description": "Brand or manufacturer" },
    "image_url": { "type": "string", "description": "Main product image URL" },
    "description": { "type": "string", "description": "Short product description" },
    "options": {
      "type": "array",
      "description": "ALL product variant option groups (Color, Size, Style, Material, Width, etc.)",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Option group name" },
          "values": { "type": "array", "items": { "type": "string" }, "description": "All available values" },
          "prices": {
            "type": "object",
            "description": "Map of value→price if different values have different prices",
            "additionalProperties": { "type": "string" }
          }
        }
      }
    },
    "variant_urls": {
      "type": "array",
      "description": "URLs for other variants of this same product (from color swatches, style links, etc.)",
      "items": { "type": "string" }
    }
  }
}
```

The same schema is used for Step 1, Step 2, and the extraction within Step 3's crawl.

## Where Firecrawl Fails (→ Browserbase)

Firecrawl cannot handle:
- **Anti-bot sites** — pages that require JavaScript interaction, CAPTCHAs, or bot detection bypass (Amazon, Best Buy)
- **Single-URL variant sites** — pages where all variants live on one URL behind JavaScript interactions (no separate URLs to crawl)
- **Login-gated pricing** — sites that require authentication to show prices

These fall through to Browserbase Tier 3 (headless Chrome + Stagehand agent).

## Full Discovery Pipeline (All Tiers)

```
1. Firecrawl /extract (primary — rich data + variant pricing)
      ↓ if Firecrawl fails or FIRECRAWL_API_KEY not set
2. Server-side scrape (free — JSON-LD + meta tags)
      ↓ if scrape fails (bot-blocked, no structured data)
3. Browserbase + Stagehand (last resort — headless Chrome + LLM)
      ↓ if all fail
   BloonError: QUERY_FAILED
```

## Files

| File | Role |
|------|------|
| `packages/checkout/src/discover.ts` | All discovery logic: Firecrawl, scrape, Browserbase |
| `packages/checkout/src/session.ts` | Browserbase session lifecycle |
| `packages/checkout/src/cost-tracker.ts` | Credit and session cost instrumentation |
| `packages/checkout/tests/e2e-discover.test.ts` | E2E tests against real sites |
| `packages/checkout/tests/variant-price.test.ts` | Unit tests for variant price resolution |
