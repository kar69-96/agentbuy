# Roadmap — Proxo

## v1.0 — Core API (Current Build)

REST API on localhost. Any URL → USDC purchase → receipt.

- Hono API server with 4 endpoints + HTML funding page
- No auth — wallet_id is the credential
- Two payment routes: x402 (0.5% fee) and browser checkout (5% fee)
- viem wallets on Base Sepolia
- Private funding page per wallet with Coinbase Onramp + QR code + live balance
- Coinbase Onramp Guest Checkout — debit card / Apple Pay, 0% USDC fees on Base, no KYC managed by Proxo
- Placeholder credential system (LLM never sees card numbers)
- Fresh Browserbase sessions with domain-level page caching
- JSON file storage (~/.proxo/)
- $25 per-transaction cap
- Closed source
---

## v1.5 — Intelligence & Security

- **API key auth** — optional Bearer token for wallets (backwards-compatible)
- **Wallet key encryption** — encrypt private keys at rest in ~/.proxo/
- **Rate limiting** — per wallet_id, configurable
- **Webhook notifications** — POST to a callback URL on order status changes
- **Multi-item orders** — buy multiple products in one flow
- **Better error recovery** — automatic retry for transient failures
- **Receipt storage** — persistent receipt history with pagination

---

## v2.0 — Platform

- **Exa.ai product search** — agents can search by description, not just URL
- **MCP wrapper** — expose the REST API as an MCP server so agents in Claude Desktop / Cursor can use Proxo natively
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
| v1.0 | Core API | Any URL → USDC → receipt |
| v1.5 | Intelligence | Exa.ai search, API keys, encryption |
| v2.0 | Platform | MCP wrapper, multi-network, dashboard |
| v3.0 | Scale | Multi-tenant, SDKs, subscriptions |
