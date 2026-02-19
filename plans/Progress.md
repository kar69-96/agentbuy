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

## Phase 2: Wallet Management — NOT STARTED

## Phase 3: x402 Detection & Payment — NOT STARTED

## Phase 4: Browser Checkout — NOT STARTED

## Phase 5: Buy & Confirm Orchestration — NOT STARTED

## Phase 6: API Server + Funding Page — NOT STARTED

## Phase 7: End-to-End Testing — NOT STARTED
