# Query Endpoint — Full Discovery Pipeline

`POST /api/query` is the read-only product discovery endpoint. Given a URL, it returns everything an agent needs to make a purchase: product info, variant options with per-variant prices, and required fields for checkout.

No wallet required. No money spent.

---

## Request

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://www.allbirds.com/products/mens-tree-runners" }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | yes | Product URL or x402 endpoint |

---

## Pipeline Overview

The query endpoint runs a multi-stage pipeline with fallbacks at each level. The pipeline is split between two packages:

- **`packages/crawling`** — Firecrawl extraction + Browserbase+Gemini fallback (headless rendering)
- **`packages/checkout`** — Server-side scrape, Browserbase+Stagehand browser agent, orchestration

```
POST /api/query
  |
  v
[Route Detection] ── x402 detected? ── YES ──> return x402 response (no discovery)
  |
  NO
  |
  v
[Primary: Firecrawl Pipeline]          (packages/crawling/src/discover.ts)
  |  - Up to 3 attempts with exponential backoff
  |  - Confidence-based candidate ranking
  |  - Browserbase+Gemini repair path if confidence < 0.75
  |  - Shopify .json fallback for options
  |  - Variant price resolution (Step 2/3)
  |
  | success? ──> return result
  |
  v
[Fallback: Server-Side Scrape]         (packages/checkout/src/discover.ts)
  |  - JSON-LD parsing (@type: Product)
  |  - Open Graph / meta tag extraction
  |  - Variant extraction from hasVariant/offers
  |
  | success? ──> return result
  |
  v
[Last Resort: Browserbase+Stagehand]   (packages/checkout/src/discover.ts)
  |  - Full headless Chrome session
  |  - Stagehand LLM agent extracts product data
  |  - Per-variant pricing via agent interaction
  |
  | success? ──> return result
  |
  v
[Error: QUERY_FAILED (502)]
```

---

## Stage 0: Route Detection

The orchestrator fetches the URL and checks for HTTP 402 with x402 payment headers.

- **x402 detected**: Return immediately with price from the 402 body. No product discovery, no shipping fields, `route: "x402"`, `discovery_method: "x402"`.
- **No x402**: Proceed to product discovery pipeline.

---

## Stage 1: Firecrawl Pipeline (Primary)

**Entry point:** `discoverViaFirecrawl(url)` in `packages/crawling/src/discover.ts`

Requires `FIRECRAWL_API_KEY`. If not configured, returns `null` with `failure_code: "llm_config"`.

### Step 1a: Firecrawl Extraction (up to 3 attempts)

Calls Firecrawl's `/v1/scrape` with JSON extraction schema to pull structured product data from the rendered page.

```
Attempt 0: immediate
Attempt 1: wait 2s, retry
Attempt 2: wait 4s, retry
```

Each attempt produces a **candidate** that gets scored by the parser ensemble (`packages/crawling/src/parser-ensemble.ts`). The loop breaks early if:
- Confidence >= `QUERY_MIN_CONFIDENCE` (default: 0.75) AND price is valid
- Price is explicitly invalid (additional retries won't help)

**Extraction includes:** name, price, original_price, currency, brand, image_url, description, options (variant groups), variant_urls.

**Content classification** happens before extraction — the raw markdown is checked against:
- **BLOCKED_PATTERNS** (24 patterns): Cloudflare challenges, CAPTCHAs, Akamai/PerimeterX/DataDome, Incapsula, DistilNetworks, generic bot detection
- **NOT_FOUND_PATTERNS** (24 patterns): "product not found", "discontinued", "no longer available", 404 indicators

Classification results in either `ProductBlockedError` or `ProductNotFoundError` being thrown.

### Step 1b: Browserbase+Gemini Repair Path (conditional)

Triggered when:
- No valid candidate after Firecrawl attempts (missing name or price), OR
- Best candidate has confidence < 0.75 but does have a valid price

**Pipeline:**
1. Fetch rendered HTML from the Browserbase adapter (`POST localhost:3003/scrape`)
2. Convert HTML to markdown via `htmlToMarkdown()` — tries main-content selectors first, falls back to full page with boilerplate stripped, caps at 30k chars
3. Extract product data via Gemini 2.5 Flash with structured JSON output
4. Add Browserbase result as another candidate for ranking

The Browserbase result gets a +0.02 source prior in the ranking, giving it a slight edge on ties.

### Step 1c: Candidate Ranking (Parser Ensemble)

All candidates (from Firecrawl attempts + optional Browserbase) are scored and the highest-confidence candidate wins.

**Scoring weights:**
| Signal | Weight | Notes |
|--------|--------|-------|
| Name present | +0.35 | |
| Valid price | +0.45 | Must match numeric pattern |
| Weak/unparseable price | +0.10 | Has price text but not valid format |
| Options signal | +0.10 | Scaled by ratio of populated option groups |
| Variant URLs | +0.05 | |
| Description | +0.03 | |
| Image URL | +0.01 | |
| Currency | +0.01 | |
| Browserbase source | +0.02 | Slight bias toward browser-rendered data |

**Maximum possible score:** 1.0 (name + valid price + full options + variant URLs + description + image + currency + browserbase)

**Minimum to proceed:** Must have a valid price. If no candidate has a valid price, the pipeline fails with diagnostics.

### Step 1d: Shopify Fallback for Options

If the winning candidate has no options, the pipeline tries `fetchShopifyOptions(url)` — hits the Shopify `.json` product endpoint (e.g., `example.com/products/foo.json`). If the URL is a Shopify store and has variant data, options are populated from the Shopify API.

### Step 1e: Variant Price Resolution (conditional)

Only runs if options exist. Two sub-paths:

**Path A — Variant URLs available (`resolveVariantPricesViaFirecrawl`):**
- Dedupes variant URLs, excludes current URL, caps at `QUERY_MAX_VARIANT_URLS` (default: 12)
- Runs `/v1/scrape` on each via concurrency pool (`VARIANT_EXTRACT_CONCURRENCY`: 5)
- Builds per-option price maps, merges into base options
- Same-price filter: if all values have identical prices, omits the price map

**Path B — No variant URLs (`resolveVariantPricesViaCrawl`):**
- Runs Firecrawl `/v1/crawl` from product URL with `maxDepth: 1`
- Filters results by word overlap with base product name (>= 0.3 threshold)
- Builds per-option price maps from relevant pages

### Failure Tracking

The pipeline tracks the **highest-priority failure** across all attempts:

| Failure Code | Priority | Meaning |
|--------------|----------|---------|
| `llm_config` | 100 | Missing FIRECRAWL_API_KEY |
| `blocked` | 90 | Anti-bot/CAPTCHA detected |
| `not_found` | 85 | Product page is 404/discontinued |
| `adapter_502` | 70 | Browserbase adapter returned 502 |
| `render_timeout` | 65 | Page render timed out |
| `http_error` | 60 | Non-2xx HTTP response |
| `extract_empty` | 40 | Extraction returned no usable data |
| `transport_error` | 30 | Network/fetch failure |

Higher-priority failures overwrite lower-priority ones. This ensures the most actionable failure code is surfaced.

---

## Stage 2: Server-Side Scrape (Fallback)

**Entry point:** `scrapePriceWithOptions(url)` in `packages/checkout/src/discover.ts`

Plain HTTP fetch with a Chrome user-agent. Parses:

1. **JSON-LD** (`<script type="application/ld+json">`):
   - Looks for `@type: "Product"` (direct or in `@graph` array)
   - Extracts name, price (from `offers.price` or `offers.lowPrice`), image
   - Extracts variant options from `hasVariant[].additionalProperty` and `offers[].additionalProperty`
   - Builds per-variant price map; applies same-price filter

2. **Open Graph / meta tags**:
   - `og:title` for name
   - `product:price:amount` or `og:price:amount` for price
   - `og:image` for image

Fast (~1-2s), free, no API key needed. Works well on Shopify and most DTC stores. Fails on bot-blocked sites. Returns `method: "scrape"`.

---

## Stage 3: Browserbase + Stagehand (Last Resort)

**Entry point:** `discoverViaBrowser(url)` in `packages/checkout/src/discover.ts`

Requires `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, and a query model API key (Google).

### Product Extraction
1. Creates a fresh Browserbase session
2. Initializes Stagehand with `google/gemini-2.5-flash`
3. Navigates to URL, waits for content, dismisses popups
4. Uses `stagehand.extract()` to pull product data from the rendered DOM
5. Closes the initial session

### Per-Variant Price Resolution
If options are found, spawns concurrent Browserbase sessions to resolve per-variant prices:

1. Builds a task list from option values that don't yet have prices
2. Caps at `QUERY_MAX_VARIANTS_PER_GROUP` (default: 3) per option group, `QUERY_MAX_TOTAL_VARIANT_TASKS` (default: 10) total
3. For each task, launches a fresh session with a Stagehand Agent that:
   - Navigates to the product page
   - Selects the specified variant (clicking swatches/dropdowns)
   - Reports the updated price
4. Merges results into options with same-price filter

Returns `method: "browserbase"`. Slowest tier (~30-120s), most expensive.

---

## Response

```json
{
  "product": {
    "name": "Men's Tree Runners",
    "url": "https://www.allbirds.com/products/mens-tree-runners",
    "price": "98.00",
    "source": "www.allbirds.com",
    "image_url": "https://cdn.allbirds.com/...",
    "brand": "Allbirds",
    "currency": "USD"
  },
  "options": [
    {
      "name": "Color",
      "values": ["Basin Blue", "Natural White", "Bough Green"],
      "prices": { "Basin Blue": "98.00", "Natural White": "98.00", "Bough Green": "110.00" }
    },
    {
      "name": "Size",
      "values": ["8", "9", "10", "11", "12"]
    }
  ],
  "required_fields": [
    { "field": "shipping.name", "label": "Full name" },
    { "field": "shipping.email", "label": "Email address" },
    { "field": "shipping.phone", "label": "Phone number" },
    { "field": "shipping.street", "label": "Street address" },
    { "field": "shipping.apartment", "label": "Apartment / Floor / Suite" },
    { "field": "shipping.city", "label": "City" },
    { "field": "shipping.state", "label": "State / Province" },
    { "field": "shipping.zip", "label": "ZIP / Postal code" },
    { "field": "shipping.country", "label": "Country" },
    { "field": "selections", "label": "Product options (Color, Size)" }
  ],
  "route": "browserbase",
  "discovery_method": "firecrawl"
}
```

### Response Fields

| Field | Description |
|-------|-------------|
| `product` | Name, price, image, brand, currency. Price is the default/base price (currency symbol stripped). |
| `options` | Variant groups. `prices` is a value-to-price map, only present when variants have different prices. |
| `required_fields` | What the agent must provide in `POST /api/buy`. Shipping fields always included for browser-route products. `selections` appears only if options exist. |
| `route` | `"x402"` or `"browserbase"` — how the purchase will be executed. |
| `discovery_method` | Which source found the data: `"x402"`, `"firecrawl"`, `"browserbase"`, or `"scrape"`. |

---

## Environment Variables

### Firecrawl Pipeline

| Variable | Default | Description |
|----------|---------|-------------|
| `FIRECRAWL_API_KEY` | — | Required for Firecrawl extraction |
| `QUERY_MIN_CONFIDENCE` | `0.75` | Minimum confidence to accept a Firecrawl candidate without fallback |
| `QUERY_FIRECRAWL_TIMEOUT_MS` | `90000` | Per-attempt timeout for Firecrawl scrape |
| `QUERY_MAX_VARIANT_URLS` | `12` | Max variant URLs to extract in Step 2 |

### Browserbase Adapter (used by Firecrawl fallback)

| Variable | Default | Description |
|----------|---------|-------------|
| `ADAPTER_PORT` | `3003` | Port the Browserbase adapter listens on |
| `BB_EXTRACT_CONCURRENCY` | `5` | Max concurrent Browserbase fallback extractions |
| `BB_EXTRACT_QUEUE_TIMEOUT_MS` | `15000` | Queue timeout waiting for a Browserbase slot |
| `GEMINI_EXTRACT_TIMEOUT_MS` | `20000` | Timeout for Gemini structured extraction |
| `GEMINI_EXTRACT_RETRIES` | `2` | Number of Gemini extraction retries |

### Browserbase + Stagehand (Tier 3)

| Variable | Default | Description |
|----------|---------|-------------|
| `QUERY_MAX_VARIANTS_PER_GROUP` | `3` | Max variants to resolve per option group |
| `QUERY_MAX_TOTAL_VARIANT_TASKS` | `10` | Max total variant resolution tasks |
| `QUERY_VARIANT_CONCURRENCY` | `3` | Concurrent Browserbase sessions for variant resolution |

---

## Error Cases

| Error | HTTP | When |
|-------|------|------|
| `MISSING_FIELD` | 400 | `url` not provided or empty |
| `INVALID_URL` | 400 | URL fails `new URL()` validation |
| `QUERY_FAILED` | 502 | All discovery tiers failed |

When the Firecrawl pipeline detects `product_not_found`, the response includes `error: "product_not_found"` with empty name/price instead of throwing.

---

## Code Path

```
POST /api/query
  -> packages/api/src/routes/query.ts           (validate input)
  -> packages/orchestrator/src/query.ts          (orchestrate)
    -> packages/x402/src/detect.ts               (route detection)
    -> packages/checkout/src/discover.ts
       -> discoverProduct(url)                   (main entry point)
          -> discoverViaFirecrawl(url)           [Stage 1 - packages/crawling]
             -> extract.ts                       (Firecrawl /v1/scrape)
             -> parser-ensemble.ts               (candidate ranking)
             -> browserbase-extract.ts           (Browserbase+Gemini repair)
             -> shopify.ts                       (options fallback)
             -> variant.ts                       (Steps 2/3)
          -> scrapePriceWithOptions(url)         [Stage 2 - checkout]
          -> discoverViaBrowser(url)             [Stage 3 - checkout]
  -> packages/api/src/formatters.ts              (format response)
```

---

## What Happens Next

The agent uses the query response to:
1. Show the user the product info and price
2. Collect the required fields (shipping, selections)
3. Call `POST /api/buy` with the URL, wallet_id, shipping, and selections to get a purchase quote
4. Call `POST /api/confirm` with the order_id to execute the purchase
