# Roadmap — Bloon

## v1.0 — Core API (Current Build)

REST API on localhost. Any URL → USDC purchase → receipt.

- Hono API server with 5 JSON endpoints + HTML funding page
- `POST /api/query` — product discovery with 4-tier pipeline (Firecrawl → Exa.ai → scrape → Browserbase)
- `POST /api/buy` + `POST /api/confirm` — two-phase purchase with variant selections
- No auth — wallet_id is the credential
- Two payment routes: x402 and browser checkout (2% flat fee)
- viem wallets on Base Sepolia
- Private funding page per wallet with QR code + live balance
- 4-tier product discovery: Firecrawl (primary, 3 retries + Browserbase+Gemini repair) → Exa.ai (Stage 2.5, parallel) → Server-side scrape (JSON-LD/meta tags) → Browserbase+Stagehand
- Variant option discovery with per-variant pricing
- Placeholder credential system (LLM never sees card numbers)
- 12-step browser checkout with Stagehand agent + custom tools (fillShippingInfo, fillCardFields, fillBillingAddress)
- Fresh Browserbase sessions with domain-level page caching
- `orchestrator` package separates business logic from transport layer
- JSON file storage (~/.bloon/) with atomic writes
- $25 per-transaction cap
- Closed source

---

## v1.5 — Security & Onramp

- **Coinbase Onramp** — Guest Checkout on funding page (debit card / Apple Pay, 0% USDC fees on Base)
- **API key auth** — optional Bearer token for wallets (backwards-compatible)
- **Wallet key encryption** — encrypt private keys at rest in ~/.bloon/
- **Rate limiting** — per wallet_id, configurable
- **Exa.ai product search** — `POST /api/search` lets agents search by description instead of URL (Exa is already used for discovery; this adds search-first workflows)
- **Webhook notifications** — POST to a callback URL on order status changes
- **Multi-item orders** — buy multiple products in one flow
- **Better error recovery** — automatic retry for transient failures
- **Receipt storage** — persistent receipt history with pagination

---

## v2.0 — Platform

- **MCP wrapper** — expose the REST API as an MCP server so agents in Claude Desktop / Cursor can use Bloon natively
- **Multi-network** — support Ethereum mainnet, Arbitrum, Optimism, Polygon
- **Multi-currency** — accept ETH, DAI, USDT in addition to USDC
- **Spending dashboard & frontend** — React UI with wallet overview, transaction history, spending analytics (by merchant, fee type, time), budget controls, live checkout activity feed, and receipt viewer. Read-only in v2, write ops in v2.5
- **PostgreSQL** — replace JSON files with a real database
- **Deploy to cloud** — hosted version with HTTPS, custom domains
- **Marketplace listing** — publish to x402 Bazaar or equivalent

---

## v3.0 — Scale

- **Multi-tenant** — multiple operators, each with their own wallets and billing
- **Agent SDK** — TypeScript/Python SDKs for direct integration
- **Subscription purchases** — recurring payments and auto-renewal
- **Price comparison** — compare prices across merchants before buying
- **Bulk purchasing** — batch orders with volume discounts
- **Audit log** — full transaction audit trail with compliance features

---

## Version Summary

| Version | Focus | Key Addition |
|---------|-------|-------------|
| v1.0 | Core API | Any URL → query → buy → confirm → receipt |
| v1.5 | Security & Onramp | Coinbase Onramp, API keys, encryption, Exa search |
| v2.0 | Platform | MCP wrapper, multi-network, dashboard |
| v3.0 | Scale | Multi-tenant, SDKs, subscriptions |
