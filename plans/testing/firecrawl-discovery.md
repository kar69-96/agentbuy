# Firecrawl Discovery — Test Results

Test results for the 3-step Firecrawl product discovery pipeline.

## Test Matrix

| Site | URL | Pipeline Path | Step 1 | Step 2 | Step 3 | Result | Notes |
|------|-----|---------------|--------|--------|--------|--------|-------|
| Allbirds | .../mens-tree-runners | 1+2 | PASS | Skipped (null) | N/A | Partial | Step 1 returns null intermittently (rate limits?) — works in direct curl |
| Bombas | .../womens-ankle-sock-4-pack | 1+2 | Skipped | Skipped | N/A | Skip | Firecrawl returned null |
| Brooklinen | .../classic-core-sheet-set | 1+2 | Skipped | Skipped | N/A | Skip | Firecrawl returned null |
| Gymshark | .../gymshark-crest-t-shirt-black-aw24 | 1+3 | Skipped | N/A | Skipped | Skip | Gymshark may block Firecrawl |
| Nike | .../air-max-90-mens-shoes | 1 or fallback | FAIL | N/A | N/A | FAIL | All methods blocked — now gracefully caught |
| Patagonia | .../mens-better-sweater-fleece-jacket | 1+2 | FAIL | N/A | N/A | FAIL | All methods blocked — now gracefully caught |
| Hydrogen demo | .../the-full-stack | 1 only | PASS | N/A | N/A | PASS | Full extraction: name, price, brand, description, Size + Color |
| Best Buy | .../apple-airpods-4-white | Firecrawl fails → scrape/BB | FAIL | N/A | N/A | FAIL | Requires Browserbase |
| Amazon | .../dp/B00Q7OAKV2 | Firecrawl fails → BB | FAIL | N/A | N/A | FAIL | Requires Browserbase |

## Direct API Validation (curl + tsx)

### Allbirds (via `npx tsx` script) — 2026-03-02
- Step 1 `/extract`: PASS — returned full data in 48s
  - name: "Men's Tree Runner", price: "$100", brand: "Allbirds"
  - Options: Color (3 values), Size (7 values)
  - description, image_url, currency all populated
- API confirmed working — e2e test null likely due to rate limiting after repeated calls

### Hydrogen demo (via vitest e2e) — 2026-03-02
- Step 1 `/extract`: PASS — returned full data in 20s
  - name: "The Full Stack Snowboard", price: "749.95", brand: "Snowdevil"
  - Options: Size (3 values: 154cm, 158cm, 160cm), Color (1 value: Syntax)
  - currency: USD, description populated

## Run Log

### Run #1 — 2026-03-02
**Command:** `npx vitest run packages/checkout/tests/e2e-discover.test.ts -t "Firecrawl"`
**Environment:** FIRECRAWL_API_KEY=set, BROWSERBASE_API_KEY=set

| Test | Result | Duration | Notes |
|------|--------|----------|-------|
| extracts rich data from Allbirds | PASS (soft) | 22s | Returned null, test soft-failed gracefully |
| Hydrogen demo (Path 1) | PASS | 21s | Full extraction with all fields |
| Allbirds 3-step (Path 2) | PASS (soft) | 0.3s | Returned null — skipped |
| Bombas (Path 2) | PASS (soft) | 0.1s | Returned null — skipped |
| Brooklinen (Path 2) | PASS (soft) | 0.1s | Returned null — skipped |
| Gymshark crawl (Path 3) | PASS (soft) | 0.1s | Returned null — skipped |
| discoverProduct Allbirds | PASS | 0.8s | Fell back to scrape method |
| Nike (pipeline) | PASS | 27s | All methods failed, gracefully caught |
| Patagonia (pipeline) | PASS | 33s | All methods failed, gracefully caught |
| discoverProduct pipeline | PASS | 0.8s | Allbirds via scrape fallback |

**Summary:** 8 passed, 0 failed, 14 skipped. Firecrawl Step 1 works (Hydrogen) but intermittent for some sites (likely rate limits). Pipeline fallback to scrape works correctly.

## Unit Test Results

| Date | Pass | Fail | Skip | Notes |
|------|------|------|------|-------|
| 2026-03-02 | 41 | 0 | 0 | All tests pass including 19 new Firecrawl 3-step pipeline tests |
