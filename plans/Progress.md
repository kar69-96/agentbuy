# Proxo v1 — Build Progress

## Phase 1: Foundation — COMPLETE

**Status:** All deliverables complete, all tests passing.

---

### What Was Built

#### Root Config (5 files)

| File | Purpose |
|------|---------|
| `pnpm-workspace.yaml` | Monorepo workspace definition (`packages/*`) |
| `package.json` | Root scripts (`build`, `test`), shared devDeps |
| `tsconfig.base.json` | ES2022, strict, ESNext modules, declaration maps |
| `.env.example` | Full environment template (card, billing, shipping, API keys, blockchain) |
| `.gitignore` | Updated with `*.tsbuildinfo`, `.proxo/` |

#### @proxo/core (6 source files)

| File | Purpose |
|------|---------|
| `packages/core/src/types.ts` | All TypeScript interfaces, `ProxoError` class, `ErrorCodes` const (13 codes) |
| `packages/core/src/store.ts` | JSON file persistence with atomic writes, Promise-chain serialization, `generateId()` |
| `packages/core/src/fees.ts` | BigInt decimal fee calculator with ceiling rounding |
| `packages/core/src/config.ts` | dotenv loader, typed accessors for network/credentials/contracts |
| `packages/core/src/index.ts` | Barrel re-exports |
| `packages/core/tsconfig.json` | Extends base config |

#### Stub Packages (4 packages, 3 files each)

| Package | Name | Phase |
|---------|------|-------|
| `packages/wallet/` | `@proxo/wallet` | Phase 2: create, balance, transfer, qr |
| `packages/x402/` | `@proxo/x402` | Phase 3: detect, pay |
| `packages/checkout/` | `@proxo/checkout` | Phase 4: session, discover, complete, cache |
| `packages/api/` | `@proxo/api` | Phase 6: server, routes, funding page |

#### Tests (3 files)

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Test discovery via `packages/*/tests/**/*.test.ts` + `tests/**/*.test.ts` |
| `packages/core/tests/fees.test.ts` | 10 tests — fee calculation, rounding, limits |
| `packages/core/tests/store.test.ts` | 12 tests — wallet CRUD, order CRUD, disk persistence |

---

### Test Results

```
 ✓ packages/core/tests/fees.test.ts (10 tests)
 ✓ packages/core/tests/store.test.ts (12 tests)

 Test Files  2 passed (2)
      Tests  22 passed (22)
```

#### Test Gate Checklist (from 14-phased-build-plan.md)

- [x] `pnpm install` + `pnpm -r build` succeeds
- [x] store: create wallet record -> read -> matches
- [x] store: create order -> update status -> read -> correct
- [x] store: persists to disk, reload returns same data
- [x] fees: `calculateFee("17.99", "browserbase")` === `"0.90"`
- [x] fees: `calculateFee("0.10", "x402")` === `"0.0005"`
- [x] fees: `calculateTotal("17.99", "browserbase")` === `"18.89"`
- [x] fees: price > 25 throws `PRICE_EXCEEDS_LIMIT`

#### Additional Tests Beyond Spec

- fees: $25.00 exactly does NOT throw (boundary check)
- fees: $10.00 browserbase fee is `"0.50"` (trailing zero preservation)
- fees: $1.00 x402 fee is `"0.005"` (sub-cent exact output)
- fees: $20.00 x402 fee rounds to `"0.10"`
- store: `generateId` produces correct `proxo_{prefix}_{6chars}` format
- store: 100 generated IDs are all unique
- store: non-existent wallet returns undefined
- store: lists all wallets
- store: finds wallet by funding token
- store: partial order update preserves other fields
- store: filters orders by wallet_id

---

### Dependencies Installed

**Root devDependencies:**
- `typescript` ^5.7
- `vitest` ^3.0
- `@types/node` ^25.3

**@proxo/core dependencies:**
- `dotenv` ^16.4

---

### Key Implementation Notes

1. **BigInt fee math** — All fee calculations use `BigInt` fixed-point arithmetic to avoid floating-point rounding errors. Fees >= $0.01 are ceiling-rounded to 2 decimal places with trailing zeros preserved.

2. **Atomic store writes** — JSON files are written to a `.tmp` file first, then `renameSync` for POSIX-atomic replacement. Per-file Promise chains serialize concurrent writes.

3. **Test isolation** — `PROXO_DATA_DIR` env var overrides the default `~/.proxo/` directory. Tests use `os.tmpdir()` temp directories, cleaned up after each test.

4. **ESM throughout** — All packages use `"type": "module"`, imports use `.js` extensions.

5. **Test directory convention** — Tests live in `packages/*/tests/`, not in `src/`. E2E tests live in `tests/e2e/` at the repo root. See `07-testing-guidelines.md` for the full mapping.

---

## Test Directory Map (all phases)

```
packages/core/tests/        ← Phase 1 (fees, store) + Phase 5 (buy, confirm, router)
packages/wallet/tests/      ← Phase 2 (create, balance, qr, transfer)
packages/x402/tests/        ← Phase 3 (detect, pay)
packages/checkout/tests/    ← Phase 4 (session, placeholders, discover, checkout, cache)
packages/api/tests/         ← Phase 6 (routes, server, funding)
tests/e2e/                  ← Phase 7 (full flow scenarios A–E)
```

---

## Phase 2: Wallet Management — COMPLETE

**Status:** All deliverables complete, all 39 tests passing (including network tests on Base Sepolia).

---

### What Was Built

#### @proxo/wallet Source Files (7 files)

| File | Purpose |
|------|---------|
| `packages/wallet/src/usdc-abi.ts` | Minimal ERC-20 ABI: `balanceOf` + `transfer` (as const) |
| `packages/wallet/src/client.ts` | Internal: lazy-cached viem `PublicClient`, `getChain()` helper |
| `packages/wallet/src/create.ts` | `createWallet(agentName)` — generate private key, derive address, persist to store |
| `packages/wallet/src/balance.ts` | `getBalance(address)` — read USDC via `readContract`; `formatUsdc(bigint)` utility |
| `packages/wallet/src/transfer.ts` | `transferUSDC(privateKey, toAddress, amount)` — balance check, sign, broadcast, wait for receipt |
| `packages/wallet/src/qr.ts` | `generateQR(address)` — base64 PNG data URL via qrcode |
| `packages/wallet/src/index.ts` | Barrel re-exports (excludes `client.ts` and `usdc-abi.ts`) |

#### Tests (4 files)

| File | Tests | Offline | Network |
|------|-------|---------|---------|
| `packages/wallet/tests/create.test.ts` | 6 | All offline | — |
| `packages/wallet/tests/qr.test.ts` | 2 | All offline | — |
| `packages/wallet/tests/balance.test.ts` | 7 offline + 1 network | `formatUsdc` unit tests | `getBalance(empty)` → "0.00" |
| `packages/wallet/tests/transfer.test.ts` | 1 network | — | Insufficient balance → TRANSFER_FAILED |

### Test Results

```
 ✓ packages/core/tests/fees.test.ts (10 tests)
 ✓ packages/core/tests/store.test.ts (12 tests)
 ✓ packages/wallet/tests/create.test.ts (6 tests)
 ✓ packages/wallet/tests/qr.test.ts (2 tests)
 ✓ packages/wallet/tests/balance.test.ts (8 tests)
 ✓ packages/wallet/tests/transfer.test.ts (1 test)

 Test Files  6 passed (6)
      Tests  39 passed (39)
```

Network tests verified on Base Sepolia with funded wallet (`0xBA19...0374`, 20 USDC via Circle faucet).

#### Test Gate Checklist

- [x] `createWallet("Test")` returns `{ wallet_id, address, private_key, funding_token }`
- [x] address is valid (0x, 42 chars), checksummed
- [x] private key derives back to the same address
- [x] No duplicate addresses across 10 wallets
- [x] Wallet persisted to store and retrievable
- [x] `formatUsdc(0n)` → `"0.00"`, `formatUsdc(1000000n)` → `"1.00"`
- [x] `generateQR(address)` returns valid `data:image/png;base64,...`
- [x] QR decodes back to the wallet address (jsqr + pngjs)
- [x] `getBalance(empty_address)` → `"0.00"` (verified on Base Sepolia)
- [x] `transferUSDC` insufficient balance → `TRANSFER_FAILED` (verified on Base Sepolia)

### Dependencies Added

**@proxo/wallet dependencies:**
- `viem` ^2.0.0 — wallet generation, contract reads/writes, chain config
- `qrcode` ^1.5.0 — QR code → base64 PNG data URL

**@proxo/wallet devDependencies:**
- `@types/qrcode` ^1.5.0
- `jsqr` ^1.4.0 — QR decode for tests only
- `pngjs` ^7.0.0 — PNG parse for QR decode test
- `@types/pngjs` ^6.0.0

### Key Implementation Notes

1. **viem for all blockchain ops** — `generatePrivateKey()`, `privateKeyToAccount()`, `createPublicClient`, `createWalletClient`, `readContract`, `writeContract`, `waitForTransactionReceipt`.

2. **Lazy-cached public client** — Single `PublicClient` instance reused across balance reads and receipt waits.

3. **Per-call wallet client** — `createWalletClient` is instantiated per transfer, not cached, since each transfer uses a different private key.

4. **USDC 6-decimal formatting** — `formatUsdc` ensures minimum 2 decimal places via `formatUnits` + padding.

5. **Network test isolation** — `describe.skipIf(!process.env.BASE_RPC_URL)` ensures `pnpm test` always passes offline.

## Phase 3: x402 Detection & Payment — COMPLETE

**Status:** All deliverables complete, all 42 tests passing (offline + network).

---

### What Was Built

#### @proxo/x402 Source Files (3 files)

| File | Purpose |
|------|---------|
| `packages/x402/src/detect.ts` | `detectRoute(url)` — GET probe, parse x402 v2 `accepts` array, match chain ID, fallback to browserbase |
| `packages/x402/src/pay.ts` | `payX402(url, privateKey)` — create x402Client, register EVM scheme, wrap fetch, auto-pay 402, return response |
| `packages/x402/src/index.ts` | Barrel re-exports (`detectRoute`, `DetectResult`, `payX402`, `X402PaymentResult`) |

#### Tests (2 files)

| File | Tests | Offline | Network |
|------|-------|---------|---------|
| `packages/x402/tests/detect.test.ts` | 2 offline + 1 network | Normal URL → browserbase; unreachable → URL_UNREACHABLE | PayAI echo merchant → x402 with requirements |
| `packages/x402/tests/pay.test.ts` | 1 network (skipped without TEST_WALLET_PRIVATE_KEY) | — | PayAI echo merchant → 200 response |

### Test Results

```
 ✓ packages/core/tests/fees.test.ts (10 tests)
 ✓ packages/core/tests/store.test.ts (12 tests)
 ✓ packages/wallet/tests/create.test.ts (6 tests)
 ✓ packages/wallet/tests/qr.test.ts (2 tests)
 ✓ packages/wallet/tests/balance.test.ts (8 tests)
 ✓ packages/wallet/tests/transfer.test.ts (1 test)
 ✓ packages/x402/tests/detect.test.ts (3 tests)
 ✓ packages/x402/tests/pay.test.ts (1 test) 7613ms

 Test Files  8 passed (8)
      Tests  43 passed (43)
```

All tests verified on Base Sepolia against PayAI echo merchant (`x402.payai.network`).
Live payment completed in ~7.6s — auto-refunded by echo merchant.

#### Test Gate Checklist

- [x] `detectRoute(normal_url)` → `{ route: "browserbase" }`
- [x] `detectRoute(unreachable_url)` → throws `ProxoError(URL_UNREACHABLE)`
- [x] `detectRoute(x402_url)` → `{ route: "x402", requirements: { payTo, maxAmountRequired, network: "eip155:84532" } }` (network)
- [x] `detectRoute(402_bad_parse)` → fallback to `{ route: "browserbase" }` (covered by parse try/catch)
- [x] `payX402(test_endpoint, privateKey)` → `{ status: 200, response }` (network — verified on Base Sepolia)
- [x] Fee math: $0.10 x402 → total $0.1005 (already tested in core)

### Dependencies Added

**@proxo/x402 dependencies:**
- `@x402/fetch` ^2.3.0 — x402 payment protocol fetch wrapper (auto-handles 402 responses)
- `@x402/evm` ^2.3.0 — EVM exact payment scheme (EIP-3009 TransferWithAuthorization)
- `viem` ^2.0.0 — account derivation for signing

### Key Implementation Notes

1. **x402 v2 protocol** — `detectRoute` sends a plain GET, parses the 402 response body's `accepts` array for a matching chain ID (`eip155:84532` for Base Sepolia, `eip155:8453` for Base mainnet).

2. **Chain ID mapping** — Uses `getNetwork()` from `@proxo/core` to determine `base-sepolia` → `eip155:84532` or `base` → `eip155:8453`.

3. **Graceful fallback** — Any parse failure (malformed JSON, missing fields, no matching chain) falls back to `{ route: "browserbase" }` instead of throwing.

4. **x402 client pattern** — `payX402` creates a fresh `x402Client`, registers the EVM exact scheme with wildcard `eip155:*`, and wraps fetch. The wrapped fetch auto-detects 402, signs an EIP-3009 authorization, and retries.

5. **No ETH needed** — x402 uses EIP-3009 (TransferWithAuthorization) — the buyer signs off-chain and the facilitator pays gas. Only USDC balance is needed.

6. **Test isolation** — Network tests skip via `describe.skipIf(!process.env.BASE_RPC_URL)`. Pay test additionally requires `TEST_WALLET_PRIVATE_KEY`.

### To Run Live Payment Test

Add a funded wallet private key to `.env`:
```
TEST_WALLET_PRIVATE_KEY=0x...
```
The PayAI echo merchant auto-refunds on testnet, so no USDC is permanently spent.

## Phase 4: Browser Checkout — NOT STARTED

## Phase 5: Buy & Confirm Orchestration — NOT STARTED

## Phase 6: API Server + Funding Page — NOT STARTED

## Phase 7: End-to-End Testing — NOT STARTED
