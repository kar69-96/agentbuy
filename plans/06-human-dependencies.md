# Human Dependencies — Proxo v1

Things the human operator needs to set up or provide before/during the build.

---

## Before Building

| Dependency | Status | Notes |
|-----------|--------|-------|
| Node.js 20+ | Required | Runtime |
| pnpm 9+ | Required | `npm install -g pnpm` |
| Anthropic API key | Required | For Claude Sonnet 4 (Stagehand LLM) |
| Browserbase account | Required | API key + project ID for cloud browser sessions |
| Base Sepolia RPC URL | Required | Alchemy or Infura. Free tier works. |
| Credit card for testing | Required | Real or test card info in .env |
| Shipping address | Required | Default shipping in .env for testing |

## During Testing

| Dependency | Status | Notes |
|-----------|--------|-------|
| Test USDC on Base Sepolia | Required | Mint from faucet or test contract |
| Base Sepolia ETH (gas) | Required | From Alchemy faucet |
| Fund Proxo master wallet | Required | Send test USDC + ETH to the auto-generated master wallet address |
| Fund test agent wallet | Required | Open funding page, scan QR, send USDC from personal wallet |
| Mobile wallet app | Required | Coinbase Wallet or MetaMask with Base Sepolia added |

## Before Production (v1.5+)

| Dependency | Status | Notes |
|-----------|--------|-------|
| Real USDC on Base | Future | Mainnet funds for real purchases |
| HTTPS / reverse proxy | Future | nginx or Cloudflare tunnel for production |
| Domain name | Future | For hosted version |
| API key auth enabled | Future | Before any public-facing deployment |

---

## Resolved Decisions

| Decision | Resolution |
|----------|-----------|
| MCP vs API | API-first (REST via Hono). MCP wrapper in v2. |
| Auth model | No auth for v1. wallet_id is the credential. |
| Wallet generation | viem (no Coinbase CDP needed) |
| Product search | URL-only for v1. Exa.ai in v1.5. |
| Browser LLM | Claude Sonnet 4 |
| Session strategy | Fresh Browserbase sessions + domain page caching |
| Shipping handling | Custom per-purchase. SHIPPING_REQUIRED error if missing. |
| Source code | Closed source |
| Testnet | Base Sepolia |
