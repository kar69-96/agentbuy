# Query Endpoint — Product Discovery

`POST /api/query` is the entry point for product discovery. An agent calls it with a URL, and Bloon returns everything needed to make a purchase: product info, variant options with prices, and the required fields for checkout.

No wallet required. No money spent. This is a read-only lookup.

## Request

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://www.allbirds.com/products/mens-tree-runners" }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | yes | Product URL or x402 endpoint |

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

| Field | Description |
|-------|-------------|
| `product` | Name, price, image, brand, currency. Price is the default/base price. |
| `options` | Variant groups. `prices` is a value→price map, only present when variants have different prices. |
| `required_fields` | What the agent must provide in `POST /api/buy`. Shipping fields are always included for browser-route products. `selections` appears only if options exist. |
| `route` | `"x402"` or `"browserbase"` — how the purchase will be executed. |
| `discovery_method` | Which tier found the data: `"x402"`, `"firecrawl"`, `"scrape"`, or `"browserbase"`. |

## How It Works

> **Detailed pipeline documentation:** See `plans/endpoints/query-endpoint.md` for the full pipeline spec with scoring weights, env vars, failure codes, and code paths.

### Step 1: Route Detection

The orchestrator fetches the URL and checks if it returns HTTP 402 with x402 payment headers.

- **x402 detected** → return immediately with price from the 402 body, no product discovery needed, no shipping fields.
- **No x402** → proceed to product discovery.

### Step 2: Product Discovery

`discoverProduct(url)` runs a 3-tier pipeline. Each tier is tried in order; the first to succeed wins.

```
Tier 1: Firecrawl    → up to 3 attempts + Browserbase+Gemini repair, candidate ranking, variant pricing
Tier 2: Scrape       → free server-side fetch, JSON-LD + meta tags + variant extraction
Tier 3: Browserbase  → headless Chrome + Stagehand agent + per-variant interaction
```

#### Tier 1: Firecrawl (Primary)

Requires `FIRECRAWL_API_KEY`. Skipped if not set.

Uses Firecrawl's `/v1/scrape` endpoint with up to **3 attempts** (exponential backoff: 2s, 4s). Each attempt produces a candidate scored by the parser ensemble. The loop breaks early if confidence >= 0.75 with a valid price.

If confidence is too low or required fields are missing, a **Browserbase+Gemini repair path** renders the page via the Browserbase adapter and extracts product data via Gemini 2.5 Flash. All candidates are re-ranked and the best wins.

After the winning candidate is selected:
- **Shopify fallback**: If no options, tries the Shopify `.json` endpoint
- **Variant URLs found**: Runs `/v1/scrape` on each variant URL for per-variant pricing
- **Options but no variant URLs**: Runs `/v1/crawl` (maxDepth: 1) to discover variant pages

See `plans/16-firecrawl-discovery.md` for the full Firecrawl pipeline spec.

#### Tier 2: Server-Side Scrape (Free Fallback)

Plain HTTP fetch of the product URL. Parses:
- JSON-LD (`@type: Product`) — name, price, variant options from `hasVariant`/`offers`/`additionalProperty`
- Open Graph meta tags — `og:title`, `product:price:amount`

Fast (~1-2s), free, no API key needed. Works well on Shopify, most DTC stores. Fails on bot-blocked sites.

#### Tier 3: Browserbase (Last Resort)

Launches a headless Chrome session via Browserbase. Stagehand LLM agent (Gemini 2.5 Flash) navigates the page, extracts product info and variant options from the rendered DOM.

For per-variant pricing, the agent selects each variant (clicking swatches, dropdowns) and reports the updated price. Uses the Stagehand Agent API with a system prompt that distinguishes variant selectors from quantity dropdowns. Caps at 3 variants per group, 10 total tasks.

Slowest tier (~30-120s), most expensive (Browserbase session + LLM API calls), but handles anti-bot sites (Amazon, Best Buy) and pages with no structured data.

### Step 3: Build Required Fields

The orchestrator always includes standard shipping fields (name, email, phone, street, apartment, city, state, zip, country) for browser-route products.

If the product has variant options, a `selections` field is added to `required_fields` with a label listing the option names (e.g., "Product options (Color, Size)").

### Step 4: Return Response

The orchestrator assembles the `QueryResponse` with product info, options, required fields, route, and which discovery tier was used.

## Code Path

```
POST /api/query
  → packages/api/src/routes/query.ts           (validate input)
  → packages/orchestrator/src/query.ts          (orchestrate)
    → packages/x402/src/detect.ts               (route detection)
    → packages/checkout/src/discover.ts
       → discoverProduct(url)                   (main entry point)
          → discoverViaFirecrawl(url)           [Tier 1 - packages/crawling]
             → extract.ts                       (Firecrawl /v1/scrape, up to 3 attempts)
             → parser-ensemble.ts               (candidate ranking)
             → browserbase-extract.ts           (Browserbase+Gemini repair)
             → shopify.ts                       (options fallback)
             → variant.ts                       (Steps 2/3)
          → scrapePriceWithOptions(url)         [Tier 2 - checkout]
          → discoverViaBrowser(url)             [Tier 3 - checkout]
  → packages/api/src/formatters.ts              (format response)
```

## Error Cases

| Error | HTTP | When |
|-------|------|------|
| `MISSING_FIELD` | 400 | `url` not provided or empty |
| `INVALID_URL` | 400 | URL fails `new URL()` validation |
| `QUERY_FAILED` | 502 | All three discovery tiers failed |

## x402 Response (Digital Services)

For x402 endpoints, the response is minimal — no options, no shipping fields:

```json
{
  "product": {
    "name": "Weather Forecast API",
    "url": "https://api.weather402.com/forecast",
    "price": "0.10",
    "source": "api.weather402.com"
  },
  "options": [],
  "required_fields": [],
  "route": "x402",
  "discovery_method": "x402"
}
```

## What Happens Next

The agent uses the query response to:
1. Show the user the product info and price
2. Collect the required fields (shipping, selections)
3. Call `POST /api/buy` with the URL, wallet_id, shipping, and selections to get a purchase quote
4. Call `POST /api/confirm` with the order_id to execute the purchase
