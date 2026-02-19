# Phased Build Plan — Proxo v1

Each phase has test gates. Don't proceed until all pass. All on Base Sepolia.

---

## Phase 1: Foundation (30 min)

Monorepo, types, JSON store, fee calculator.

### Deliverables

Scaffolded monorepo with packages: core, wallet, x402, checkout, api (stubs). All types from 09-data-models.md. Working JSON store for wallets + orders.

### Test Gate

```
[ ] pnpm install + pnpm -r build succeeds
[ ] store: create wallet record → read → matches
[ ] store: create order → update status → read → correct
[ ] store: persists to disk, reload returns same data
[ ] fees: calculateFee("17.99", "browserbase") === "0.90"
[ ] fees: calculateFee("0.10", "x402") === "0.0005"
[ ] fees: calculateTotal("17.99", "browserbase") === "18.89"
[ ] fees: price > 25 throws PRICE_EXCEEDS_LIMIT
```

---

## Phase 2: Wallet Management (30 min)

viem wallets, USDC balance, QR codes, transfers.

### Deliverables

wallet/create.ts, wallet/balance.ts, wallet/transfer.ts, wallet/qr.ts

### Test Gate

```
[ ] createWallet("Test") returns { wallet_id, address, private_key, funding_token }
[ ] address is valid (0x, 42 chars), private_key is valid hex
[ ] No duplicate addresses across wallets
[ ] getBalance(empty_address) === "0.00"
[ ] getBalance(funded_address) returns correct amount (testnet)
[ ] generateQR(address) returns valid base64 PNG data URL
[ ] QR decodes back to the wallet address
[ ] transferUSDC(from, to, "1.00") succeeds on Base Sepolia
[ ] transferUSDC with insufficient balance returns TRANSFER_FAILED
```

---

## Phase 3: x402 Detection & Payment (45 min)

Detect x402 endpoints, pay from Proxo wallet, get response.

### Deliverables

x402/detect.ts, x402/pay.ts

### Test Gate

```
[ ] detectRoute(x402_url) → { route: "x402", requirements: {...} }
[ ] detectRoute(normal_url) → { route: "browserbase" }
[ ] detectRoute(unreachable_url) → URL_UNREACHABLE
[ ] detectRoute(402_bad_headers) → fallback to browserbase
[ ] payX402(test_endpoint) returns service response
[ ] Quote: $0.10 → total $0.1005 (0.5% fee)
```

---

## Phase 4: Browser Checkout (1.5 hrs)

Browserbase + browser-use + placeholders + domain cache. Largest phase.

### Deliverables

checkout/session.ts, checkout/placeholders.ts, checkout/discover.ts, checkout/complete.ts, checkout/executor.ts, checkout/cache.ts

### Test Gate — Ordered

**Baseline:**
```
[ ] createBrowserbaseSession() returns session with CDP URL
[ ] destroySession(id) succeeds
[ ] buildPlaceholders() has all x_* keys, values match .env
```

**Discovery (price extraction):**
```
[ ] discover(target_url) returns { name, price }
[ ] discover(bestbuy_url) returns { name, price }
[ ] discover(amazon_url) returns { name, price }
[ ] discover(bad_url) returns PRICE_EXTRACTION_FAILED
```

**Credential security:**
```
[ ] Task template contains x_card_number, NOT real number
[ ] LLM conversation log has zero real credential values
```

**Full checkout (real sites, in order):**
```
[ ] Shopify store: navigate → cart → checkout → fill → submit → confirmation
[ ] Target.com: same flow
[ ] Amazon.com: same flow (stretch)
```

**Domain cache:**
```
[ ] First visit creates ~/.proxo/cache/{domain}.json
[ ] Second visit injects cached cookies
[ ] No auth tokens in cache
```

---

## Phase 5: Buy & Confirm Orchestration (1 hr)

Wire routing, fees, USDC transfer, and execution into buy() and confirm().

### Deliverables

core/buy.ts, core/confirm.ts, core/router.ts (updated), core/receipts.ts

### Test Gate

```
[ ] buy({ url: x402_endpoint }) → order with route "x402", correct fee
[ ] buy({ url: amazon_product }) → order with route "browserbase", correct fee
[ ] buy without shipping + browser route + no defaults → SHIPPING_REQUIRED
[ ] buy without shipping + browser route + .env defaults → uses defaults
[ ] buy with shipping → uses provided shipping
[ ] buy x402 → no shipping needed
[ ] buy unfunded wallet → INSUFFICIENT_BALANCE
[ ] buy price > $25 → PRICE_EXCEEDS_LIMIT
[ ] confirm x402: transfers USDC + pays service + returns receipt with response
[ ] confirm browser: transfers USDC + checks out + returns receipt with order number
[ ] confirm expired → ORDER_EXPIRED
[ ] confirm already completed → returns existing receipt
[ ] confirm USDC sent but purchase fails → status "failed", tx_hash preserved
```

---

## Phase 6: API Server + Funding Page (45 min)

Hono routes, funding HTML page, wire everything up.

### Deliverables

api/server.ts, api/routes/wallets.ts, api/routes/buy.ts, api/routes/confirm.ts, api/routes/fund.ts, api/index.ts

### Test Gate

```
[ ] Server starts: node packages/api/dist/index.js → listening on :3000
[ ] curl POST /api/wallets → returns wallet_id + funding_url
[ ] curl GET /api/wallets/:id → returns balance
[ ] curl POST /api/buy → returns quote
[ ] curl POST /api/confirm → executes + returns receipt
[ ] No auth headers required on any endpoint
[ ] GET /fund/:token returns HTML page with QR code
[ ] Funding page shows live balance (polls every 10s)
[ ] Invalid wallet_id → 404 JSON error
[ ] Invalid order_id → 404 JSON error
[ ] Missing required fields → 400 JSON error
```

---

## Phase 7: End-to-End (1 hr)

Full flows. Both routes. Real websites. Testnet USDC.

### Scenario A: x402 Purchase
```
[ ] POST /api/wallets → wallet created
[ ] Human opens funding_url, sends test USDC
[ ] GET /api/wallets/:id → balance updated
[ ] POST /api/buy { x402 url } → quote with 0.5% fee
[ ] POST /api/confirm → receipt with service response
[ ] GET /api/wallets/:id → deposit + purchase in history
```

### Scenario B: Browser Purchase (Target)
```
[ ] POST /api/buy { target url, shipping } → quote with 5% fee
[ ] POST /api/confirm → browser checkout, receipt with order number
[ ] GET /api/wallets/:id → balance reduced
```

### Scenario C: Shipping Prompt
```
[ ] POST /api/buy { url, no shipping, no defaults } → SHIPPING_REQUIRED
[ ] Retry with shipping → quote returned
```

### Scenario D: Repeat Domain
```
[ ] Buy from Target (first) → cache created
[ ] Buy from Target (second) → cache injected, checkout completes
```

### Scenario E: Errors
```
[ ] Buy $30 product → PRICE_EXCEEDS_LIMIT
[ ] Buy with $2 balance → INSUFFICIENT_BALANCE
[ ] Confirm expired order → ORDER_EXPIRED
[ ] GET /api/wallets/bad_id → WALLET_NOT_FOUND
```

### Final Checklist
```
[ ] All phases pass
[ ] NETWORK env var switches testnet/mainnet cleanly
[ ] USDC contract selected by network
[ ] ~/.proxo/ has 600 permissions
[ ] .env.example is complete
[ ] Funding page works in mobile browser
```

---

## Summary

| Phase | What | Time | Cumulative |
|-------|------|------|-----------|
| 1 | Foundation (types, store, fees) | 30 min | 0:30 |
| 2 | Wallets (generate, balance, QR, transfer) | 30 min | 1:00 |
| 3 | x402 (detect, pay) | 45 min | 1:45 |
| 4 | Browser Checkout (browserbase, browser-use) | 1.5 hrs | 3:15 |
| 5 | Buy & Confirm (orchestration, routing) | 1 hr | 4:15 |
| 6 | API Server + Funding Page (Hono, HTML) | 45 min | 5:00 |
| 7 | E2E Testing | 1 hr | 6:00 |

**Total: ~6 hours.** Phase 4 is the wildcard.
