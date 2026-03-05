# Technical Spec — Bloon v1

## API vs MCP — Why API-First

| | REST API (chosen) | MCP |
|---|---|---|
| **Reach** | Any agent, any language, any framework — just HTTP | Only MCP-compatible clients |
| **Discovery** | skill.md — agents find and use Bloon immediately | Must pre-install locally |
| **Hosting** | One server, many agents, works remotely | Local only |
| **Multi-tenant path** | Natural | Full rewrite |
| **Long-running checkout** | Async HTTP — natural fit | Blocks stdio pipe |
| **Testing** | curl | Need MCP client |
| **Auth** | None for v1 (wallet_id is credential) | None (local) |
| **Build effort** | Slightly more (Hono routes vs tool handlers) | Less |

MCP wrapper planned for v2 — thin layer that calls the REST API.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Any AI Agent / curl / script / SDK                  │
└────────────────────┬────────────────────────────────┘
                     │ HTTP (no auth headers)
┌────────────────────▼────────────────────────────────┐
│               packages/api (Hono)                    │
│                                                      │
│  POST /api/wallets     GET /api/wallets/:id          │
│  POST /api/buy         POST /api/confirm             │
│  GET  /fund/:token     (HTML funding page)           │
└────┬─────────────────────────────────────────────────┘
     │
┌────▼─────────────────────────────────────────────────┐
│               packages/core                           │
│  Types, Store, Router, Fees, Receipts                 │
│  buy() orchestrator, confirm() orchestrator           │
└────┬──────────────┬──────────────┬───────────────────┘
     │              │              │
┌────▼───┐   ┌─────▼────┐   ┌────▼────────────────┐
│ wallet │   │   x402   │   │    checkout          │
│        │   │          │   │                      │
│ viem   │   │ @x402/   │   │ Stagehand (Son 4)    │
│ QR     │   │ fetch    │   │ Browserbase          │
│ balance│   │          │   │ Placeholders + Cache │
└────────┘   └──────────┘   └──────────────────────┘
```

## Monorepo Structure

```
bloon/
├── packages/
│   ├── core/src/
│   │   ├── types.ts        # All TypeScript interfaces
│   │   ├── store.ts        # JSON file persistence (~/.bloon/)
│   │   ├── router.ts       # x402 detection + route selection
│   │   ├── receipts.ts     # Uniform receipt generation
│   │   ├── fees.ts         # 2% flat fee
│   │   ├── config.ts       # Load .env + config.json
│   │   ├── buy.ts          # Buy orchestrator
│   │   ├── confirm.ts      # Confirm orchestrator
│   │   └── index.ts
│   │
│   ├── wallet/src/
│   │   ├── create.ts       # viem key generation
│   │   ├── balance.ts      # On-chain USDC balance
│   │   ├── transfer.ts     # USDC transfers (ERC-20)
│   │   ├── qr.ts           # QR code → base64 PNG
│   │   └── index.ts
│   │
│   ├── x402/src/
│   │   ├── detect.ts       # HEAD probe for 402
│   │   ├── pay.ts          # @x402/fetch from Bloon wallet
│   │   └── index.ts
│   │
│   ├── crawling/src/
│   │   ├── discover.ts              # Discovery orchestrator (3 attempts + Browserbase repair)
│   │   ├── extract.ts               # Firecrawl /v1/scrape wrapper + content classification
│   │   ├── browserbase-adapter.ts   # HTTP server: Firecrawl Playwright microservice (port 3003)
│   │   ├── browserbase-extract.ts   # Browserbase+Gemini fallback extraction
│   │   ├── parser-ensemble.ts       # Multi-source candidate scoring/ranking
│   │   ├── providers.ts             # Pluggable provider abstraction
│   │   ├── crawl.ts                 # /v1/crawl async wrapper
│   │   ├── variant.ts               # Variant price resolution (Step 2 + 3)
│   │   ├── shopify.ts               # Shopify .json fallback for options
│   │   ├── client.ts                # Firecrawl config (base URL + API key)
│   │   ├── helpers.ts               # Price utilities
│   │   ├── poll.ts                  # Async job polling
│   │   ├── constants.ts             # Schema, patterns, limits, selectors
│   │   ├── types.ts                 # FirecrawlExtract, FirecrawlConfig
│   │   └── index.ts
│   │
│   ├── checkout/src/
│   │   ├── session.ts      # Browserbase session + domain cache inject
│   │   ├── stagehand.ts     # Stagehand init + act/observe/extract
│   │   ├── placeholders.ts # Credential mapping (.env → x_* keys)
│   │   ├── discover.ts     # Scrape + Browserbase+Stagehand discovery (orchestrates all tiers)
│   │   ├── complete.ts     # Fill forms, submit, extract confirmation
│   │   ├── cache.ts        # Domain page cache (cookies/localStorage)
│   │   └── index.ts
│   │
│   └── api/src/
│       ├── server.ts       # Hono app + middleware
│       ├── routes/
│       │   ├── wallets.ts  # POST /api/wallets, GET /api/wallets/:id
│       │   ├── buy.ts      # POST /api/buy
│       │   ├── confirm.ts  # POST /api/confirm
│       │   └── fund.ts     # GET /fund/:token (HTML page)
│       └── index.ts        # Entry point: start server on :3000
│
├── .env.example
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Runtime | Node.js 20+ | Server |
| Language | TypeScript 5.x | Types |
| Package Manager | pnpm 9.x | Monorepo |
| HTTP Server | hono 4.x | REST API |
| Blockchain | viem 2.x | Wallets, USDC transfers, balances |
| x402 | @x402/fetch | Pay x402 services |
| Browser Automation | @browserbasehq/stagehand | LLM-powered checkout + discovery |
| Cloud Browser | Browserbase | Remote sessions (checkout + adapter) |
| QR Code | qrcode | PNG generation |
| LLM (Checkout) | @anthropic-ai/sdk | Sonnet 4 for Stagehand checkout |
| LLM (Discovery) | Gemini 2.5 Flash | Firecrawl extraction + Browserbase fallback |
| Product Discovery | Firecrawl (self-hosted) | Primary extraction tier via /v1/scrape |
| HTML Processing | cheerio + turndown | HTML→Markdown for Browserbase fallback |
| Gemini SDK | @google/generative-ai | Structured extraction in Browserbase fallback |

## Key Design Decisions

### 1. No Auth — wallet_id IS the Credential

No API keys. No registration. No auth headers.
- `POST /api/wallets` is open — creates wallet, returns `wallet_id`
- All other endpoints use `wallet_id` (in body or URL) as proof of ownership
- Wallet IDs are cryptographically random — unguessable
- Leaking a wallet_id = leaking spending access (acceptable for testnet/$25 cap)
- Proper auth (API keys, registration) planned for v2

### 2. Private Funding Page (`/fund/:token`)

Each wallet gets a unique funding URL:
- `GET /fund/:token` serves an HTML page with QR code + live balance
- `funding_token` is separate from `wallet_id` — different secrets, different purposes
- Leaking `funding_url` only lets someone send you money (not spend it)
- Balance polls every 10 seconds via the same API
- Modeled after BARRRYYY's QR funding pattern

### 3. Two-Phase Purchase (buy then confirm)

`POST /api/buy` returns a quote. `POST /api/confirm` executes. Agent can present the quote to the human before spending.

### 4. Shipping: Required Per-Purchase, No Defaults

- Provided in request → use it
- Omitted, browser route → return `SHIPPING_REQUIRED`
- x402 route → shipping never required

### 5. Stagehand with Claude Sonnet 4

From AgentPay. Browserbase's AI browser automation SDK — provides `act()`, `observe()`, `extract()` primitives. Card fields filled via separate Playwright CDP connection (never through Stagehand's LLM). Handles arbitrary websites.

### 6. Fresh Browserbase Sessions + Domain Caching

Each checkout = fresh session. But we cache cookies/localStorage per domain:
- Skips cookie banners, preserves preferences on repeat visits
- NOT login persistence — no auth tokens cached
- Cache stored at `~/.bloon/cache/{domain}.json`

### 7. Hono

Lightweight (14KB), TypeScript-native, runs on Node/Cloudflare/Vercel/Deno. Easy to deploy anywhere.

### 8. Closed Source

Not open source. Deployed and operated by you.

### 9. Price Discovery — Tiered Approach

`POST /api/buy` must return the **full price** the agent will pay (item + tax + shipping + Bloon fee). How that price is discovered depends on the route:

**x402 route:**
- Fetch the URL → receive 402 response → parse the JSON body for payment requirements
- The 402 body contains `accepts[]` with `maxAmountRequired` (price in token base units), `payTo`, `asset`, `network`, `scheme`
- USDC has 6 decimals, so `10000` = $0.01
- No tax, no shipping — digital services only
- Add 2% Bloon fee → return quote
- Reference: this is the same flow that purl (purl.dev) and `@x402/fetch` use under the hood

**Browser route — Tier 1: Firecrawl (primary, rich)**
- Uses Firecrawl `/v1/scrape` endpoint with up to 3 attempts (exponential backoff: 2s, 4s)
- Each attempt scored by parser ensemble; loop breaks early if confidence >= 0.75
- If confidence is low, Browserbase+Gemini repair path renders the page and extracts via Gemini 2.5 Flash
- Shopify `.json` fallback for options if LLM returns none
- If variant URLs found → runs `/v1/scrape` on each variant URL to resolve per-variant pricing
- If options exist but no variant URLs → runs `/v1/crawl` (maxDepth: 1) to discover variant pages
- Requires `FIRECRAWL_API_KEY` env var. If not set, skipped entirely.
- See `plans/16-firecrawl-discovery.md` for the full pipeline spec

**Browser route — Tier 2: HTML Scrape (fast, free)**
- Server-side HTTP fetch of the product URL
- Parse structured data: JSON-LD (`@type: Product`), Open Graph meta tags, `<meta property="product:price:amount">`
- Extract item price + product name + variant options from JSON-LD `hasVariant`/`offers`
- Falls through to Tier 3 if bot-blocked or no structured data found

**Browser route — Tier 3: Browserbase + Stagehand (slow, accurate, last resort)**
- Launch a Browserbase session with headless Chrome
- Navigate to product URL → LLM extracts product info and variant options
- For per-variant pricing: Stagehand agent selects each variant and reports the updated price
- Used for anti-bot sites (Amazon, Best Buy) and pages without structured data
- Most expensive tier (Browserbase session + LLM API calls per variant)

The `discovery_method` field in the response tells the agent (and us) which tier was used: `"x402"`, `"firecrawl"`, `"scrape"`, or `"browserbase"`.

At confirm time, the browser route runs a **fresh** Browserbase session to do the actual checkout. If the final cart total at checkout time differs from the quoted total by more than $1 or 5% (whichever is smaller), the checkout aborts with `PRICE_MISMATCH` before payment — no funds at risk.

**Gas costs:** ETH gas for on-chain USDC transfers is covered by Bloon's fee margin. The agent only needs USDC in their wallet, not ETH. Bloon's master wallet holds ETH for gas and uses the fee revenue to replenish it.

## Payment Flow

```
POST /api/confirm { order_id }
  │
  ├─ Load order + agent wallet from store
  ├─ Verify sufficient USDC balance
  ├─ Transfer USDC: agent wallet → Bloon master wallet (on-chain)
  ├─ Wait for confirmation (~2s on Base)
  │
  ├─ IF x402:
  │   └─ @x402/fetch pays service → return response + receipt
  │
  ├─ IF browserbase:
  │   ├─ Fresh Browserbase session (inject domain cache)
  │   ├─ Stagehand: act(navigate) → act(add to cart) → act(fill) → CDP fill cards → act(submit)
  │   ├─ Extract confirmation number
  │   ├─ Update domain cache
  │   └─ Return receipt with order number
  │
  └─ Save receipt, update order status → "completed"
```

## USDC Contracts

| Network | Address | Decimals |
|---------|---------|----------|
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 6 |
| Base Mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |

## Credential Placeholder System

LLM never sees real card data:

```
Card fields (Playwright CDP fill — bypasses LLM entirely):
  card_number      →    page.fill(selector, "4111111111111111")
  card_expiry      →    page.fill(selector, "12/25")
  card_cvv         →    page.fill(selector, "123")

Non-card fields (Stagehand variables — %var% not shared with LLM):
  stagehand.act("fill name with %name%", { variables: { name: "John Doe" } })
  stagehand.act("fill address with %street%", { variables: { street: "123 Main St" } })
```

## Test Websites

| Site | Complexity |
|------|-----------|
| Shopify DTC store | Low |
| Target.com | Low-Medium |
| Best Buy | Medium |
| Amazon.com | High (stretch goal) |
| Walmart.com | Medium |
