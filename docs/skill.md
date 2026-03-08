---
name: bloon
version: 1.0.0
description: Purchase anything on the internet using USDC. Any URL. No API keys. No registration.
metadata: {"category":"commerce","interface":"rest","auth":"none"}
---

# BLOON API QUICK REFERENCE v1.0.0

**Base:** `http://localhost:3000`
**Auth:** None. wallet_id is the credential.
**Docs:** This file is canonical.

## Endpoints:

- `POST /api/wallets` — create wallet, get wallet_id + funding_url
- `GET /api/wallets/:wallet_id` — balance + transaction history
- `POST /api/query` — discover product options and required fields (no wallet needed)
- `POST /api/buy` — get purchase quote for any URL
- `POST /api/confirm` — execute purchase, get receipt

## Rules:

- Recommended flow: query → buy → confirm (query discovers requirements, buy quotes, confirm executes)
- wallet_id is your spending credential — keep it secret
- Physical products need a shipping address — pass it in buy or server will ask
- Use query to discover product options (size, color) and required fields before buying
- $25 max per transaction, USDC on Base only
- 2% flat fee on all purchases (x402 and browser checkout)

---

# Bloon API — Agent Skills Guide

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
curl http://localhost:3000/api/wallets/bloon_w_7k2m9x
```

### 4. Buy something
```bash
curl -X POST http://localhost:3000/api/buy \
  -H "Content-Type: application/json" \
  -d '{
    "url":"https://amazon.com/dp/B08EXAMPLE",
    "wallet_id":"bloon_w_7k2m9x",
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
  -d '{"order_id":"bloon_ord_9x2k4m"}'
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

### POST /api/query

| Body Field | Type | Required | Description |
|------------|------|----------|-------------|
| `url` | string | yes | Product URL or x402 endpoint |

Returns: `product` (name, url, price, image_url, brand, currency), `options[]` (name, values, prices), `required_fields[]` (field, label), `route`, `discovery_method`

Call this first to discover what a product needs before buying. No wallet required.
- `options` lists product variants (Color, Size) with available values and per-variant prices if they differ
- `required_fields` tells you what shipping fields and selections are needed
- If `selections` appears in required_fields, include matching key-value pairs in your buy request
- `discovery_method` is one of: `"x402"`, `"firecrawl"`, `"browserbase"`, `"scrape"`
- Discovery pipeline: Firecrawl (primary, up to 3 attempts with Browserbase+Gemini repair) → Server-side scrape (JSON-LD/meta tags) → Browserbase+Stagehand (headless Chrome agent)
- If `error: "product_not_found"` is returned, the product page is 404 or discontinued

### POST /api/buy

| Body Field | Type | Required | Description |
|------------|------|----------|-------------|
| `url` | string | yes | Product URL or x402 endpoint |
| `wallet_id` | string | yes | Wallet to charge |
| `shipping` | object | no | Shipping address (required for physical products) |
| `selections` | object | no | Product options e.g. `{"Color":"Red","Size":"10"}` |

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
3. POST /api/query { url }
   → Discover product options, required fields, and route
4. POST /api/buy { url, wallet_id, shipping, selections? }
   → Include all required_fields from query response
   → If INSUFFICIENT_BALANCE: ask human to fund more
   → If PRICE_EXCEEDS_LIMIT: product > $25, tell human
5. Present quote to human, get approval
6. POST /api/confirm { order_id }
7. Return receipt to human
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
| `X402_PAYMENT_FAILED` | 502 | Check Bloon wallet funds |
| `CHECKOUT_FAILED` | 502 | Site issue, see error message |
| `PRICE_EXTRACTION_FAILED` | 502 | Could not extract price from page |
| `INVALID_SELECTION` | 400 | Bad selections format, check values |
| `INVALID_URL` | 400 | Not a valid HTTP(S) URL |
| `MISSING_FIELD` | 400 | Required field missing from request |
| `ORDER_INVALID_STATUS` | 400 | Order can't be confirmed (wrong status) |
| `GAS_TRANSFER_FAILED` | 500 | ETH gas transfer failed |
| `QUERY_FAILED` | 502 | Product discovery failed, try different URL |
| `PRODUCT_NOT_FOUND` | 404 | Product page is 404 or discontinued |

## What the Agent Never Sees

- Credit card numbers (placeholder system)
- Wallet private keys (server-side only)
- Bloon master wallet key (server-side only)

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
