# MVP Scope — Bloon v1

## One-Liner

REST API that lets AI agents purchase anything on the internet using USDC on Base. No API keys. No registration. Any agent, any framework.

## What's In

### Core API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/wallets` | Create a wallet, get `wallet_id` + `funding_url` |
| `GET` | `/api/wallets/:wallet_id` | Balance, transaction history, wallet details |
| `POST` | `/api/query` | Discover product info, options, and required fields (no wallet needed) |
| `POST` | `/api/buy` | Get a purchase quote for any URL |
| `POST` | `/api/confirm` | Execute purchase, transfer USDC, return receipt |
| `GET` | `/fund/:token` | HTML funding page with QR code + live balance (for humans) |

### Zero-Friction Access

- No API keys. No registration. No auth headers.
- `wallet_id` is the credential — if you have it, you can spend the wallet.
- Any agent that can make HTTP requests can use Bloon immediately.

### Payment Routes

- **x402 route** — Auto-detect via HEAD request. If 402 → pay with `@x402/fetch` from Bloon's master wallet. **2% fee.**
- **Browser route** — Everything else. Checkout via Stagehand + Browserbase with Playwright CDP credential fills. **2% fee.**

### Wallet Management

- viem-generated wallets (no CDP dependency)
- USDC on Base (Sepolia for testnet, mainnet for prod)
- Private funding page per wallet: unique URL with QR code + live balance polling
- On-chain USDC balance queries via viem
- Private keys stored server-side in `~/.bloon/wallets.json`

### Funding Page (`/fund/:token`)

- Unique, unguessable URL per wallet — only the wallet creator receives it
- Serves an HTML page (not JSON) with:
  - QR code encoding the wallet's Base address
  - Copyable address text
  - Live USDC balance (polls every 10 seconds)
- The `funding_url` is separate from the `wallet_id` — leaking the funding URL only lets someone send you money

### Product Discovery (`POST /api/query`)

- URL-only (v1) — agent provides a direct product URL
- 4-tier discovery pipeline: x402 detection → Firecrawl (primary, up to 3 attempts + Browserbase+Gemini repair) → Exa.ai (Stage 2.5, parallel) → Server-side scrape (JSON-LD/meta tags) → Browserbase+Stagehand (headless Chrome)
- Returns product name, price, image, variant options (color, size), and required fields (shipping, selections)
- `POST /api/query` is the recommended first step — discover what a product needs before buying
- Product search by description (Exa.ai) planned for v1.5

### Browser Checkout

- Browserbase cloud sessions (fresh per checkout)
- Stagehand (by Browserbase) with Claude Sonnet 4 for LLM-powered navigation
- Credential placeholder system — agent/LLM never sees real card numbers
- Domain-level page caching for repeat purchases (cookies, localStorage)
- Supports arbitrary websites

### Receipts

Every purchase produces a structured receipt:
- product name, URL, merchant
- route (x402 or browserbase)
- price, fee, fee rate, total paid
- order number / confirmation ID
- timestamp, tx hash

### Constraints

- $25 max per transaction
- US shipping only
- USDC on Base only
- Buy-only wallets (no sell-side)
- Single operator (your card in .env)
- Manual refunds for failed purchases
- Closed source

## What's Out (v1)

- API key auth / registration flow
- MCP wrapper (planned v2)
- x402 Bazaar / buy_sell wallet type
- Product search by description (Exa.ai — planned v1.5)
- Automated refund queue
- Wallet-to-wallet transfers
- Spending controls / daily budgets
- Multi-currency / multi-chain
- Virtual cards (Stripe Issuing)
- International shipping
- ACP (Stripe/OpenAI) route
- Human approval workflows
- Multi-agent shared wallets
- Credential encryption / vault
- Web dashboard
- Rate limiting / abuse prevention

## Success Criteria

An AI agent can:

1. `POST /api/wallets` → get a wallet_id + funding_url
2. Human opens funding_url → scans QR → sends test USDC on Base Sepolia
3. `POST /api/query` with a product URL → discover product info, options, and required fields
4. `POST /api/buy` with a product URL + shipping + selections → get a quote
5. `POST /api/confirm` → purchase executes via browser checkout, receipt returned
6. `POST /api/buy` with an x402 URL → purchase executes, service response returned
7. `GET /api/wallets/:id` → full balance and transaction history
8. All testable with curl. No SDK, no client library, no auth.
