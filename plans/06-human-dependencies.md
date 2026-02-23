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
| Shipping address for testing | Recommended | Provide in each buy request — no .env default |

## During Testing

| Dependency | Status | Notes |
|-----------|--------|-------|
| Test USDC on Base Sepolia | Required | Mint from faucet or test contract |
| Base Sepolia ETH (gas) | Required | From Alchemy faucet |
| Fund Proxo master wallet | Required | Send test USDC + ETH to the auto-generated master wallet address |
| Fund test agent wallet | Required | Open funding page, scan QR, send USDC from personal wallet |
| Mobile wallet app | Required | Coinbase Wallet or MetaMask with Base Sepolia added |

## Coinbase Onramp (Phase 7)

| Dependency | Status | Notes |
|-----------|--------|-------|
| CDP account | Required | Sign up at portal.cdp.coinbase.com |
| CDP API key pair | Required | Add `CDP_API_KEY_NAME` + `CDP_API_KEY_SECRET` to .env |
| Onramp access approval | Required | Apply at support.cdp.coinbase.com/onramp-onboarding |
| 0% USDC fee approval | Recommended | Apply at coinbase.com/developer-platform/developer-interest |
| Domain allow list (if iframe) | Required | Register on CDP Portal for web embedding |

## Before Mainnet Testing (Phase 7)

| Dependency | Status | Notes |
|-----------|--------|-------|
| Real USDC on Base mainnet | Required | Fund master wallet via Coinbase or direct transfer |
| ETH on Base mainnet (gas) | Required | For USDC transfer gas fees |
| Base mainnet RPC URL | Required | Alchemy or Infura mainnet endpoint |
| Real payment card | Required | Real card info in `CARD_*` env vars |
| `NETWORK=base` in .env | Required | Switches chain, USDC contract, and x402 chain ID |

## Before Production (v1.5+)

| Dependency | Status | Notes |
|-----------|--------|-------|
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
