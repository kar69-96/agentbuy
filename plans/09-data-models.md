# Data Models — TypeScript Interfaces

All types live in `packages/core/src/types.ts`.

## Wallet

```typescript
interface Wallet {
  wallet_id: string;              // "bloon_w_7k2m9x"
  address: string;                // "0x..." Base address
  private_key: string;            // "0x..." viem private key (never exposed)
  funding_token: string;          // random token for /fund/:token page
  network: "base-sepolia" | "base";
  agent_name: string;
  created_at: string;             // ISO 8601
}
```

## Order

```typescript
type OrderStatus =
  | "awaiting_confirmation"
  | "processing"
  | "completed"
  | "failed"
  | "expired";

type PaymentRoute = "x402" | "browserbase";

interface Order {
  order_id: string;
  wallet_id: string;
  status: OrderStatus;

  product: {
    name: string;
    url: string;
    price: string;                // e.g., "17.99"
    source: string;               // e.g., "amazon.com"
    image_url?: string;
  };

  payment: {
    amount_usdc: string;
    price: string;
    fee: string;
    fee_rate: string;             // "2%"
    route: PaymentRoute;
  };

  shipping?: ShippingInfo;

  tx_hash?: string;
  receipt?: Receipt;
  error?: OrderError;

  created_at: string;
  confirmed_at?: string;
  completed_at?: string;
  expires_at: string;             // created_at + 5 min
}
```

## Receipt

```typescript
interface Receipt {
  product: string;
  merchant: string;
  route: PaymentRoute;
  price: string;
  fee: string;
  total_paid: string;
  tx_hash: string;
  timestamp: string;

  // Browser checkout
  order_number?: string;
  estimated_delivery?: string;
  confirmation_email?: string;
  browserbase_session_id?: string;

  // x402
  response?: Record<string, unknown>;
}
```

## Query Response

Returned by `POST /api/query` — product discovery before purchasing.

```typescript
interface QueryResponse {
  product: RichProductInfo;
  options: ProductOption[];
  required_fields: RequiredField[];
  route: "x402" | "browserbase";
  discovery_method: "x402" | "firecrawl" | "scrape" | "browserbase";
}

interface RichProductInfo {
  name: string;
  url: string;
  price: string;                // e.g., "29.99"
  image_url?: string;
  original_price?: string;      // before discount
  currency?: string;            // "USD", "EUR"
  brand?: string;
}

interface ProductOption {
  name: string;                 // "Color", "Size", etc.
  values: string[];             // ["Red", "Blue", "Green"]
  prices?: Record<string, string>;  // { "Red": "29.99", "Blue": "34.99" }
}

interface RequiredField {
  field: string;                // "shipping.name", "selections"
  label: string;                // "Full name", "Product options (Color, Size)"
}
```

## Shipping Info

```typescript
interface ShippingInfo {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  email: string;
  phone: string;
}
```

## Card Info (from .env, never in store)

```typescript
interface CardInfo {
  number: string;
  expiry: string;                 // "MM/YY"
  cvv: string;
  cardholder_name: string;
}
```

## Billing Info (from .env)

```typescript
interface BillingInfo {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}
```

## Credentials Map (for Stagehand variables + CDP fills)

```typescript
interface CredentialsMap {
  x_card_number: string;
  x_card_expiry: string;
  x_card_cvv: string;
  x_cardholder_name: string;
  x_billing_street: string;
  x_billing_city: string;
  x_billing_state: string;
  x_billing_zip: string;
  x_billing_country: string;
  x_shipping_name: string;
  x_shipping_street: string;
  x_shipping_city: string;
  x_shipping_state: string;
  x_shipping_zip: string;
  x_shipping_country: string;
  x_shipping_email: string;
  x_shipping_phone: string;
}
```

## Order Error

```typescript
interface OrderError {
  code: string;
  message: string;
  tx_hash?: string;
  refund_status?: "pending_manual" | "refunded";
}
```

## Domain Cache

```typescript
interface DomainCache {
  domain: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
  }>;
  localStorage?: Record<string, string>;
  updated_at: string;
}
```

## Discovery Pipeline Types

Types used by the product discovery pipeline in `packages/crawling/` and `packages/checkout/`.

### Full Discovery Result

Returned by `discoverViaFirecrawl()` in `packages/crawling/src/discover.ts`.

```typescript
interface FullDiscoveryResult {
  name: string;
  price: string;
  image_url?: string;
  method: string;                     // "firecrawl" | "browserbase"
  options: ProductOption[];
  original_price?: string;
  currency?: string;
  description?: string;
  brand?: string;
  error?: string;                     // "product_not_found" if page is 404/discontinued
  // Diagnostics (internal test/benchmark harnesses)
  failure_code?: DiscoveryFailureCode;
  failure_stage?: string;
  failure_detail?: string;
}
```

### Failure Codes

```typescript
// Firecrawl extraction failures (packages/crawling/src/extract.ts)
type FirecrawlFailureCode =
  | "blocked"           // Anti-bot/CAPTCHA detected
  | "not_found"         // Product page is 404/discontinued
  | "extract_empty"     // Extraction returned no usable data
  | "http_error"        // Non-2xx HTTP response
  | "transport_error";  // Network/fetch failure

// Browserbase fallback failures (packages/crawling/src/browserbase-extract.ts)
type BrowserbaseFailureCode =
  | "blocked"           // Anti-bot still present after rendering
  | "not_found"         // Product not found after rendering
  | "render_timeout"    // Page render timed out
  | "adapter_502"       // Browserbase adapter returned 502
  | "extract_empty"     // Gemini returned no name/price
  | "transport_error";  // Network failure

// Top-level discovery pipeline failures (packages/crawling/src/discover.ts)
type DiscoveryFailureCode =
  | "llm_config"        // Missing FIRECRAWL_API_KEY
  | "blocked"
  | "not_found"
  | "adapter_502"
  | "render_timeout"
  | "http_error"
  | "extract_empty"
  | "transport_error";
```

### Discovery Diagnostics

```typescript
interface DiscoveryDiagnostics {
  failureCode?: DiscoveryFailureCode;
  failureStage?: string;
  failureDetail?: string;
  method?: "firecrawl" | "browserbase";
  timings?: {
    totalMs: number;
    firecrawlMs: number;
    firecrawlAttempts: number;
    browserbaseMs: number;
    variantMs: number;
  };
}
```

### Parser Ensemble (Candidate Ranking)

```typescript
// Input to the ranking system (packages/crawling/src/parser-ensemble.ts)
interface CandidateInput {
  source: string;                     // "firecrawl" | "browserbase"
  extract: FirecrawlExtract | null | undefined;
}

// Scored candidate
interface RankedCandidate {
  source: string;
  extract: FirecrawlExtract;
  confidence: number;                 // 0.0 - 1.0
  reasons: string[];                  // Which signals contributed
}
```

### Provider Abstraction

```typescript
// Pluggable extraction providers (packages/crawling/src/providers.ts)
interface QueryDiscoveryProviders {
  firecrawlExtract: (url: string, config: FirecrawlConfig, timeoutMs: number)
    => Promise<FirecrawlExtract | null>;
  browserbaseExtract: (url: string, timeoutMs: number)
    => Promise<FirecrawlExtract | null>;
}
```

### Error Classes

```typescript
// packages/crawling/src/constants.ts
class ProductNotFoundError extends Error {}   // Page is 404/discontinued
class ProductBlockedError extends Error {}    // Anti-bot/CAPTCHA blocked
```

### Checkout Discovery Types

```typescript
// packages/checkout/src/discover.ts
interface DiscoveryResult {
  name: string;
  price: string;
  tax?: string;
  shipping?: string;
  total?: string;
  method: "scrape" | "browserbase_cart";
  image_url?: string;
}

interface DiscoveryResultWithOptions extends DiscoveryResult {
  options: ProductOption[];
}
```

## x402 Payment Requirements

```typescript
interface X402Requirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  resource?: string;
  description?: string;
}
```

## Store Schemas

```typescript
// ~/.bloon/wallets.json
interface WalletsStore {
  wallets: Wallet[];
}

// ~/.bloon/orders.json
interface OrdersStore {
  orders: Order[];
}

// ~/.bloon/config.json
interface BloonConfig {
  master_wallet: {
    address: string;
    private_key: string;
  };
  network: "base-sepolia" | "base";
  usdc_contract: string;
  max_transaction_amount: number; // 25
  default_order_expiry_seconds: number; // 300
  port: number; // 3000
}
```
