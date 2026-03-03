# Firecrawl Product Discovery Pipeline

Firecrawl is the **primary** product discovery tier. It runs before server-side scraping and Browserbase. The goal: extract product info, variant options, and per-variant pricing without launching a browser session.

## Environment

```
FIRECRAWL_API_KEY=fc-...
FIRECRAWL_BASE_URL=http://localhost:3002   # default: self-hosted
# or: FIRECRAWL_BASE_URL=https://api.firecrawl.dev  # cloud
```

`FIRECRAWL_API_KEY` is required. If not set, Firecrawl tier is skipped entirely and discovery falls through to server-side scrape → Browserbase.

`FIRECRAWL_BASE_URL` defaults to `http://localhost:3002` (self-hosted). Set to `https://api.firecrawl.dev` for cloud.

## Pipeline Overview

```
/scrape on product URL (always — 1 API call, 1 LLM call)
    │
    ├── No options detected → done (simple product)
    │
    ├── Options + variant URLs detected → /scrape on each variant URL → done
    │
    └── Options detected + NO variant URLs → /crawl (maxDepth: 1) → done
```

Three paths, mutually exclusive. Every product query starts with Step 1. Steps 2 and 3 only run when needed.

## Step 1: `/scrape` on Product URL

**Always runs.** Single API call that extracts structured product data from the rendered page.

**Endpoint:** `POST {FIRECRAWL_BASE_URL}/v1/scrape`

**Why `/scrape` instead of `/extract`:** The `/v1/extract` endpoint triggers a heavy internal pipeline (schema analysis, multi-entity detection, URL mapping/reranking, SmartScrape, JSON repair) totaling 3-10+ LLM calls per request. Since we always provide an exact URL and a fixed schema, `/v1/scrape` with `formats: ["json"]` + `jsonOptions` does the same single-page extraction with **1 LLM call**, eliminating all unnecessary overhead. This improves rate limit headroom from ~2-3 to ~20 extractions/min on Gemini free tier.

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

## Step 2: `/scrape` on Each Variant URL

**Runs when:** Step 1 found option groups (Color, Size, etc.) **and** variant URLs.

For each variant URL, make a separate `/scrape` call with the same product schema + JSON format. Each call returns the product name, price, and selected options for that specific variant.

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
1. Firecrawl /scrape (primary — rich data + variant pricing, 1 LLM call)
      ↓ if Firecrawl fails or FIRECRAWL_API_KEY not set
2. Server-side scrape (free — JSON-LD + meta tags)
      ↓ if scrape fails (bot-blocked, no structured data)
3. Browserbase + Stagehand (last resort — headless Chrome + LLM)
      ↓ if all fail
   BloonError: QUERY_FAILED
```

## Self-Hosted Firecrawl

The `@bloon/crawling` package includes the open-source Firecrawl as a git submodule. Self-hosting eliminates cloud credit limits — extraction quality comes from whatever LLM you configure (we reuse the existing `GOOGLE_API_KEY` for Gemini).

**Setup:**
```bash
# Initialize the submodule (one-time)
cd packages/crawling && git submodule update --init

# Start self-hosted Firecrawl (runs on port 3002)
pnpm firecrawl:start

# Check health
pnpm firecrawl:health

# Stop
pnpm firecrawl:stop
```

**How it works:** The start script installs deps in `packages/crawling/firecrawl/apps/api` and runs the Firecrawl API server directly via Node. It configures the LLM via OpenAI-compatible API pointing to Gemini (`GOOGLE_API_KEY`).

**Trade-offs vs cloud:**
- No Fire Engine (anti-bot proxies) — not useful for our use case
- No rate limits or credit caps
- Same `/v1/scrape` and `/v1/crawl` endpoints
- LLM quality depends on your configured model (Gemini 2.5 Flash by default)

## Files

| File | Role |
|------|------|
| `packages/crawling/src/discover.ts` | Firecrawl 3-step discovery pipeline entry point |
| `packages/crawling/src/extract.ts` | `/v1/scrape` + JSON format wrapper (synchronous, 1 LLM call per URL) |
| `packages/crawling/src/crawl.ts` | `/v1/crawl` async wrapper |
| `packages/crawling/src/variant.ts` | Step 2 + Step 3 variant price resolution |
| `packages/crawling/src/client.ts` | Config: `getFirecrawlConfig()` (base URL + API key) |
| `packages/crawling/src/helpers.ts` | Price utilities: `stripCurrencySymbol`, `mapOptions`, `computeWordOverlap` |
| `packages/crawling/src/poll.ts` | Async job polling |
| `packages/crawling/src/constants.ts` | Schema, prompt, limits |
| `packages/crawling/src/types.ts` | `FirecrawlExtract`, `FirecrawlConfig` |
| `packages/crawling/firecrawl/` | Git submodule → github.com/mendableai/firecrawl |
| `packages/crawling/scripts/` | `start.sh`, `stop.sh`, `health.sh` |
| `packages/checkout/src/discover.ts` | Scrape + Browserbase discovery (imports `discoverViaFirecrawl` from `@bloon/crawling`) |
| `packages/checkout/tests/e2e-discover.test.ts` | E2E tests for scrape + browser tiers |
| `packages/crawling/tests/discover.test.ts` | 24 unit tests for Firecrawl pipeline |
| `packages/crawling/tests/e2e.test.ts` | E2E tests against real sites via Firecrawl |
| `packages/crawling/tests/comparison.test.ts` | Self-hosted vs cloud baseline validation |
