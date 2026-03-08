# Discovery Pipeline — Unified Reference

This document describes the complete product discovery pipeline as implemented. It consolidates information from `16-firecrawl-discovery.md`, `17-query-endpoint.md`, `19-exa-discovery.md`, and `endpoints/query-endpoint.md`.

## Overview

The discovery pipeline answers: "What is this product, what does it cost, and what options does it have?"

It runs when an agent calls `POST /api/query` or `POST /api/buy`. The pipeline tries multiple extraction tiers in order of cost and speed:

```
URL --> Route Detection (x402?) --> Discovery Pipeline --> Response
                                        |
                                        v
                        +-----------------------------+
                        |   Tier 1: Firecrawl         |  Primary. Up to 3 attempts.
                        |   (parallel with Exa)       |  Browserbase+Gemini repair.
                        +-----------------------------+
                                        |
                        +-----------------------------+
                        |   Tier 1.5: Exa.ai          |  Parallel with Firecrawl.
                        |   (best-effort)             |  Handles bot-blocked sites.
                        +-----------------------------+
                                        |
                        +-----------------------------+
                        |   Tier 2: Server-side scrape |  JSON-LD, meta tags.
                        |   (fast, free)              |  No JS rendering.
                        +-----------------------------+
                                        |
                        +-----------------------------+
                        |   Tier 3: Browserbase +     |  Last resort. Headless
                        |   Stagehand (slow, accurate)|  Chrome + LLM extraction.
                        +-----------------------------+
```

## Stage 0: Route Detection

Before discovery, `routeOrder(url)` checks if the URL returns HTTP 402.

- **x402 detected**: Return immediately with price from `maxAmountRequired`. No discovery needed.
- **Not x402**: Proceed to discovery pipeline.

## Stage 1: Firecrawl (Primary)

**File:** `packages/crawling/src/discover.ts`, `packages/crawling/src/extract.ts`

Uses self-hosted Firecrawl `/v1/scrape` with LLM extraction (Gemini 2.5 Flash via `GOOGLE_API_KEY_QUERY`).

### Retry Strategy

- Up to 3 attempts with exponential backoff (2s, 4s between retries)
- Each attempt is scored by the parser ensemble
- Loop breaks early if confidence >= `QUERY_MIN_CONFIDENCE` (default 0.75)
- Per-attempt timeout: `QUERY_FIRECRAWL_TIMEOUT_MS` (default 90s)

### Content Classification

Before scoring, extracted content is classified:
- **Blocked patterns**: CAPTCHA, access denied, bot detection, Cloudflare challenge
- **Not-found patterns**: 404, product unavailable, discontinued, "no longer available"
- If classified as blocked or not-found, the attempt is rejected

### Parser Ensemble

Candidates are scored with weighted signals:

| Signal | Weight | Criteria |
|--------|--------|----------|
| Name | 0.35 | Non-empty, > 3 chars, not a URL |
| Price | 0.45 | Valid numeric price, > 0 |
| Options | 0.10 | Has at least one option with values |
| Variant URLs | 0.05 | Has at least one variant URL |
| Source bonus | 0.05 | Firecrawl gets slight bonus over Browserbase |

Minimum confidence to skip retries: 0.75

### Browserbase+Gemini Repair Path

If Firecrawl confidence is too low after 3 attempts:

1. Call the Browserbase adapter (port 3003) to render the page with a real browser
2. Convert HTML to Markdown via cheerio + turndown
3. Send Markdown to Gemini 2.5 Flash for structured extraction
4. Score the Gemini result through the same parser ensemble
5. Use whichever candidate (Firecrawl or Gemini) scores higher

### Shopify Fallback

If extraction returns no options and URL looks like Shopify:
- Fetch `{product_url}.json` for variant data
- Populate options from Shopify's native variant format

### Variant Price Resolution

After base product is discovered:

- **Step 2 (variant URLs)**: If the extraction returned `variant_urls`, scrape each URL individually to get per-variant prices. Up to `QUERY_MAX_VARIANT_URLS` (default 12) URLs, `QUERY_VARIANT_CONCURRENCY` (default 3) concurrent.
- **Step 3 (crawl)**: If options exist but no variant URLs, run Firecrawl `/v1/crawl` (maxDepth: 1) from the product page to discover variant pages.

## Stage 1.5: Exa.ai (Parallel)

**File:** `packages/crawling/src/exa.ts`

Runs in parallel with Firecrawl via `Promise.race` / early-return:

- Uses Exa.ai `/contents` endpoint with structured extraction schema
- Same extraction schema as Firecrawl (name, price, options, image_url, etc.)
- Handles sites where Firecrawl is blocked (bot detection)
- Requires `EXA_API_KEY`. Skipped entirely if not set.
- If Firecrawl succeeds first with high confidence, Exa result is discarded

See `plans/19-exa-discovery.md` for implementation details.

## Stage 2: Server-side Scrape

**File:** `packages/checkout/src/discover.ts`

Fast, free extraction from structured HTML data:

1. HTTP GET the product URL (no JS rendering)
2. Parse JSON-LD (`@type: Product`) — extract name, price, image, variants from `hasVariant`/`offers`
3. Parse Open Graph meta tags (`og:title`, `product:price:amount`)
4. If structured data found, return immediately

Falls through to Stage 3 if:
- Site returns bot-blocking page
- No structured data found
- HTTP fetch fails

## Stage 3: Browserbase + Stagehand

**File:** `packages/checkout/src/discover.ts`

Last resort. Launches a full Browserbase session:

1. Create Browserbase session (stealth mode, residential proxies, CAPTCHA solving)
2. Initialize Stagehand with Claude Sonnet 4
3. Navigate to product URL
4. Stagehand `extract()` — LLM extracts product info from the rendered page
5. For variant pricing: Stagehand agent selects each variant and reports updated price
   - Max `QUERY_MAX_VARIANTS_PER_GROUP` (default 3) per option group
   - Max `QUERY_MAX_TOTAL_VARIANT_TASKS` (default 10) total
   - `QUERY_VARIANT_CONCURRENCY` (default 3) concurrent sessions
6. Destroy session

## Discovery Method Field

The response includes `discovery_method` indicating which tier succeeded:

| Value | Meaning |
|-------|---------|
| `"x402"` | URL returned HTTP 402 — price from payment requirements |
| `"firecrawl"` | Firecrawl `/v1/scrape` with LLM extraction |
| `"exa"` | Exa.ai `/contents` with structured extraction |
| `"scrape"` | Server-side HTTP fetch + JSON-LD/meta tags |
| `"browserbase"` | Browserbase + Stagehand headless Chrome |

## Failure Priority System

When discovery fails, a failure code is assigned. Higher priority codes take precedence:

| Code | Priority | Meaning |
|------|----------|---------|
| `llm_config` | 100 | Missing API key (FIRECRAWL_API_KEY, GOOGLE_API_KEY_QUERY) |
| `blocked` | 90 | Anti-bot / CAPTCHA detected |
| `not_found` | 85 | Product page 404 / discontinued |
| `adapter_502` | 70 | Browserbase adapter returned 502 |
| `render_timeout` | 65 | Page render timed out |
| `http_error` | 60 | Non-2xx HTTP response |
| `exa_error` | 50 | Exa.ai extraction failed |
| `extract_empty` | 40 | Extraction returned no usable data |
| `transport_error` | 30 | Network / fetch failure |

Only the highest-priority failure is reported, preventing confusing multi-error messages.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `FIRECRAWL_API_KEY` | `fc-selfhosted` | Firecrawl auth. Required for Tier 1. |
| `FIRECRAWL_BASE_URL` | `http://localhost:3002` | Firecrawl server URL |
| `GOOGLE_API_KEY_QUERY` | — | Gemini 2.5 Flash for extraction |
| `EXA_API_KEY` | — | Exa.ai Stage 2.5. Skipped if not set. |
| `BROWSERBASE_API_KEY` | — | Browserbase sessions |
| `BROWSERBASE_PROJECT_ID` | — | Browserbase project |
| `QUERY_MIN_CONFIDENCE` | `0.75` | Min confidence to accept without fallback |
| `QUERY_FIRECRAWL_TIMEOUT_MS` | `90000` | Per-attempt Firecrawl timeout |
| `QUERY_MAX_VARIANT_URLS` | `12` | Max variant URLs to extract |
| `QUERY_MAX_VARIANTS_PER_GROUP` | `3` | Max variants per option group |
| `QUERY_MAX_TOTAL_VARIANT_TASKS` | `10` | Total concurrent variant tasks |
| `QUERY_VARIANT_CONCURRENCY` | `3` | Concurrent Browserbase variant sessions |

## Files Reference

| File | Package | Purpose |
|------|---------|---------|
| `discover.ts` | crawling | Main 3-tier orchestrator with diagnostics |
| `extract.ts` | crawling | Firecrawl `/v1/scrape` wrapper + content classification |
| `exa.ts` | crawling | Exa.ai `/contents` extraction |
| `browserbase-extract.ts` | crawling | Browserbase+Gemini fallback |
| `parser-ensemble.ts` | crawling | Candidate scoring and ranking |
| `variant.ts` | crawling | Variant price resolution (Steps 2/3) |
| `shopify.ts` | crawling | Shopify `.json` fallback |
| `constants.ts` | crawling | Patterns, schemas, limits |
| `providers.ts` | crawling | Pluggable provider abstraction |
| `discover.ts` | checkout | Server-side scrape + Browserbase+Stagehand discovery |
| `query.ts` | orchestrator | Query endpoint entry point |
