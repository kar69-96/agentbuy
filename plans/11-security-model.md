# Security Model — Bloon v1

## Auth Model: wallet_id IS the Credential

No API keys. No registration. No auth headers.

- `POST /api/wallets` is open — anyone can create an empty wallet
- All other endpoints require a `wallet_id` in the request
- Wallet IDs are cryptographically random (UUID-length) — unguessable
- If you have the wallet_id, you can spend the wallet
- `funding_token` is a separate secret — only lets someone deposit, not spend

**Accepted risk:** If a wallet_id leaks, the funds are accessible. Mitigated by $25 cap, testnet for now, and the fact that wallet IDs are never exposed in URLs or logs.

## Threat Model

| Threat | Risk | Mitigation |
|--------|------|-----------|
| LLM sees card numbers | HIGH | Card fields filled via Playwright CDP (bypasses LLM entirely). Non-card fields use Stagehand `%var%` variables (not shared with LLM). |
| wallet_id leaked | MEDIUM | IDs are cryptographically random. $25 cap. Testnet. v2 adds API key auth. |
| funding_url leaked | LOW | Only lets someone send you money. Cannot spend. |
| Wallet private key leak | MEDIUM | Keys in `~/.bloon/` with 600 permissions. Single-user, local only. v1.5 adds encryption. |
| Prompt injection | MEDIUM | Agents call structured REST endpoints. Stagehand receives step-by-step act() calls, not raw agent input. Shipping info sanitized. |
| Double-spend / replay | LOW | Unique order IDs. On-chain verification. Order marked completed after fulfillment. |
| Failed purchase, funds lost | MEDIUM | tx_hash preserved on failure. Manual refund for v1. |
| Runaway spending | LOW | $25 cap. Two-phase (buy then confirm). |
| Browserbase session hijack | LOW | Sessions are ephemeral, destroyed after each checkout. |
| Wallet creation spam | LOW | Empty wallets cost nothing. No rate limiting needed for v1. |
| Someone discovers /fund/:token | LOW | Token is unguessable. Worst case: they fund your wallet. |
| Agent-supplied data in forms | MEDIUM | Shipping info sanitized before passing as Stagehand variables. Card fields filled via CDP, not Stagehand. |
| LLM extraction hallucination | LOW | Parser ensemble scores candidates. Confidence threshold (0.75). Multiple extraction sources cross-validated. |

## Credential Flow

```
.env (local disk)
  │
  ├─ CARD_*, BILLING_*, SHIPPING_*
  │     │
  │     ▼
  │   checkout/credentials.ts → { x_card_number: "4111...", ... }
  │     │
  │     ▼  Card fields: Playwright CDP fill (bypasses LLM)
  │     ▼  Non-card fields: Stagehand variables (not shared with LLM)
  │
  ├─ BLOON_MASTER_PRIVATE_KEY → signs x402 payments, server-side only
  │
  └─ Wallet private keys (~/.bloon/wallets.json) → signs USDC transfers, server-side only
```

## What the LLM Can See

| Data | Visible? |
|------|----------|
| Product name, URL, price | Yes |
| Shipping name and address | Yes |
| Order ID, receipt details | Yes |
| Credit card number | **No** |
| Card expiry, CVV | **No** |
| Wallet private keys | **No** |
| Bloon master wallet key | **No** |
| USDC tx hashes | Yes |
| wallet_id | Yes (agent needs it) |
| funding_token | Yes (agent shares with human) |

## Two Secrets Per Wallet

| Secret | Controls | If Leaked |
|--------|---------|-----------|
| `wallet_id` | Spending (buy, confirm) | Someone can spend the wallet's USDC |
| `funding_token` | Depositing (funding page) | Someone can send USDC to the wallet (harmless) |

These are independent — knowing one doesn't reveal the other.

## v1 Limitations (Accepted)

1. No auth beyond wallet_id — acceptable for single operator + testnet
2. Wallet keys in plaintext JSON — filesystem permissions only
3. No rate limiting — single operator, not public yet
4. Manual refunds — failed purchases require manual USDC return
5. No HTTPS — localhost for v1. Deploy behind reverse proxy for production.
