# API Reference — REST Endpoints

**Base URL:** `http://localhost:3000` (dev)
**Auth:** None. `wallet_id` is the credential.
**Content-Type:** `application/json`

---

## POST /api/wallets

Create a new wallet. Returns wallet_id (spending credential) and funding_url (for human to deposit USDC).

```bash
curl -X POST http://localhost:3000/api/wallets \
  -H "Content-Type: application/json" \
  -d '{ "agent_name": "Shopping Agent" }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent_name` | string | yes | Label for this wallet |

**201 Created:**
```json
{
  "wallet_id": "proxo_w_7k2m9x",
  "address": "0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e",
  "network": "base-sepolia",
  "agent_name": "Shopping Agent",
  "balance_usdc": "0.00",
  "funding_url": "http://localhost:3000/fund/a8f3x9k2m7p4n1q",
  "created_at": "2026-02-19T14:30:00Z"
}
```

The `funding_url` is the ONLY place the QR code is accessible. Share it with the human to fund the wallet.

---

## GET /api/wallets/:wallet_id

Wallet details, live USDC balance (from chain), and transaction history.

```bash
curl http://localhost:3000/api/wallets/proxo_w_7k2m9x
```

**200 OK:**
```json
{
  "wallet_id": "proxo_w_7k2m9x",
  "address": "0x4d5e6f...",
  "network": "base-sepolia",
  "agent_name": "Shopping Agent",
  "balance_usdc": "41.11",
  "created_at": "2026-02-19T14:30:00Z",
  "transactions": [
    {
      "type": "deposit",
      "amount_usdc": "60.00",
      "from": "0xabc...",
      "tx_hash": "0xdef...",
      "timestamp": "2026-02-19T10:00:00Z"
    },
    {
      "type": "purchase",
      "order_id": "proxo_ord_9x2k4m",
      "product": "Anker 5-in-1 USB-C Hub",
      "merchant": "amazon.com",
      "route": "browserbase",
      "price": "17.99",
      "fee": "0.90",
      "total": "18.89",
      "status": "completed",
      "timestamp": "2026-02-19T14:32:00Z"
    }
  ]
}
```

**404:** `WALLET_NOT_FOUND`

---

## GET /fund/:token

**HTML page** (not JSON). Serves the wallet funding page with QR code and live balance. Meant for humans in a browser, not for agents.

```
http://localhost:3000/fund/a8f3x9k2m7p4n1q
```

The page displays:
- QR code encoding the wallet's Base address
- Copyable address text
- Live USDC balance (polls every 10 seconds)
- Network indicator (Base Sepolia / Base)

This URL is returned only from `POST /api/wallets`. It cannot be derived from the wallet_id.

---

## POST /api/buy

Get a purchase quote for a URL. Auto-detects route (x402 or browser). Does NOT spend anything.

```bash
curl -X POST http://localhost:3000/api/buy \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://amazon.com/dp/B08EXAMPLE",
    "wallet_id": "proxo_w_7k2m9x",
    "shipping": {
      "name": "Jane Doe",
      "street": "123 Main St",
      "city": "Austin",
      "state": "TX",
      "zip": "78701",
      "country": "US",
      "email": "jane@example.com",
      "phone": "512-555-0100"
    }
  }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | yes | Product URL or x402 endpoint |
| `wallet_id` | string | yes | Wallet to charge |
| `shipping` | object | no | Shipping address. Falls back to .env defaults. Returns SHIPPING_REQUIRED if needed and missing. |

**200 OK (browser route — scrape discovery):**
```json
{
  "order_id": "proxo_ord_9x2k4m",
  "product": {
    "name": "Anker 5-in-1 USB-C Hub",
    "url": "https://amazon.com/dp/B08EXAMPLE",
    "source": "amazon.com"
  },
  "payment": {
    "item_price": "17.99",
    "tax": "1.49",
    "shipping_cost": "0.00",
    "subtotal": "19.48",
    "fee": "0.97",
    "fee_rate": "5%",
    "total": "20.45",
    "route": "browserbase",
    "discovery_method": "scrape",
    "wallet_id": "proxo_w_7k2m9x",
    "wallet_balance": "41.11"
  },
  "status": "awaiting_confirmation",
  "expires_in": 300
}
```

**200 OK (browser route — full cart discovery):**

Returned when scrape can't determine shipping cost. Browserbase session adds item to cart, fills shipping info, and extracts the full breakdown from the order review page.

```json
{
  "order_id": "proxo_ord_8k4n2p",
  "product": {
    "name": "Sony WH-1000XM5 Headphones",
    "url": "https://target.com/p/sony-headphones/...",
    "source": "target.com"
  },
  "payment": {
    "item_price": "22.99",
    "tax": "1.90",
    "shipping_cost": "0.00",
    "subtotal": "24.89",
    "fee": "1.24",
    "fee_rate": "5%",
    "total": "26.13",
    "route": "browserbase",
    "discovery_method": "browserbase_cart",
    "wallet_id": "proxo_w_7k2m9x",
    "wallet_balance": "41.11"
  },
  "status": "awaiting_confirmation",
  "expires_in": 300
}
```

**200 OK (x402 route):**
```json
{
  "order_id": "proxo_ord_3n7p1q",
  "product": {
    "name": "Weather Forecast API",
    "url": "https://api.weather402.com/forecast",
    "source": "api.weather402.com"
  },
  "payment": {
    "item_price": "0.10",
    "tax": "0.00",
    "shipping_cost": "0.00",
    "subtotal": "0.10",
    "fee": "0.0005",
    "fee_rate": "0.5%",
    "total": "0.1005",
    "route": "x402",
    "discovery_method": "x402"
  },
  "status": "awaiting_confirmation",
  "expires_in": 300
}
```

**400:** `SHIPPING_REQUIRED`, `INSUFFICIENT_BALANCE`, `PRICE_EXCEEDS_LIMIT`, `URL_UNREACHABLE`
**404:** `WALLET_NOT_FOUND`
**502:** `PRICE_EXTRACTION_FAILED`

### Price Discovery Flow

The quote always returns the **full price** the agent will pay (item + tax + shipping + fee):

1. **x402 route** — Price resolved from the 402 response body. No tax or shipping.
2. **Browser route, Tier 1 (scrape)** — HTTP fetch + structured data parsing. Fast (~1-2s). If shipping cost can't be determined, falls through to Tier 2.
3. **Browser route, Tier 2 (full cart)** — Browserbase session adds to cart, fills shipping, extracts exact total from order review page. Slow (~15-30s) but accurate.

The `discovery_method` field indicates which tier was used: `"purl"`, `"scrape"`, or `"browserbase_cart"`.

---

## POST /api/confirm

Execute a purchase. Transfers USDC, fulfills order, returns receipt.

```bash
curl -X POST http://localhost:3000/api/confirm \
  -H "Content-Type: application/json" \
  -d '{ "order_id": "proxo_ord_9x2k4m" }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_id` | string | yes | Order ID from /api/buy |

**200 OK (browser, completed):**
```json
{
  "order_id": "proxo_ord_9x2k4m",
  "status": "completed",
  "receipt": {
    "product": "Anker 5-in-1 USB-C Hub",
    "merchant": "amazon.com",
    "route": "browserbase",
    "price": "17.99",
    "fee": "0.90",
    "total_paid": "18.89",
    "order_number": "112-4567890-1234567",
    "estimated_delivery": "Feb 21, 2026",
    "confirmation_email": "sent to jane@example.com",
    "tx_hash": "0xabc123...",
    "browserbase_session_id": "sess_xyz",
    "timestamp": "2026-02-19T14:35:00Z"
  }
}
```

**200 OK (x402, completed):**
```json
{
  "order_id": "proxo_ord_3n7p1q",
  "status": "completed",
  "receipt": {
    "product": "Weather Forecast API",
    "merchant": "api.weather402.com",
    "route": "x402",
    "price": "0.10",
    "fee": "0.0005",
    "total_paid": "0.1005",
    "tx_hash": "0xdef456...",
    "timestamp": "2026-02-19T14:33:00Z"
  },
  "response": {
    "weather": "sunny",
    "temperature": 72,
    "location": "Austin, TX"
  }
}
```

**500 (failed, funds at risk):**
```json
{
  "order_id": "proxo_ord_9x2k4m",
  "status": "failed",
  "error": {
    "code": "CHECKOUT_FAILED",
    "message": "Could not complete checkout: item out of stock",
    "tx_hash": "0xabc123...",
    "refund_status": "pending_manual"
  }
}
```

**404:** `ORDER_NOT_FOUND` | **410:** `ORDER_EXPIRED`

---

## Error Format

All errors:
```json
{ "error": { "code": "ERROR_CODE", "message": "...", "details": {} } }
```

| Code | HTTP | Meaning |
|------|------|---------|
| `INSUFFICIENT_BALANCE` | 400 | Not enough USDC |
| `SHIPPING_REQUIRED` | 400 | Physical product, no address |
| `PRICE_EXCEEDS_LIMIT` | 400 | Price > $25 |
| `URL_UNREACHABLE` | 400 | Can't reach URL |
| `WALLET_NOT_FOUND` | 404 | Bad wallet_id |
| `ORDER_NOT_FOUND` | 404 | Bad order_id |
| `ORDER_EXPIRED` | 410 | Quote > 5 min old |
| `TRANSFER_FAILED` | 500 | USDC transfer failed (retry safe) |
| `X402_PAYMENT_FAILED` | 502 | x402 service rejected |
| `CHECKOUT_FAILED` | 502 | Browser checkout failed |
| `PRICE_MISMATCH` | 409 | Cart total at checkout differs from quote |
