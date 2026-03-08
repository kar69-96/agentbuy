# Orchestrator Package — Business Logic Layer

The `packages/orchestrator` package is the glue between the API layer and all backend packages. It was created to solve circular dependency issues — `core` can't import from `checkout`, `wallet`, or `x402`, but the buy/confirm/query logic needs all of them.

## Why It Exists

Without `orchestrator`, the dependency chain would be circular:

```
core → checkout → core (circular)
core → wallet → core (circular)
```

With `orchestrator`:

```
api → orchestrator → checkout, wallet, x402, core
```

The API routes call orchestrator functions. Orchestrator calls the right backend packages. No circular imports.

## Package Exports

```typescript
// packages/orchestrator/src/index.ts
export { routeOrder, type RouteDecision } from "./router.js";
export { buy, type BuyInput } from "./buy.js";
export { confirm, type ConfirmInput, type ConfirmResult } from "./confirm.js";
export { buildReceipt, type ReceiptInput } from "./receipts.js";
export { query, type QueryInput } from "./query.js";
```

## Functions

### `routeOrder(url: string) → RouteDecision`

Determines whether a URL is an x402 endpoint or a regular website.

- Calls `detectRoute(url)` from `@bloon/x402`
- Returns `{ route: "x402" | "browserbase", requirements?: X402Requirements }`
- x402 requirements include: `scheme`, `network`, `maxAmountRequired`, `payTo`, `asset`

### `query(input: QueryInput) → QueryResponse`

Discovers product info without requiring a wallet. Recommended first step.

**Flow:**
1. Validate URL format
2. Call `routeOrder(url)` to detect x402 vs browserbase
3. **x402 path:** Return price from requirements immediately. No shipping needed.
4. **browserbase path:** Call `discoverProduct(url)` from `@bloon/checkout` which runs the full 4-tier discovery pipeline (Firecrawl → Exa.ai → scrape → Browserbase)
5. Build `required_fields` — always includes standard shipping fields (name, email, phone, street, apartment, city, state, zip, country). Adds "selections" if product has options.
6. Return `QueryResponse` with product info, options, required fields, route, and discovery method

### `buy(input: BuyInput) → Order`

Creates a purchase quote. Does NOT spend USDC.

**Flow:**
1. Validate URL format
2. Look up wallet (throws `WALLET_NOT_FOUND`)
3. Call `routeOrder(url)`
4. **x402 path:** Price from requirements. No shipping needed.
5. **browserbase path:**
   - Resolve shipping: use provided → fall back to .env defaults → throw `SHIPPING_REQUIRED`
   - Validate all required shipping fields are non-empty (except `apartment`)
   - Validate selections (if provided) are non-empty string key-value pairs
   - Call `discoverPrice(url, shipping)` from `@bloon/checkout`
6. Calculate fee and total using BigInt arithmetic (enforces $25 max)
7. Check wallet balance (throws `INSUFFICIENT_BALANCE`)
8. Create order with status `"awaiting_confirmation"`, expires in 5 minutes
9. Persist order to store

### `confirm(input: ConfirmInput) → ConfirmResult`

Executes a purchase. Transfers USDC and fulfills the order.

**Flow:**
1. Look up order (throws `ORDER_NOT_FOUND`)
2. If already completed → return existing receipt (idempotent)
3. Must be `"awaiting_confirmation"` (throws `ORDER_INVALID_STATUS`)
4. Check expiry (throws `ORDER_EXPIRED`, updates status)
5. Update status → `"processing"`
6. Load wallet and config
7. Re-check balance (may have changed since buy-time)
8. **x402 path:**
   - Transfer FEE amount to master wallet
   - Save `tx_hash` immediately
   - Call `payX402(url, wallet.private_key)` — agent wallet pays service directly
   - Build receipt from x402 result
9. **browserbase path:**
   - Transfer FULL amount (price + fee) to master wallet
   - Save `tx_hash` immediately
   - Call `runCheckout({ order, shipping, selections })`
   - Build receipt from checkout result (order_number, session_id)
10. Update status → `"completed"`, save receipt
11. **On error:** Update status → `"failed"`. If USDC was sent (`tx_hash` exists), set `refund_status: "pending_manual"`.

### `buildReceipt(input: ReceiptInput) → Receipt`

Creates a unified receipt for both routes.

**Common fields:** product name, merchant (hostname), route, price, fee, total_paid, tx_hash, timestamp

**x402 adds:** `response` (the service's actual response data)

**browserbase adds:** `order_number`, `browserbase_session_id`

## Dependencies

```
@bloon/orchestrator
  ├── @bloon/core       (types, store, fees, config, error codes)
  ├── @bloon/wallet     (getBalance, transferUSDC)
  ├── @bloon/x402       (detectRoute, payX402)
  └── @bloon/checkout   (discoverProduct, discoverPrice, runCheckout)
```

## Key Design Decisions

1. **Separate package, not in core** — avoids circular imports while keeping business logic centralized
2. **tx_hash saved immediately** — if checkout fails after USDC transfer, the hash is preserved for manual refund
3. **Idempotent confirm** — re-confirming a completed order returns the existing receipt
4. **Balance re-checked at confirm time** — wallet may have been spent between buy and confirm
5. **Selections validated** — non-empty string keys and values only
6. **Standard shipping fields always included** — query response always tells the agent what fields are needed
7. **Fee amount vs full amount** — x402 transfers only the fee to master (agent pays service directly), browserbase transfers the full amount (Bloon's card pays)

## Files

| File | Purpose |
|------|---------|
| `router.ts` | x402 detection wrapper |
| `query.ts` | Product discovery orchestrator |
| `buy.ts` | Quote generation with validation |
| `confirm.ts` | Payment execution + receipt generation |
| `receipts.ts` | Unified receipt builder |
| `index.ts` | Re-exports |
