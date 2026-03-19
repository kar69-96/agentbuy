# Implementation Plan: Network-Based Login Gate Detector

## Task Type
- [x] Backend (network monitoring, Playwright event handlers)

## Problem Statement

Current login-gate detection in `detectPageType()` uses **DOM text signal counting** — heuristic, fragile, and fails on:
- **Target**: Dialog modal on `/checkout` URL. Only 0-1 login text signals reach the main page text. Classified as `shipping-form` with 0 fields, stalls forever.
- **Best Buy**: Full-page redirect to `/identity/signin` — URL pattern not in our detection list. If redirect is missed, classified as `shipping-form`.

## Technical Solution

Replace heuristic DOM analysis with **network response monitoring**. Attach a listener to `page.on('response')` during checkout navigation. Collect structured signals (HTTP status codes, redirect URLs, auth API JSON responses) that deterministically identify login gates — before the DOM even renders.

### Three network signals

| Signal | Detection | Covers |
|--------|-----------|--------|
| **Auth redirect** | Response status 3xx, `Location` header matches auth URL patterns | Best Buy (`302 → /identity/signin`) |
| **401/403 on checkout API** | Response status 401 or 403 on URL containing `checkout`, `cart`, `order`, `session` | Target (checkout API rejects unauthed requests) |
| **Auth-status JSON** | Response body (JSON) contains fields like `authenticated: false`, `loggedIn: false`, `isGuest: false`, `requiresAuthentication: true` | Target, Walmart, Amazon (SPA auth checks) |

### Bonus: Dialog detection (structural, not text)

As a complement to network signals, also check `document.querySelector('dialog, [role="dialog"]')` for auth form fields (`input[type="password"]`, `input[autocomplete*="username"]`). This catches Target's modal pattern even if network monitoring misses the API call.

## Implementation Steps

### Step 1: Create `detectLoginGateNetwork()` in `scripted-actions.ts`

New exported async function that attaches to Playwright `page.on('response')` and collects auth signals during a time window.

```typescript
export interface LoginGateNetworkResult {
  isLoginGate: boolean;
  signals: string[];           // Human-readable list of what triggered detection
  redirectUrl?: string;        // Auth redirect destination (for Best Buy pattern)
  hasGuestOption: boolean;     // Detected from DOM after network confirms gate
  has2StepAuth: boolean;       // Email-only first step (no password field yet)
}

export async function detectLoginGateNetwork(
  page: Page,
  timeoutMs?: number,         // default 3000 — how long to listen
): Promise<LoginGateNetworkResult>
```

**Logic:**

1. Collect all responses during `timeoutMs` window (or until page load settles)
2. Check for:
   - **Auth redirects**: Final URL (after redirects) pathname matches expanded patterns:
     `/identity/`, `/auth/`, `/signin`, `/sign-in`, `/login`, `/account/login`, `/ap/signin`, `/sso/`
   - **401/403 responses**: On URLs containing checkout/cart/order/session keywords
   - **Auth JSON responses**: Parse JSON bodies (best-effort, catch errors) for auth-status fields
3. Check DOM for `<dialog>` containing auth inputs (Target pattern)
4. Check DOM for guest checkout button existence

**Returns** the result struct. Does NOT change page type — caller decides what to do.

- Expected deliverable: New function in `scripted-actions.ts`, ~80 lines

### Step 2: Create `attachNetworkMonitor()` / `detachNetworkMonitor()` helpers

Lightweight wrapper around `page.on('response')` that accumulates responses into an array, with auto-cleanup.

```typescript
interface NetworkMonitor {
  responses: Array<{ url: string; status: number; headers: Record<string, string> }>;
  authRedirects: string[];
  authApiFailures: string[];
  detach(): void;
}

function attachNetworkMonitor(page: Page): NetworkMonitor
```

This is called early (before navigating to checkout URL) and detached after `detectLoginGateNetwork` completes. Keeps the monitoring window broad enough to catch redirects that happen during `page.goto()`.

- Expected deliverable: Helper in `scripted-actions.ts` or new file `network-monitor.ts`, ~50 lines

### Step 3: Integrate into checkout loop (`task.ts`)

**Where:** After cart → checkout navigation (around line 880 where we do `page.goto("/checkout")`), BEFORE calling `detectPageType()`.

```typescript
// After navigating to checkout URL
const monitor = attachNetworkMonitor(page);
await page.goto(checkoutUrl, { ... });
await page.waitForTimeout(3000); // Let auth API calls fire

const networkResult = await detectLoginGateNetwork(page);
monitor.detach();

if (networkResult.isLoginGate) {
  pageType = "login-gate";
  console.log(`  [network] login gate detected: ${networkResult.signals.join(', ')}`);
} else {
  pageType = await detectPageType(page);
}
```

**Also:** Attach the monitor before the FIRST navigation (to product URL) so we catch any auth redirects that happen early. But only evaluate for login gate at the checkout transition.

- Expected deliverable: ~20 lines added to `task.ts`

### Step 4: Expand auth URL pattern matching

Current patterns: `/login`, `/signin`, `/sign-in`, `/ap/signin`

Expanded to cover observed patterns:
```typescript
const AUTH_URL_PATTERNS = [
  '/login', '/signin', '/sign-in', '/sign_in',
  '/identity/',   // Best Buy
  '/auth/',       // Generic
  '/authenticate',
  '/account/login', '/account/signin',
  '/ap/signin',   // Amazon
  '/sso/',        // SSO providers
  '/oauth/',      // OAuth flows
];
```

Used in both `detectLoginGateNetwork()` and the existing `detectPageType()` URL checks.

- Expected deliverable: Constant + usage in both functions, ~10 lines

### Step 5: Fix `detectPageType()` evaluation order for checkout URLs

Current problem: On `/checkout` URLs, `shipping-form` check (line 1099) runs before `login-gate` (line 1155). When shipping fields = 0 and login signals < 2, it falls through to the checkout URL fallback at line 1248-1253 which requires `loginCount >= 1` — but Target's dialog text may not be counted.

**Fix:** Add a structural auth-field check that runs BEFORE the shipping-form check on checkout URLs:

```typescript
// NEW: Structural auth detection — password/username fields indicate login gate
const hasAuthDialog = (() => {
  const dialog = document.querySelector('dialog, [role="dialog"]');
  if (!dialog) return false;
  return !!dialog.querySelector(
    'input[type="password"], input[autocomplete*="password"], ' +
    'input[autocomplete*="username"]'
  );
})();

const hasPasswordField = !!deepQuerySelector(
  'input[type="password"], input[autocomplete="current-password"]'
);

// If auth fields present + no shipping fields → login-gate (before shipping-form check)
if ((hasAuthDialog || hasPasswordField) && shippingFieldCount === 0) {
  return "login-gate" as const;
}
```

Insert this at ~line 1079, before the shipping form detection block.

- Expected deliverable: ~15 lines inserted into `detectPageType()`

### Step 6: Enhance login-gate handler for 2-step auth (Best Buy)

Best Buy shows email-only on first step (no password field). Current Path 2 expects both email + password and gets `signInFilled = 1/2`, falling through without acting.

**Fix:** In the login-gate handler (task.ts ~line 929), handle email-only sign-in:

```typescript
if (signInFilled === 1 && !loginPageInfo.hasSignInForm) {
  // 2-step auth: email submitted first, password appears after
  console.log(`  [login-gate] 2-step auth — submitting email first`);
  await scriptedClickButton(page, "continue") ||
    await scriptedClickButton(page, "next") ||
    await scriptedClickButton(page, "submit");
  await page.waitForTimeout(3000);
  // Now fill password on the second step
  // ... (re-evaluate page, fill password)
}
```

- Expected deliverable: ~30 lines in the login-gate case block

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `packages/checkout/src/scripted-actions.ts` | Modify | Add `detectLoginGateNetwork()`, expand auth URL patterns, fix `detectPageType()` evaluation order |
| `packages/checkout/src/task.ts` | Modify | Integrate network monitor into checkout loop, enhance 2-step auth handling |
| `packages/checkout/src/network-monitor.ts` | **NEW** | `attachNetworkMonitor()` / `detachNetworkMonitor()` helpers (~50 lines) |
| `packages/checkout/src/index.ts` | Modify | Export new functions |

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Network listener adds latency | Only listen during checkout transition (3s window), detach immediately after |
| Some sites don't fire 401s (just show login UI) | Dialog structural check as fallback covers this (Target pattern) |
| JSON response body parsing failures | Wrap in try/catch, only parse `content-type: application/json` responses |
| False positives on sites with auth + guest checkout on same page | `hasGuestOption` flag prevents misclassifying — we still detect the gate but take the guest path |
| 2-step auth password step varies by site | After email submission, re-run `detectPageType()` to re-evaluate |
| Monitor captures too many responses (performance) | Filter to only checkout-domain URLs, limit array to 200 entries |

## Verification

1. **Target**: Should detect login-gate via dialog structural check (password + username in `<dialog>`) + potentially 401 on checkout API. Should route to Path 3 (account creation) since no guest option.
2. **Best Buy**: Should detect login-gate via auth redirect (`302 → /identity/signin`). Should route to Path 1 (guest checkout) since "Continue as Guest" button exists.
3. **Shopify stores**: Should NOT trigger login-gate detection (no auth redirects, no 401s, no dialogs). All 3 should continue to PASS.
4. Run `pnpm type-check` — clean build.
5. Run `pnpm test:checkout:loop` — 3 Shopify PASS + improved Target/Best Buy behavior.

## Implementation Order

1. Step 4 (expand URL patterns) — smallest change, immediate value
2. Step 5 (fix detectPageType order) — catches Target without any network monitoring
3. Step 2 (network monitor helper) — foundation for network detection
4. Step 1 (detectLoginGateNetwork) — the main detector
5. Step 3 (integrate into task.ts) — wire it up
6. Step 6 (2-step auth) — Best Buy specific enhancement

Steps 1-5 deliver deterministic detection. Step 6 handles the Best Buy edge case.

## SESSION_ID
- CODEX_SESSION: N/A (wrapper not available)
- GEMINI_SESSION: N/A (wrapper not available)
