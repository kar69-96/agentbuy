# Testing Guidelines — Bloon v1

## Testing Philosophy

- Test on real websites, not mocks
- All on Base Sepolia with test USDC
- Each phase has a test gate — don't proceed until all pass
- Use curl for all API testing
- Browser checkout tests use real Browserbase sessions

---

## Test Directory Structure

Tests live in a `tests/` folder within each package, **not** in `src/`. End-to-end tests live at the repo root.

```
packages/core/tests/           ← Phase 1 (fees, store, concurrency pool)
packages/wallet/tests/         ← Phase 2 (create, balance, qr, transfer, gas)
packages/x402/tests/           ← Phase 3 (detect, pay)
packages/checkout/tests/       ← Phase 4 (session, credentials, discover, fill, cache, confirm)
packages/crawling/tests/       ← Product discovery (Firecrawl, Exa, Browserbase, variants)
packages/orchestrator/tests/   ← Phase 5 (buy, confirm, router, query)
packages/api/tests/            ← Phase 6 (routes, server, funding)
tests/e2e/                     ← Phase 7 (full flow scenarios A–E)
```

Vitest discovers all tests via:
- `packages/*/tests/**/*.test.ts`
- `tests/**/*.test.ts`

Test files import source via `../src/` relative paths (e.g., `import { calculateFee } from "../src/fees.js"`).

---

## Test Websites (Browser Checkout)

| Priority | Site | Why |
|----------|------|-----|
| 1 | Shopify store | Simplest checkout flow, consistent structure |
| 2 | Target.com | Major retailer, standard e-commerce |
| 3 | Best Buy | Electronics, good variety |
| 4 | Amazon.com | Complex checkout, stretch goal |
| 5 | Walmart.com | Complex checkout, stretch goal |

Start with Shopify, prove the flow works, then expand.

---

## Test Categories

### 1. Unit Tests (per package)

**Core (fees, validation):**
- `calculateFee("17.99", "browserbase")` === `"0.36"`
- `calculateFee("0.10", "x402")` === `"0.002"`
- `calculateTotal("17.99", "browserbase")` === `"18.35"`
- Price > $25 throws `PRICE_EXCEEDS_LIMIT`

**Wallet:**
- `createWallet("Test")` returns valid wallet with all fields
- Address is valid (0x, 42 chars)
- No duplicate addresses across wallets
- `getBalance(empty)` returns `"0.00"`
- QR code generates valid base64 PNG
- QR decodes back to wallet address

**Store (JSON persistence):**
- Create wallet → read → matches
- Create order → update status → read → correct
- Data persists to disk, survives reload

### 2. Integration Tests (cross-package)

**x402 Detection:**
- `detectRoute(x402_url)` → `{ route: "x402", requirements }`
- `detectRoute(normal_url)` → `{ route: "browserbase" }`
- `detectRoute(unreachable_url)` → `URL_UNREACHABLE`

**Browser Checkout:**
- `createBrowserbaseSession()` returns session with CDP URL
- `destroySession(id)` succeeds
- `buildPlaceholders()` has all `x_*` keys matching .env
- Task template contains `x_card_number`, NOT real number
- LLM conversation log has zero real credential values

**Price Discovery:**
- `discover(target_url)` returns `{ name, price }`
- `discover(shopify_url)` returns `{ name, price }`
- `discover(bad_url)` returns `PRICE_EXTRACTION_FAILED`

### 3. API Tests (curl)

```bash
# Create wallet
curl -s -X POST http://localhost:3000/api/wallets \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"Test"}' | jq .

# Check balance
curl -s http://localhost:3000/api/wallets/WALLET_ID | jq .

# Get quote
curl -s -X POST http://localhost:3000/api/buy \
  -H "Content-Type: application/json" \
  -d '{"url":"https://...","wallet_id":"WALLET_ID"}' | jq .

# Confirm purchase
curl -s -X POST http://localhost:3000/api/confirm \
  -H "Content-Type: application/json" \
  -d '{"order_id":"ORDER_ID"}' | jq .
```

### 4. Error Path Tests

| Test | Expected |
|------|----------|
| Buy with unfunded wallet | `INSUFFICIENT_BALANCE` (400) |
| Buy product > $25 | `PRICE_EXCEEDS_LIMIT` (400) |
| Buy physical item, no shipping | `SHIPPING_REQUIRED` (400) |
| Confirm expired order | `ORDER_EXPIRED` (410) |
| Confirm nonexistent order | `ORDER_NOT_FOUND` (404) |
| Get nonexistent wallet | `WALLET_NOT_FOUND` (404) |
| Buy with unreachable URL | `URL_UNREACHABLE` (400) |

### 5. End-to-End Tests

**Scenario A: x402 Purchase**
1. Create wallet → fund with test USDC → verify balance
2. `POST /api/buy` with x402 URL → quote with 2% fee
3. `POST /api/confirm` → receipt with service response
4. Verify balance decreased by correct amount

**Scenario B: Browser Purchase (Shopify → Target)**
1. Create wallet → fund → verify
2. `POST /api/buy` with product URL + shipping → quote with 2% fee
3. `POST /api/confirm` → receipt with order number
4. Verify balance decreased

**Scenario C: Domain Cache**
1. Buy from Target (first time) → cache created at `~/.bloon/cache/target.com.json`
2. Buy from Target (second time) → cache injected, checkout completes

---

## Credential Security Verification

After every browser checkout test, verify:
- [ ] LLM conversation log contains zero real card numbers
- [ ] LLM log contains only `x_card_number`, `x_card_cvv`, etc.
- [ ] Real values only appear in DOM injection (Browserbase session)
- [ ] No credentials in API response bodies
- [ ] No credentials in `~/.bloon/orders.json`

---

## Phase Test Gate Summary

| Phase | Test Directory | Test Files | Key Tests |
|-------|---------------|------------|-----------|
| 1 | `packages/core/tests/` | `fees.test.ts`, `store.test.ts`, `concurrency-pool.test.ts` | Types compile, store CRUD, fee math, async pool |
| 2 | `packages/wallet/tests/` | `create.test.ts`, `balance.test.ts`, `qr.test.ts`, `transfer.test.ts`, `gas.test.ts` | Create, balance, QR, transfer, gas |
| 3 | `packages/x402/tests/` | `detect.test.ts`, `pay.test.ts` | Detect route, pay endpoint |
| 4a | `packages/checkout/tests/` | `session.test.ts`, `credentials.test.ts`, `discover.test.ts`, `fill.test.ts`, `cache.test.ts`, `confirm.test.ts` | Session, credentials, discovery, fill, cache |
| 4b | `packages/crawling/tests/` | Firecrawl, Exa, Browserbase, variant tests | Discovery pipeline, variant resolution |
| 5 | `packages/orchestrator/tests/` | `buy.test.ts`, `confirm.test.ts`, `query.test.ts` | Buy + confirm + query orchestration |
| 6 | `packages/api/tests/` | Route tests, server tests | Server starts, all endpoints work, funding page |
| 7 | `tests/e2e/` | End-to-end scenario tests | Full flow scenarios |

See `14-phased-build-plan.md` for detailed test gates per phase.
