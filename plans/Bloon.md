# Bloon

**Any website. Any product. One USDC payment. The agent handles the rest.**

Bloon is a REST API (TypeScript/Hono) that lets AI agents purchase anything on the internet using USDC on Base. No API keys. No registration. The agent's `wallet_id` is its credential. Bloon auto-routes payments — x402-native merchants get paid directly (2% fee), everything else goes through Browserbase cloud browser checkout with Stagehand (2% fee). Same interface, same receipt format either way.

The internet has two emerging payment layers for agents: x402 (for services that natively accept stablecoin over HTTP) and ACP (Stripe/OpenAI's protocol for opted-in merchants). But 99.9% of e-commerce speaks neither. Bloon bridges that gap — turning every checkout page on the web into an endpoint an agent can pay.

## v1 Scope

- **REST API** (Hono) with 4 JSON endpoints + 1 HTML funding page
- **No auth** — `wallet_id` is the spending credential, `funding_token` controls deposits
- **URL-only purchases** — agent provides a direct product URL (search by description deferred to v1.5)
- **Two payment routes**: x402 (auto-detected, 2% fee) and browser checkout (2% fee)
- **Two-phase purchase**: `POST /api/buy` returns a quote, `POST /api/confirm` executes
- **viem wallets** on Base (Sepolia for testnet, mainnet for prod) — no Coinbase CDP dependency
- **Private funding page** per wallet with QR code + live balance polling
- **Credential placeholder system** — LLM never sees real card numbers
- **Fresh Browserbase sessions** per checkout, with domain-level page caching
- **$25 max** per transaction, US shipping only, buy-only wallets
- **JSON file storage** in `~/.bloon/` — no database
- **Closed source**, single operator

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/wallets` | Create wallet → `wallet_id` + `funding_url` |
| `GET` | `/api/wallets/:wallet_id` | Balance + transaction history |
| `POST` | `/api/buy` | Get purchase quote for any URL (does NOT spend) |
| `POST` | `/api/confirm` | Execute purchase → receipt |
| `GET` | `/fund/:token` | HTML funding page with QR code + live balance |

## Fee Model

- **x402-native merchants:** 2% fee (Bloon pays the service on behalf of the agent)
- **Non-x402 merchants (browser checkout):** 2% fee (covers Browserbase sessions, Stagehand LLM inference, and margin)
- **Gas costs** are covered by the fee — the agent only needs USDC, not ETH

The agent never sees the difference. One flow, one interface, one receipt format.

## How It Works

### 1. Create & Fund a Wallet

```
Agent: POST /api/wallets { "agent_name": "Shopping Agent" }
→ Returns: wallet_id + funding_url

Human opens funding_url → QR code → sends USDC on Base → balance updates
```

### 2. Get a Quote

```
Agent: POST /api/buy { "url": "https://amazon.com/dp/B08...", "wallet_id": "...", "shipping": {...} }

Server probes URL:
  - x402 detected? → 2% fee quote
  - Normal website? → browser price discovery → 2% fee quote

→ Returns: order_id, product name/price, fee breakdown, route
```

### 3. Confirm & Purchase

```
Agent: POST /api/confirm { "order_id": "bloon_ord_9x2k4m" }

Server: transfers USDC from agent wallet → Bloon master wallet
  - x402: pays service via @x402/fetch → returns response + receipt
  - Browser: Browserbase session → Stagehand checkout → returns order number + receipt
```

Every purchase produces a structured receipt: product, merchant, route, price, fee, total, confirmation, timestamp.

## Payment Flow

```
┌─────────────────────────────────────────┐
│          AI Agent / curl / script        │
└──────────────────┬──────────────────────┘
                   │ HTTP (no auth)
┌──────────────────▼──────────────────────┐
│         Hono API (packages/api)          │
└──────┬──────────────────────────────────┘
       │
┌──────▼──────────────────────────────────┐
│         Core Orchestration               │
│   buy() → route detection → quote        │
│   confirm() → USDC transfer → execute    │
└──────┬──────────┬──────────┬────────────┘
       │          │          │
┌──────▼──┐ ┌────▼────┐ ┌──▼────────────┐
│ wallet   │ │  x402   │ │  checkout      │
│ viem     │ │ @x402/  │ │ Stagehand    │
│ USDC     │ │ fetch   │ │ Browserbase    │
│ QR       │ │         │ │ placeholders   │
└──────────┘ └─────────┘ └───────────────┘
```

## Two Secrets Per Wallet

| Secret | Controls | If Leaked |
|--------|---------|-----------|
| `wallet_id` | Spending (buy, confirm) | Someone can spend the wallet's USDC |
| `funding_token` | Depositing (funding page) | Someone can send USDC to the wallet (harmless) |

These are independent — knowing one doesn't reveal the other.

## Tech Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| HTTP Server | Hono 4.x | REST API |
| Blockchain | viem 2.x | Wallets, USDC transfers, balances |
| x402 | @x402/fetch | Pay x402 services |
| Browser Automation | Stagehand | LLM-powered checkout (Sonnet 4) |
| Cloud Browser | Browserbase SDK | Remote sessions |
| QR Code | qrcode | PNG generation |
| LLM | @anthropic-ai/sdk | Sonnet 4 for Stagehand |

## Package Structure

```
packages/
├── core/        # Types, fees, routing, store, buy/confirm orchestration
├── wallet/      # viem wallet create, balance, QR, USDC transfer
├── x402/        # x402 detection + payment via @x402/fetch
├── checkout/    # Browserbase sessions, Stagehand, placeholders, domain cache
└── api/         # Hono server, routes, funding page HTML
```

## Security Model

| Threat | Mitigation |
|--------|-----------|
| LLM sees card numbers | Placeholder system — LLM sees `x_card_number`, real values injected into DOM |
| wallet_id leaked | Cryptographically random IDs. $25 cap. Testnet. API key auth in v1.5. |
| Failed purchases | tx_hash preserved. Manual refund for v1. |
| Prompt injection | Structured REST endpoints. Stagehand gets deterministic task templates. |
| Runaway spending | $25 cap. Two-phase (buy then confirm). |

## What's Deferred

- Product search by description (Exa.ai) → v1.5
- API key auth → v1.5
- Wallet key encryption → v1.5
- Confirm idempotency → v1.5
- MCP wrapper → v2
- Multi-network/multi-currency → v2
- Dashboard UI → v2
- Multi-tenant → v3

## Competitive Landscape

| Solution | What it does | Gap Bloon fills |
|----------|-------------|-----------------|
| x402 (Coinbase) | Native stablecoin payments over HTTP | Only works if the seller has integrated x402 |
| ACP (Stripe/OpenAI) | Agentic checkout for opted-in merchants | Only works for merchants in the ACP network |
| Sponge (YC) | Agent wallets + business gateway | Requires businesses to onboard; can't buy from arbitrary websites |
| **Bloon** | **Any URL. One USDC payment. Receipt back.** | **Bridges the 99.9% of the web that doesn't speak any agent protocol** |

---

Full specification in `/plans/01-13`. Agent-facing API reference in `/docs/skill.md`.
