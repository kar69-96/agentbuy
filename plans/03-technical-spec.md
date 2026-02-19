# Technical Spec — Proxo v1

## API vs MCP — Why API-First

| | REST API (chosen) | MCP |
|---|---|---|
| **Reach** | Any agent, any language, any framework — just HTTP | Only MCP-compatible clients |
| **Discovery** | skill.md — agents find and use Proxo immediately | Must pre-install locally |
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
│ viem   │   │ @x402/   │   │ browser-use (Son 4)  │
│ QR     │   │ fetch    │   │ Browserbase          │
│ balance│   │          │   │ Placeholders + Cache │
└────────┘   └──────────┘   └──────────────────────┘
```

## Monorepo Structure

```
proxo/
├── packages/
│   ├── core/src/
│   │   ├── types.ts        # All TypeScript interfaces
│   │   ├── store.ts        # JSON file persistence (~/.proxo/)
│   │   ├── router.ts       # x402 detection + route selection
│   │   ├── receipts.ts     # Uniform receipt generation
│   │   ├── fees.ts         # 0.5% x402, 5% browser
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
│   │   ├── pay.ts          # @x402/fetch from Proxo wallet
│   │   └── index.ts
│   │
│   ├── checkout/src/
│   │   ├── session.ts      # Browserbase session + domain cache inject
│   │   ├── executor.ts     # browser-use agent (Claude Sonnet 4)
│   │   ├── placeholders.ts # Credential mapping (.env → x_* keys)
│   │   ├── discover.ts     # Navigate URL, extract product + price
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
| Browser Automation | browser-use | LLM-powered checkout (Sonnet 4) |
| Cloud Browser | Browserbase SDK | Remote sessions |
| QR Code | qrcode | PNG generation |
| LLM | @anthropic-ai/sdk | Sonnet 4 for browser-use |

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

### 4. Shipping: Custom Per-Purchase, Prompt if Missing

- Provided in request → use it
- Omitted but .env defaults exist → use defaults
- Omitted, no defaults, browser route → return `SHIPPING_REQUIRED`
- x402 route → shipping never required

### 5. browser-use with Claude Sonnet 4

From AgentPay. LLM-powered Playwright automation. Credential placeholder system — LLM never sees real card numbers. Handles arbitrary websites.

### 6. Fresh Browserbase Sessions + Domain Caching

Each checkout = fresh session. But we cache cookies/localStorage per domain:
- Skips cookie banners, preserves preferences on repeat visits
- NOT login persistence — no auth tokens cached
- Cache stored at `~/.proxo/cache/{domain}.json`

### 7. Hono

Lightweight (14KB), TypeScript-native, runs on Node/Cloudflare/Vercel/Deno. Easy to deploy anywhere.

### 8. Closed Source

Not open source. Deployed and operated by you.

## Payment Flow

```
POST /api/confirm { order_id }
  │
  ├─ Load order + agent wallet from store
  ├─ Verify sufficient USDC balance
  ├─ Transfer USDC: agent wallet → Proxo master wallet (on-chain)
  ├─ Wait for confirmation (~2s on Base)
  │
  ├─ IF x402:
  │   └─ @x402/fetch pays service → return response + receipt
  │
  ├─ IF browserbase:
  │   ├─ Fresh Browserbase session (inject domain cache)
  │   ├─ browser-use: navigate → cart → checkout → fill → submit
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
LLM sees:               browser-use injects into DOM:
x_card_number      →    4111111111111111
x_card_expiry      →    12/25
x_card_cvv         →    123
x_cardholder_name  →    John Doe
x_shipping_street  →    123 Main St
```

## Test Websites

| Site | Complexity |
|------|-----------|
| Shopify DTC store | Low |
| Target.com | Low-Medium |
| Best Buy | Medium |
| Amazon.com | High (stretch goal) |
| Walmart.com | Medium |
