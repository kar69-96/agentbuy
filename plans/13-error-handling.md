# Error Handling — Bloon v1

## Error Response Format

All API errors return JSON with a consistent structure:

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Wallet has 2.00 USDC, needs 18.35 USDC"
  }
}
```

HTTP status codes follow REST conventions.

---

## Error Matrix

| Code | HTTP | When | Agent Should |
|------|------|------|-------------|
| `INSUFFICIENT_BALANCE` | 400 | Wallet balance < total (price + fee) | Tell human to fund wallet |
| `SHIPPING_REQUIRED` | 400 | Physical product, no shipping provided | Ask human for address, retry buy |
| `PRICE_EXCEEDS_LIMIT` | 400 | Product price > $25 | Tell human, suggest cheaper alternative |
| `WALLET_NOT_FOUND` | 404 | Invalid wallet_id | Check wallet_id, create new wallet |
| `ORDER_NOT_FOUND` | 404 | Invalid order_id | Check order_id, call buy again |
| `ORDER_EXPIRED` | 410 | Quote older than 5 minutes | Call buy again for fresh quote |
| `ORDER_INVALID_STATUS` | 400 | Order not in "awaiting_confirmation" status | Check order status, may need new buy |
| `URL_UNREACHABLE` | 400 | Cannot fetch the product URL | Check URL, retry |
| `PRICE_EXTRACTION_FAILED` | 502 | Browser couldn't extract price from page | Try different URL for same product |
| `TRANSFER_FAILED` | 500 | USDC transfer failed on-chain | Safe to retry, no funds moved |
| `GAS_TRANSFER_FAILED` | 500 | ETH gas transfer to new wallet failed | Check master wallet ETH balance |
| `X402_PAYMENT_FAILED` | 502 | x402 service rejected payment | Check Bloon master wallet funds |
| `CHECKOUT_FAILED` | 502 | Browser checkout failed after payment | Contact human — USDC was sent, tx_hash preserved |
| `QUERY_FAILED` | 502 | Product discovery pipeline failed | Try different URL |
| `MISSING_FIELD` | 400 | Required field not in request body | Check API docs, add missing field |
| `INVALID_URL` | 400 | URL is not a valid HTTP(S) URL | Fix URL format |
| `INVALID_SELECTION` | 400 | Selections must be non-empty string key-value pairs | Check selections format |

---

## Error Severity Levels

### Recoverable (agent can handle)
- `INSUFFICIENT_BALANCE` → ask human to fund
- `SHIPPING_REQUIRED` → ask human for address, retry
- `ORDER_EXPIRED` → call buy again
- `ORDER_INVALID_STATUS` → check order status
- `URL_UNREACHABLE` → retry or use different URL
- `TRANSFER_FAILED` → safe to retry
- `MISSING_FIELD` → fix request, retry
- `INVALID_URL` → fix URL, retry
- `INVALID_SELECTION` → fix selections format, retry

### Requires Human Attention
- `PRICE_EXCEEDS_LIMIT` → human decides whether to proceed differently
- `PRICE_EXTRACTION_FAILED` → site may be unsupported
- `QUERY_FAILED` → discovery pipeline failed, try different URL
- `X402_PAYMENT_FAILED` → may need manual investigation
- `WALLET_NOT_FOUND` → may indicate configuration issue
- `GAS_TRANSFER_FAILED` → check master wallet ETH balance

### Critical (funds at risk)
- `CHECKOUT_FAILED` → USDC already transferred but purchase failed. tx_hash preserved for manual refund.

---

## Failed Purchase Recovery

When `CHECKOUT_FAILED` occurs:

1. Order status set to `"failed"`
2. `tx_hash` preserved in order record
3. `error.refund_status` set to `"pending_manual"`
4. Agent should report tx_hash to human
5. Human can manually verify on-chain and request refund

```json
{
  "order_id": "bloon_ord_9x2k4m",
  "status": "failed",
  "tx_hash": "0xabc...",
  "error": {
    "code": "CHECKOUT_FAILED",
    "message": "Browser checkout failed at payment step",
    "tx_hash": "0xabc...",
    "refund_status": "pending_manual"
  }
}
```

---

## Validation Rules

### POST /api/wallets
- `agent_name` required, non-empty string

### POST /api/query
- `url` required, valid HTTP(S) URL

### POST /api/buy
- `url` required, valid HTTP(S) URL
- `wallet_id` required, must exist
- `shipping` optional object — if provided, all required fields must be non-empty (name, street, city, state, zip, country, email, phone). `apartment` is optional.
- `shipping` falls back to .env defaults if omitted; returns `SHIPPING_REQUIRED` if no defaults and browser route
- `selections` optional object — if provided, all keys and values must be non-empty strings

### POST /api/confirm
- `order_id` required, must exist
- Order must be in `"awaiting_confirmation"` status
- Order must not be expired (< 5 min since created)

---

## Internal Error Handling

### Browserbase Session Cleanup
- Sessions destroyed after every checkout (success or failure)
- Session timeout: 5 minutes max
- On crash: orphaned sessions expire automatically

### Store Write Safety
- JSON writes use write-then-rename (atomic)
- Concurrent writes are serialized (single-process for v1)
- Store corruption: worst case, restart with fresh store

### On-Chain Transaction Safety
- Check balance before attempting transfer
- Use nonce management to prevent double-sends
- Preserve tx_hash immediately after broadcast
- Never retry a transfer that already broadcast

---

## v1 Limitations

1. **Manual refunds only** — failed purchases with USDC sent require human intervention
2. **No automatic retry** — agent must explicitly retry failed operations
3. **No webhook notifications** — agent must poll for status updates
4. **Single error per response** — no batched error reporting
