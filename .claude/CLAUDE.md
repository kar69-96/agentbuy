# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Proxo?

Proxo is a REST API (TypeScript/Hono) that lets AI agents purchase anything on the internet using USDC stablecoin. No API keys. No registration. The agent's `wallet_id` is its credential. Proxo auto-routes payments — x402-native merchants get paid directly (0.5% fee), everything else goes through Browserbase cloud browser checkout with Stagehand (5% fee). Same interface, same receipt format either way.

## Project Status

Pre-implementation. Full specification lives in `plans/`. No source code exists yet. Closed source.

## Architecture

### REST API (Hono) — NOT MCP

Proxo is API-first. MCP wrapper is planned for v2. The API has 4 JSON endpoints + 1 HTML page:

- `POST /api/wallets` — create wallet, get `wallet_id` + `funding_url`
- `GET /api/wallets/:wallet_id` — balance + transaction history
- `POST /api/buy` — get purchase quote for any URL (does NOT spend)
- `POST /api/confirm` — execute purchase, get receipt
- `GET /fund/:token` — HTML page with QR code + live balance (for humans)

### Auth Model

No auth. `wallet_id` is the spending credential. `funding_token` is a separate secret that only allows deposits. If you have the `wallet_id`, you can spend the wallet.

### Two-Phase Purchase

1. `POST /api/buy` → returns a quote (price, fee, total, route). Nothing is spent.
2. `POST /api/confirm` → transfers USDC, executes purchase, returns receipt.

### Payment Routes

- **x402**: Native crypto payment. Detected via HTTP 402 + payment headers. 0.5% fee. No shipping needed.
- **Browser checkout**: Browserbase + Stagehand (Claude Sonnet 4). 5% fee. Fresh session per checkout. Domain-level page caching for repeat flows.

### Credential Placeholder System

LLM never sees real card numbers. Card fields are filled via Playwright CDP directly into the DOM — never through Stagehand's LLM. Non-card fields use Stagehand's `variables` parameter (`%var%` syntax) which substitutes at the execution layer. Real values come from `.env` and never enter the LLM context.

### Two Secrets Per Wallet

| Secret | Controls | If Leaked |
|--------|---------|-----------|
| `wallet_id` | Spending (buy, confirm) | Someone can spend the wallet's USDC |
| `funding_token` | Depositing (funding page) | Someone can send USDC to the wallet (harmless) |

These are independent — knowing one doesn't reveal the other.

## Tech Stack

- **API Server:** Hono 4.x
- **Wallets:** viem 2.x (NOT Coinbase CDP)
- **x402 Payments:** @x402/fetch
- **Browser Automation:** @browserbasehq/stagehand + Browserbase
- **Browser LLM:** Claude Sonnet 4 (via Stagehand)
- **QR Codes:** qrcode (npm)
- **Chain:** USDC on Base (Sepolia for testnet, mainnet for prod)
- **Storage:** JSON files in `~/.proxo/` (chmod 600)

## Package Structure

```
packages/
├── core/        # Types, fees, routing logic, store (JSON persistence)
├── wallet/      # viem wallet create, balance, QR, USDC transfer
├── x402/        # x402 detection + payment via @x402/fetch
├── checkout/    # Browserbase sessions, Stagehand, credential fills, domain cache
└── api/         # Hono server, routes, funding page HTML
```

## Key Design Decisions

- **API-first, not MCP** — curl-testable, language-agnostic, simpler debugging. MCP wrapper in v2.
- **No auth** — wallet_id is the credential. Acceptable for single operator + testnet. API key auth in v1.5.
- **viem wallets** — no Coinbase CDP dependency. Direct key generation + USDC transfers.
- **Private funding page** — `/fund/:token` with QR code + live balance polling. One link onboarding.
- **URL-only purchases** — no product search in v1. Exa.ai deferred to v1.5.
- **Fresh Browserbase sessions** — destroyed after each checkout. Domain-level page caching (cookies/localStorage) for repeat flows.
- **Shipping per-purchase** — custom shipping in buy request. No defaults. Returns `SHIPPING_REQUIRED` if missing for physical items.
- **$25 max per transaction** (v1)
- **Base Sepolia** for testnet, Base mainnet for production

## Constraints (v1)

- $25 cap per transaction
- USDC on Base only
- URL-only (no product search)
- No API key auth (wallet_id only)
- No rate limiting
- JSON file storage (no database)
- Manual refunds for failed purchases
- Localhost only (deploy behind reverse proxy for production)

## Security — IMPORTANT

- Never log or expose private keys, seed phrases, or wallet secrets
- LLM must NEVER see real card numbers — use the placeholder system (`x_card_number`, etc.)
- Agent data (shipping info) MUST be sanitized before passing as Stagehand variables
- Card fields are filled via Playwright CDP, never through Stagehand's LLM
- All on-chain verification uses viem — check amount, recipient, token, and chain
- Wallet keys stored in `~/.proxo/wallets.json` with 600 permissions
- `wallet_id` and `funding_token` are independent secrets — never derive one from the other

## Workflows

### Adding an API Endpoint

1. Define request/response types in `packages/core/src/types.ts`
2. Implement business logic in the relevant package (x402, checkout, or wallet)
3. Create route handler in `packages/api/src/routes/`
4. Wire the route in `packages/api/src/server.ts`
5. Test with curl

### Testing a Browser Checkout Flow

1. Use Browserbase session replay to verify each step
2. Test with a known product URL and fixed shipping info
3. Confirm receipt fields match the unified format
4. Verify LLM conversation log has zero real credential values
5. Check that no agent-provided data leaks into unintended form fields

## Final Steps

YOU MUST run these in order after finishing any task:

0. If any API endpoints were added, changed, or removed, update `/docs/skill.md` to reflect the current endpoints.

1. `pnpm type-check` — fix any TypeScript errors before proceeding
2. `pnpm lint` — fix any linting errors related to your changes
3. `pnpm format` — ensure consistent formatting
4. `pnpm test` — ensure no regressions
5. Update `plans/Progress.md` — record what was built, test results, and any checklist changes
6. **Update the "Test Updates" section** in `plans/Progress.md` — this section at the top of the file should be overwritten with the latest test results (pass/fail counts, failing test details, recent fixes). It is the single source of truth for current test status.

## Gotchas

- viem's `waitForTransactionReceipt` can hang if the RPC is slow — always set a timeout
- Browserbase sessions are cloud-hosted — never assume local filesystem access in `packages/checkout`
- `@x402/fetch` auto-intercepts 402 responses — don't manually handle 402 in code that uses it
- Fresh Browserbase sessions mean no login state — checkout must work as guest
- Domain cache stores cookies/localStorage only — never cache auth tokens

## Testing

- Always test on real websites (Shopify → Target → Best Buy → Amazon)
- All on Base Sepolia with test USDC
- Each build phase has a test gate — don't proceed until all pass
- Use curl for all API testing
- See `plans/07-testing-guidelines.md` and `plans/14-phased-build-plan.md` for details

## Plans Reference

All specification docs are in `plans/`:

| Doc | Contents |
|-----|----------|
| `01-mvp-scope.md` | What's in/out for v1 |
| `02-user-flow.md` | Step-by-step user flows |
| `03-technical-spec.md` | Architecture, stack, package structure |
| `04-roadmap.md` | v1 → v1.5 → v2 → v3 |
| `05-future-additions.md` | Deferred features by version |
| `06-human-dependencies.md` | What the operator needs to set up |
| `07-testing-guidelines.md` | Test categories, websites, security checks |
| `08-api-reference.md` | Full REST API with curl examples |
| `09-data-models.md` | TypeScript interfaces |
| `10-environment-setup.md` | .env, prerequisites, running the server |
| `11-security-model.md` | Threat model, credential flow |
| `12-computer-use.md` | Browserbase + Stagehand deep dive (Phase 4) |
| `13-error-handling.md` | Error codes, HTTP statuses, recovery |
| `14-phased-build-plan.md` | 7 phases with test gates |
| `15-coinbase-onramp.md` | Coinbase Onramp Guest Checkout integration spec |
| `skill.md` | Agent-facing API quick reference (lives in `/docs/skill.md`) |

## Preferences
- Internal docs should be in /plans and user-facing docs should be in /docs
