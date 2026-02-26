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
  city: string;
  state: string;
  zip: string;
  country: string;
  email: string;
  phone: string;
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

export interface ProxoConfig {
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
  MISSING_FIELD: "MISSING_FIELD",
  INVALID_URL: "INVALID_URL",
  ORDER_INVALID_STATUS: "ORDER_INVALID_STATUS",
  GAS_TRANSFER_FAILED: "GAS_TRANSFER_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class ProxoError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ProxoError";
    this.code = code;
  }
}
