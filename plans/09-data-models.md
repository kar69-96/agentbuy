# Data Models — TypeScript Interfaces

All types live in `packages/core/src/types.ts`.

## Wallet

```typescript
interface Wallet {
  wallet_id: string;              // "proxo_w_7k2m9x"
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
    fee_rate: string;             // "0.5%" or "5%"
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
// ~/.proxo/wallets.json
interface WalletsStore {
  wallets: Wallet[];
}

// ~/.proxo/orders.json
interface OrdersStore {
  orders: Order[];
}

// ~/.proxo/config.json
interface ProxoConfig {
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
