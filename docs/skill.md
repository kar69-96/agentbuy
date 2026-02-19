---
name: proxo
version: 1.0.0
description: Purchase anything on the internet using USDC. Any URL. No API keys. No registration.
metadata: {"category":"commerce","interface":"rest","auth":"none"}
---

# PROXO API QUICK REFERENCE v1.0.0

**Base:** `http://localhost:3000`
**Auth:** None. wallet_id is the credential.
**Docs:** This file is canonical.

## Endpoints:

- `POST /api/wallets` — create wallet, get wallet_id + funding_url
- `GET /api/wallets/:wallet_id` — balance + transaction history
- `POST /api/buy` — get purchase quote for any URL
- `POST /api/confirm` — execute purchase, get receipt

## Rules:

- Always call buy before confirm (buy = quote, confirm = execute)
- wallet_id is your spending credential — keep it secret
- Physical products need a shipping address — pass it in buy or server will ask
- $25 max per transaction, USDC on Base only
- x402 URLs: 0.5% fee. Everything else: 5% fee (browser checkout)

---

# Proxo API — Agent Skills Guide

No API keys. No registration. No auth headers. Just HTTP requests.

## Quick Start

### 1. Create a wallet
```bash
curl -X POST http://localhost:3000/api/wallets \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"My Agent"}'
```

Response: `wallet_id` (keep secret) + `funding_url` (share with human to fund)

### 2. Fund the wallet

Give the `funding_url` to the human. They open it in a browser, see a QR code, and send USDC on Base.

### 3. Check balance
```bash
curl http://localhost:3000/api/wallets/proxo_w_7k2m9x
```

### 4. Buy something
```bash
curl -X POST http://localhost:3000/api/buy \
  -H "Content-Type: application/json" \
  -d '{
    "url":"https://amazon.com/dp/B08EXAMPLE",
    "wallet_id":"proxo_w_7k2m9x",
    "shipping":{
      "name":"Jane Doe",
      "street":"123 Main St",
      "city":"Austin","state":"TX","zip":"78701","country":"US",
      "email":"jane@example.com","phone":"512-555-0100"
    }
  }'
```

Returns a quote with price, fee, total. Does NOT spend anything yet.

### 5. Confirm the purchase
```bash
curl -X POST http://localhost:3000/api/confirm \
  -H "Content-Type: application/json" \
  -d '{"order_id":"proxo_ord_9x2k4m"}'
```

Transfers USDC, executes checkout, returns receipt.

## Endpoint Details

### POST /api/wallets

| Body Field | Type | Required | Description |
|------------|------|----------|-------------|
| `agent_name` | string | yes | Label for the wallet |

Returns: `wallet_id`, `address`, `funding_url`, `balance_usdc`

### GET /api/wallets/:wallet_id

Returns: `wallet_id`, `address`, `balance_usdc`, `transactions[]`

### POST /api/buy

| Body Field | Type | Required | Description |
|------------|------|----------|-------------|
| `url` | string | yes | Product URL or x402 endpoint |
| `wallet_id` | string | yes | Wallet to charge |
| `shipping` | object | no | Shipping address (required for physical products) |

Returns: `order_id`, `product`, `payment` (amount, fee, route), `status`

Shipping rules:
- Provided -> use it
- Omitted + .env defaults -> use defaults
- Omitted + no defaults + physical product -> returns SHIPPING_REQUIRED
- x402 route -> shipping never needed

### POST /api/confirm

| Body Field | Type | Required | Description |
|------------|------|----------|-------------|
| `order_id` | string | yes | Order ID from /api/buy |

Returns: `order_id`, `status`, `receipt`, `response` (x402 only)

Receipt always includes: product, merchant, route, price, fee, total_paid, tx_hash, timestamp.
Browser route adds: order_number, estimated_delivery.
x402 route adds: response (the service's actual response data).

### GET /fund/:token

HTML page (not JSON). Shows QR code + live USDC balance. For humans, not agents.

## Recommended Agent Workflow

```
1. POST /api/wallets → save wallet_id, give funding_url to human
2. Wait for human to fund → poll GET /api/wallets/:id until balance > 0
3. POST /api/buy { url, wallet_id, shipping? }
   → If SHIPPING_REQUIRED: ask human for address, retry
   → If INSUFFICIENT_BALANCE: ask human to fund more
   → If PRICE_EXCEEDS_LIMIT: product > $25, tell human
4. Present quote to human, get approval
5. POST /api/confirm { order_id }
6. Return receipt to human
```

## Error Codes

| Code | HTTP | What to Do |
|------|------|-----------|
| `INSUFFICIENT_BALANCE` | 400 | Tell human to fund wallet |
| `SHIPPING_REQUIRED` | 400 | Ask human for address, retry buy |
| `PRICE_EXCEEDS_LIMIT` | 400 | Product > $25, tell human |
| `WALLET_NOT_FOUND` | 404 | Bad wallet_id |
| `ORDER_NOT_FOUND` | 404 | Bad order_id |
| `ORDER_EXPIRED` | 410 | Quote > 5 min, call buy again |
| `URL_UNREACHABLE` | 400 | Check URL |
| `TRANSFER_FAILED` | 500 | Retry safe, no funds moved |
| `X402_PAYMENT_FAILED` | 502 | Check Proxo wallet funds |
| `CHECKOUT_FAILED` | 502 | Site issue, see error message |

## What the Agent Never Sees

- Credit card numbers (placeholder system)
- Wallet private keys (server-side only)
- Proxo master wallet key (server-side only)

## What the Agent Always Sees

- Product name, URL, price
- Fee amount and rate
- Payment route (x402 or browserbase)
- Receipt with confirmation details
- Full transaction history

## Network

| Env | Network | USDC Contract |
|-----|---------|--------------|
| Test | base-sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Prod | base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

---

Any URL. One USDC payment. Receipt back.
