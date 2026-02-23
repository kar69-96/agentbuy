# Browserbase Refinement — Iterative Computer Use Testing

Iterative test harness for validating Browserbase + Stagehand browser checkout across real e-commerce sites. Uses upgraded Browserbase account with stealth mode, residential proxies, and automatic CAPTCHA solving.

**Goal**: One agnostic prompt that handles any e-commerce checkout page — guest or authenticated.

---

## Browserbase Configuration

Upgraded account enables all anti-detection features:

```typescript
const session = await fetch("https://api.browserbase.com/v1/sessions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-bb-api-key": process.env.BROWSERBASE_API_KEY,
  },
  body: JSON.stringify({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    proxies: true,                    // residential proxies
    browserSettings: {
      solveCaptchas: true,            // auto-solve CAPTCHAs
      recordSession: true,            // session replay for debugging
      logSession: true,               // network + console logs
      stealth: true,                  // stealth mode (upgraded)
    },
  }),
});
```

Key capabilities:
- **Stealth mode** — evades bot detection fingerprinting
- **Residential proxies** — real IP addresses, not datacenter
- **CAPTCHA solving** — Browserbase handles reCAPTCHA, hCaptcha, etc.
- **Session replay** — full visual replay at `https://www.browserbase.com/sessions/{id}`

---

## The Agnostic Prompt

A single orchestration flow that adapts to any e-commerce site. The prompt handles site variations through Stagehand's natural language understanding — no site-specific logic needed.

### Core Flow

```
1. Navigate to product URL
2. Dismiss overlays (cookie banners, popups, modals, newsletter signups)
3. Add product to cart
4. Proceed to checkout
5. Route: guest checkout vs login
   a. If guest checkout available → select it
   b. If login required → fill credentials via variables (agent never sees them)
6. Fill shipping info via Stagehand variables (%var% syntax)
7. Select cheapest shipping option
8. Skip express pay (Shop Pay, Google Pay, Apple Pay, PayPal, Amazon Pay)
9. Select standard credit card payment
10. Fill card fields via Playwright CDP (bypasses LLM entirely)
11. Extract order total → verify against expected price
12. Submit order
13. Wait for confirmation page
14. Extract confirmation number + final total
```

### Prompt Template

The checkout orchestration uses these Stagehand instructions. Each instruction is site-agnostic — Stagehand figures out the specific selectors.

**Phase 1 — Navigate & Cart**
```typescript
await stagehand.act(`navigate to ${productUrl}`);
await stagehand.act(
  "dismiss any cookie banners, popups, modals, newsletter signups, or overlays"
);
await stagehand.act("add the product to the cart. If there are size or variant options, select the first available option");
await stagehand.act("proceed to checkout or view cart and then proceed to checkout");
```

**Phase 2 — Guest vs Login**
```typescript
// First, try guest checkout
const guestOption = await stagehand.observe(
  "find any Guest Checkout, Continue as Guest, or Checkout without account option"
);

if (guestOption.length > 0) {
  await stagehand.act("select Guest Checkout or Continue as Guest");
} else {
  // Login required — credentials passed as variables, never seen by agent
  await stagehand.act("find and click the Sign In or Log In button");
  await stagehand.act("fill the email or username field with %login_email%", {
    variables: { login_email: credentials.email },
  });
  await stagehand.act("fill the password field with %login_password%", {
    variables: { login_password: credentials.password },
  });
  await stagehand.act("click the Sign In or Log In submit button");
  // Wait for redirect after login
  await stagehand.act("wait for the page to load after signing in");
  await stagehand.act("proceed to checkout");
}
```

**Phase 3 — Shipping**
```typescript
await stagehand.act("fill the first name field with %first_name%", {
  variables: { first_name: shipping.firstName },
});
await stagehand.act("fill the last name field with %last_name%", {
  variables: { last_name: shipping.lastName },
});
await stagehand.act("fill the street address field with %street%", {
  variables: { street: shipping.street },
});
await stagehand.act("fill the city field with %city%", {
  variables: { city: shipping.city },
});
await stagehand.act("select %state% in the state or province dropdown", {
  variables: { state: shipping.state },
});
await stagehand.act("fill the ZIP or postal code field with %zip%", {
  variables: { zip: shipping.zip },
});
await stagehand.act("fill the phone number field with %phone%", {
  variables: { phone: shipping.phone },
});
await stagehand.act("fill the email field with %email%", {
  variables: { email: shipping.email },
});
await stagehand.act("select the cheapest available shipping option");
await stagehand.act("continue to the payment step or click Continue or Next");
```

**Phase 4 — Payment**
```typescript
await stagehand.act(
  "ignore any Shop Pay, Google Pay, Apple Pay, PayPal, Amazon Pay, Venmo, or Afterpay buttons. " +
  "Find and select the standard credit card or debit card payment option."
);

// Card fields via Playwright CDP — LLM never sees these values
const cardFields = await stagehand.observe(
  "find the card number input, expiry date input, and CVV or security code input fields. " +
  "If they are inside iframes, identify the iframe selectors."
);
// Fill via CDP (see 12-computer-use.md for implementation)
for (const field of cardFields) {
  await fillCardFieldViaCDP(cdpPage, field.selector, field.fieldName);
}
```

**Phase 5 — Verify & Submit**
```typescript
const priceCheck = await stagehand.extract(
  "extract the order total from the checkout summary",
  z.object({ total: z.string() }),
);

// Verify price within tolerance before submitting
const finalTotal = parseFloat(priceCheck.total.replace(/[$,]/g, ""));
if (Math.abs(finalTotal - expectedTotal) > Math.min(1, expectedTotal * 0.05)) {
  throw new PriceMismatchError(expectedTotal, finalTotal);
}

await stagehand.act("click the Place Order or Pay Now or Complete Purchase or Submit Order button");
```

**Phase 6 — Confirmation**
```typescript
await new Promise((r) => setTimeout(r, 5000)); // wait for confirmation page

const confirmation = await stagehand.extract(
  "extract the order confirmation number, order ID, and final total from the confirmation or thank you page",
  z.object({
    orderNumber: z.string().optional(),
    total: z.string().optional(),
    message: z.string().optional(),
  }),
);
```

---

## Credential Handling

The agent **never** sees real credentials. Two mechanisms ensure this:

### Card Fields — Playwright CDP (Zero LLM Exposure)

Card number, CVV, and expiry are filled via Playwright's Chrome DevTools Protocol connection directly into the DOM. The Stagehand LLM is not involved at all.

### Login Credentials — Stagehand Variables (Zero LLM Exposure)

When a site requires login, the user provides credentials through the API. These are passed as Stagehand `variables` — the `%var%` syntax substitutes values at the execution layer. The LLM sees only the placeholder names, never the actual values.

```
LLM sees:  "fill the password field with %login_password%"
LLM log:   "fill the password field with %login_password%"
Execution: fills "correcthorsebatterystaple" into the password field
```

### Credential Lifecycle

1. User provides credentials via API request (e.g., `POST /api/confirm` with `credentials` field)
2. Server stores them in memory only — never written to disk, logs, or order records
3. Passed to Stagehand via `variables` parameter
4. Used once during the checkout session
5. Discarded when the session is destroyed — no persistence

### What the Agent Sees vs What It Doesn't

| Data | Agent Sees? | Method |
|------|-------------|--------|
| Product URL, name, price | Yes | Direct |
| Shipping name, address | Placeholder only (`%var%`) | Stagehand variables |
| Email, phone | Placeholder only (`%var%`) | Stagehand variables |
| Login email | Placeholder only (`%login_email%`) | Stagehand variables |
| Login password | Placeholder only (`%login_password%`) | Stagehand variables |
| Card number | **No** | Playwright CDP |
| Card CVV | **No** | Playwright CDP |
| Card expiry | **No** | Playwright CDP |

---

## Test Websites

### Tier 1 — Must Pass (Simple Checkout)

| Site | URL Pattern | Guest Checkout? | Key Challenges |
|------|-------------|-----------------|----------------|
| **Shopify store** | Any Shopify DTC brand | Yes | Baseline — simplest flow |
| **Target.com** | `target.com/p/...` | Yes | Multi-step checkout, address autocomplete |
| **Best Buy** | `bestbuy.com/site/...` | Yes | Electronics, warranty upsells |

### Tier 2 — Should Pass (Moderate Complexity)

| Site | URL Pattern | Guest Checkout? | Key Challenges |
|------|-------------|-----------------|----------------|
| **Walmart.com** | `walmart.com/ip/...` | Yes | Bot detection, dynamic forms |
| **Nike.com** | `nike.com/t/...` | Yes | Size selection, high demand items |
| **Etsy** | `etsy.com/listing/...` | Yes (partial) | Marketplace, seller variations |

### Tier 3 — Stretch Goals (Complex / Login Required)

| Site | URL Pattern | Guest Checkout? | Key Challenges |
|------|-------------|-----------------|----------------|
| **Amazon.com** | `amazon.com/dp/...` | No — login required | Aggressive bot detection, complex UI |
| **eBay** | `ebay.com/itm/...` | Partial | Auction vs Buy Now, seller variations |
| **Costco** | `costco.com/...` | No — membership required | Login + membership verification |
| **Apple Store** | `apple.com/shop/...` | Yes | Custom configuration flows |

### Test Products (Low-Value, Shippable)

Use cheap products to minimize cost during testing:

| Site | Product | ~Price | Why |
|------|---------|--------|-----|
| Shopify | Sticker pack or small accessory | $5-10 | Simplest checkout |
| Target | Basic household item (sponge, pen) | $3-8 | Standard retail flow |
| Best Buy | USB cable or phone case | $5-15 | Electronics path |
| Walmart | Basic grocery/household item | $3-8 | Walmart-specific flow |
| Amazon | Small accessory or book | $5-15 | Login-required path |

---

## Test Cases

### TC-01: Session Creation & Stealth

```
Verify:
[ ] Session creates with proxies, stealth, and CAPTCHA solving enabled
[ ] Session replay URL is accessible
[ ] Session destroys cleanly after test
[ ] No bot detection triggered on Target.com homepage
[ ] No bot detection triggered on Amazon.com homepage
[ ] CAPTCHA encountered → auto-solved by Browserbase
```

### TC-02: Navigation & Cart (Per Site)

```
For each Tier 1 site:
[ ] Navigate to product URL → page loads
[ ] Cookie banners dismissed automatically
[ ] Popups/modals closed
[ ] Product added to cart
[ ] Proceed to checkout succeeds
```

### TC-03: Guest Checkout Flow

```
For each site with guest checkout (Target, Best Buy, Walmart, Shopify):
[ ] Guest checkout option detected
[ ] Guest checkout selected
[ ] Shipping form loads
[ ] All shipping fields filled via %var% variables
[ ] Cheapest shipping option selected
[ ] Payment step reached
[ ] Express pay buttons ignored
[ ] Standard card payment selected
[ ] Card fields filled via CDP
[ ] Order total extracted correctly
[ ] Order submitted
[ ] Confirmation page detected
[ ] Order number extracted
```

### TC-04: Login Flow (Amazon, Costco)

```
For each login-required site:
[ ] Login requirement detected (no guest checkout option)
[ ] User prompted for credentials via API
[ ] Email/username filled via %login_email% variable
[ ] Password filled via %login_password% variable
[ ] LLM logs show ONLY placeholder names, never real values
[ ] Login succeeds
[ ] Redirected to checkout or homepage → navigate to checkout
[ ] Remainder of checkout proceeds as normal (TC-03 Phase 3+)
[ ] Credentials discarded after session destroy
```

### TC-05: Price Extraction Accuracy

```
For each test product:
[ ] Extracted price matches listed price on product page
[ ] Tax calculated (if shown before payment)
[ ] Shipping cost extracted
[ ] Order total matches expected (±5% or ±$1)
[ ] Price mismatch → order NOT submitted, error returned
```

### TC-06: Credential Security Audit

```
After every test run:
[ ] Stagehand LLM logs contain zero real card numbers
[ ] Stagehand LLM logs contain zero real passwords
[ ] Stagehand LLM logs show only %var% placeholders for all sensitive fields
[ ] Card fills appear only in CDP/Playwright logs
[ ] No credentials in API response bodies
[ ] No credentials written to disk (~/.proxo/)
[ ] No credentials in Browserbase session logs (verify via replay)
[ ] Login credentials not persisted after session destroy
```

### TC-07: Error Recovery

```
[ ] Product out of stock → detect and return meaningful error
[ ] Invalid product URL → PRICE_EXTRACTION_FAILED
[ ] Site down or unreachable → URL_UNREACHABLE
[ ] Checkout form validation error → retry or return error
[ ] Session timeout (>5 min) → session destroyed, error returned
[ ] CAPTCHA not solvable → error returned with replay URL
[ ] Price changed during checkout → PRICE_MISMATCH, order NOT submitted
[ ] Payment declined → detect decline message, return error
```

### TC-08: Express Pay Avoidance

```
For each site that shows express pay options:
[ ] Shop Pay button present → ignored
[ ] Google Pay button present → ignored
[ ] Apple Pay button present → ignored
[ ] PayPal button present → ignored
[ ] Amazon Pay button present → ignored
[ ] Standard card form found and selected instead
```

### TC-09: Address Autocomplete Handling

```
For sites with Google Places or similar autocomplete:
[ ] Address typed into field
[ ] Autocomplete dropdown appears → either select matching suggestion or continue typing
[ ] Full address successfully submitted
[ ] No address validation errors
```

### TC-10: Domain Cache (Repeat Visits)

```
[ ] First visit to site → domain cache created (~/.proxo/cache/{domain}.json)
[ ] Cache contains cookies (consent state, preferences)
[ ] Cache does NOT contain session tokens or auth cookies
[ ] Second visit → cache injected before navigation
[ ] Cookie banner not shown on second visit
[ ] Checkout flow still completes on second visit
```

---

## Iterative Test Loop

The test harness runs each site through the agnostic prompt and records results. Each iteration refines the prompt.

### Loop Structure

```
for each site in test_websites:
  1. Create Browserbase session (stealth + proxies + captcha solving)
  2. Initialize Stagehand + Playwright CDP
  3. Run agnostic checkout prompt
  4. Record result:
     - SUCCESS: confirmation number, total, time elapsed
     - FAILURE: step that failed, error message, replay URL
  5. Destroy session
  6. Log credential security audit results

After each round:
  - Review failures via Browserbase session replay
  - Identify which step failed and why
  - Adjust the agnostic prompt if needed (tighten act() instructions)
  - Re-run failed sites
  - Repeat until all Tier 1 sites pass consistently
```

### Result Tracking

Each test run produces a result record:

```typescript
interface TestResult {
  site: string;
  productUrl: string;
  timestamp: string;
  sessionId: string;
  replayUrl: string;
  result: "success" | "failure";
  failureStep?: string;        // e.g., "Phase 2 — Guest Checkout"
  failureReason?: string;      // e.g., "Could not find guest checkout option"
  confirmationNumber?: string;
  extractedTotal?: string;
  expectedTotal?: string;
  timeElapsedMs?: number;
  credentialAudit: {
    cardNumberExposed: boolean;
    passwordExposed: boolean;
    allPlaceholdersUsed: boolean;
  };
}
```

### Success Criteria

| Tier | Target | Definition |
|------|--------|-----------|
| Tier 1 | 100% pass rate | All 3 sites complete checkout on 3 consecutive runs |
| Tier 2 | 80% pass rate | At least 2 of 3 sites complete checkout |
| Tier 3 | Best effort | Any success is a bonus; document failures for v2 |

---

## Debugging Failures

When a test fails:

1. **Session replay** — `https://www.browserbase.com/sessions/{sessionId}` — watch the visual playback
2. **Identify the step** — which `act()` / `observe()` / `extract()` call failed?
3. **Common failure patterns**:

| Failure | Cause | Fix |
|---------|-------|-----|
| Clicked express pay | Stagehand chose wrong button | Tighten `act()` instruction: explicitly list buttons to ignore |
| Shipping form incomplete | Field not detected or wrong field filled | Use `observe()` first to list all fields, then fill individually |
| Bot detection blocked | Fingerprinting or behavioral detection | Verify stealth mode + proxies enabled, add delays between actions |
| CAPTCHA not solved | Browserbase solver failed | Check session logs, retry, report to Browserbase if persistent |
| Payment iframe inaccessible | Cross-origin iframe blocked CDP | Use Stagehand's built-in iframe handling, or locate iframe selector manually |
| Login failed | Credentials variable not substituted | Verify `%var%` syntax, check Stagehand version supports variables |
| Address autocomplete conflict | Typing interrupted by dropdown | Add explicit instruction to handle or dismiss autocomplete |
| Price mismatch | Tax or shipping changed | Widen tolerance or extract price after shipping selection |
| Out of stock | Product unavailable | Use a different test product |
| Session timeout | Checkout took > 5 min | Optimize steps, reduce waits, or increase timeout |

4. **Adjust prompt** — refine the agnostic prompt for the specific failure
5. **Re-run** — test the fix against the same site
6. **Document** — record what changed and why in this file

---

## Environment Variables

Required in `.env` for testing:

```bash
# Browserbase (upgraded account)
BROWSERBASE_API_KEY=...
BROWSERBASE_PROJECT_ID=...

# Stagehand LLM
ANTHROPIC_API_KEY=...

# Card credentials (for CDP fills — never seen by LLM)
CARD_NUMBER=4111111111111111
CARD_EXPIRY=12/28
CARD_CVV=123
CARDHOLDER_NAME=Test User

# Shipping (for Stagehand variables)
SHIPPING_FIRST_NAME=Test
SHIPPING_LAST_NAME=User
SHIPPING_STREET=123 Main St
SHIPPING_CITY=San Francisco
SHIPPING_STATE=CA
SHIPPING_ZIP=94102
SHIPPING_PHONE=4155551234
SHIPPING_EMAIL=test@example.com

# Login credentials (for sites requiring auth — used as Stagehand variables)
# These are set per-test, not permanently stored
# AMAZON_EMAIL=...
# AMAZON_PASSWORD=...
```

---

## Notes

- All tests use the upgraded Browserbase account — stealth mode, proxies, and CAPTCHA solving are always on
- Every session is fresh — no login state carries over between tests
- Card fields are ALWAYS filled via Playwright CDP, never through Stagehand
- Login credentials are ALWAYS passed as Stagehand `%var%` variables
- The agent orchestrating the checkout sees only placeholder names
- Session replay URLs are the primary debugging tool — use them before adjusting prompts
- Start with Tier 1 sites and don't move to Tier 2 until Tier 1 passes consistently
- Document every prompt adjustment and why it was needed

---

## Run Log

Living record of every test run. After each run, append a new entry below. Each entry captures what happened, what worked, what failed, and what to change for the next iteration.

### Template

Copy this template for each new run:

```
### Run #X — YYYY-MM-DD HH:MM

**Sites tested:** [list]
**Session IDs:** [list with replay URLs]
**Prompt version:** vX (describe changes from previous version)

#### Results

| Site | Result | Failed Step | Replay URL |
|------|--------|-------------|------------|
| ... | SUCCESS / FAILURE | — / Phase X | https://... |

#### Successes
- What worked well

#### Failures
- Site — what went wrong, which step, error message

#### Credential Audit
- [ ] LLM logs clean (no real card numbers)
- [ ] LLM logs clean (no real passwords)
- [ ] All sensitive fields used %var% placeholders

#### Prompt Changes for Next Run
- What to change in the agnostic prompt and why
- Specific act()/observe()/extract() instructions to tighten or loosen

#### Open Questions
- Anything unresolved that needs investigation
```

---

### Runs

_No runs recorded yet. First run will be logged below._
