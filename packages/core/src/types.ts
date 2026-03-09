// ---- Network ----

export type Network = "base-sepolia" | "base";

// ---- Wallet ----

export interface Wallet {
  wallet_id: string;
  address: string;
  private_key: string;
  funding_token: string;
  network: Network;
  agent_name: string;
  created_at: string;
}

// ---- Order ----

export type OrderStatus =
  | "awaiting_confirmation"
  | "processing"
  | "completed"
  | "failed"
  | "expired";

export type PaymentRoute = "x402" | "browserbase";

export interface ProductInfo {
  name: string;
  url: string;
  price: string;
  source: string;
  image_url?: string;
}

export interface PaymentInfo {
  amount_usdc: string;
  price: string;
  fee: string;
  fee_rate: string;
  route: PaymentRoute;
}

export interface Order {
  order_id: string;
  wallet_id: string;
  status: OrderStatus;
  product: ProductInfo;
  payment: PaymentInfo;
  shipping?: ShippingInfo;
  selections?: Record<string, string>;
  tx_hash?: string;
  receipt?: Receipt;
  error?: OrderError;
  created_at: string;
  confirmed_at?: string;
  completed_at?: string;
  expires_at: string;
}

// ---- Receipt ----

export interface Receipt {
  product: string;
  merchant: string;
  route: PaymentRoute;
  price: string;
  fee: string;
  total_paid: string;
  tx_hash: string;
  timestamp: string;
  order_number?: string;
  estimated_delivery?: string;
  confirmation_email?: string;
  browserbase_session_id?: string;
  response?: Record<string, unknown>;
}

// ---- Shipping ----

export interface ShippingInfo {
  name: string;
  street: string;
  apartment?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  email: string;
  phone: string;
}

// ---- Product Discovery ----

export interface ProductOption {
  name: string; // e.g. "Color", "Size"
  values: string[]; // e.g. ["Red", "Blue", "Green"]
  prices?: Record<string, string>; // value → price, e.g. { "Size 10": "100.00" }
}

export interface RichProductInfo {
  name: string;
  url: string;
  price: string;
  original_price?: string;
  currency?: string;
  brand?: string;
  image_url?: string;
}

export interface RequiredField {
  field: string; // e.g. "shipping.email", "selections"
  label: string; // e.g. "Email address"
}

export interface QueryResponse {
  product: RichProductInfo;
  options: ProductOption[];
  required_fields: RequiredField[];
  route: PaymentRoute;
  discovery_method: string;
}

// ---- Search (NL query) ----

export interface SearchProductResult {
  product: RichProductInfo;
  options: ProductOption[];
  required_fields: RequiredField[];
  route: PaymentRoute;
  discovery_method: string;
  relevance_score: number;
}

export interface SearchQueryResponse {
  type: "search";
  query: string;
  products: SearchProductResult[];
  search_metadata: {
    total_found: number;
    domain_filter?: string[];
    price_filter?: { min?: number; max?: number };
  };
}

// ---- Card & Billing ----

export interface CardInfo {
  number: string;
  expiry: string;
  cvv: string;
  cardholder_name: string;
}

export interface BillingInfo {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

// ---- Credentials Map ----

export interface CredentialsMap {
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
  x_shipping_apartment: string;
  x_shipping_email: string;
  x_shipping_phone: string;
}

// ---- Order Error ----

export interface OrderError {
  code: string;
  message: string;
  tx_hash?: string;
  refund_status?: "pending_manual" | "refunded";
}

// ---- Domain Cache ----

export interface DomainCache {
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

// ---- Checkout Error Classification ----

export type CheckoutErrorCategory =
  | "bot_detected"
  | "form_fill_failed"
  | "payment_rejected"
  | "navigation_failed"
  | "captcha_unsolved"
  | "session_timeout"
  | "unknown";

// ---- x402 ----

export interface X402Requirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  resource?: string;
  description?: string;
}

// ---- Store Schemas ----

export interface WalletsStore {
  wallets: Wallet[];
}

export interface OrdersStore {
  orders: Order[];
}

export interface BloonConfig {
  master_wallet: {
    address: string;
    private_key: string;
  };
  network: Network;
  usdc_contract: string;
  max_transaction_amount: number;
  default_order_expiry_seconds: number;
  port: number;
}

// ---- Cost Tracking ----

export interface CostEntry {
  label: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  costUsd: number;
  durationMs: number;
}

export interface SessionCostEntry {
  sessionId: string;
  durationMs: number;
  costUsd: number;
}

export interface CostBreakdown {
  llmCalls: CostEntry[];
  sessions: SessionCostEntry[];
  totalInputTokens: number;
  totalOutputTokens: number;
  llmCostUsd: number;
  sessionCostUsd: number;
  totalCostUsd: number;
}

// ---- Error Codes ----

export const ErrorCodes = {
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  SHIPPING_REQUIRED: "SHIPPING_REQUIRED",
  PRICE_EXCEEDS_LIMIT: "PRICE_EXCEEDS_LIMIT",
  WALLET_NOT_FOUND: "WALLET_NOT_FOUND",
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  ORDER_EXPIRED: "ORDER_EXPIRED",
  URL_UNREACHABLE: "URL_UNREACHABLE",
  PRICE_EXTRACTION_FAILED: "PRICE_EXTRACTION_FAILED",
  TRANSFER_FAILED: "TRANSFER_FAILED",
  X402_PAYMENT_FAILED: "X402_PAYMENT_FAILED",
  CHECKOUT_FAILED: "CHECKOUT_FAILED",
  CHECKOUT_DECLINED: "CHECKOUT_DECLINED",
  MISSING_FIELD: "MISSING_FIELD",
  INVALID_URL: "INVALID_URL",
  ORDER_INVALID_STATUS: "ORDER_INVALID_STATUS",
  GAS_TRANSFER_FAILED: "GAS_TRANSFER_FAILED",
  INVALID_SELECTION: "INVALID_SELECTION",
  QUERY_FAILED: "QUERY_FAILED",
  SEARCH_NO_RESULTS: "SEARCH_NO_RESULTS",
  SEARCH_UNAVAILABLE: "SEARCH_UNAVAILABLE",
  SEARCH_RATE_LIMITED: "SEARCH_RATE_LIMITED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class BloonError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "BloonError";
    this.code = code;
  }
}
