import dotenv from "dotenv";
import type {
  Network,
  CardInfo,
  BillingInfo,
  ShippingInfo,
  ProxoConfig,
} from "./types.js";
import { getConfig, saveConfig } from "./store.js";

dotenv.config();

// ---- USDC contracts ----

const USDC_CONTRACTS: Record<Network, string> = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

// ---- Typed accessors ----

export function getNetwork(): Network {
  return (process.env.NETWORK as Network) || "base-sepolia";
}

export function getUsdcContract(): string {
  return USDC_CONTRACTS[getNetwork()];
}

export function getPort(): number {
  return Number(process.env.PORT) || 3000;
}

export function getRpcUrl(): string {
  return process.env.BASE_RPC_URL || "";
}

// ---- Credential accessors ----

export function getCardInfo(): CardInfo {
  return {
    number: process.env.CARD_NUMBER || "",
    expiry: process.env.CARD_EXPIRY || "",
    cvv: process.env.CARD_CVV || "",
    cardholder_name: process.env.CARDHOLDER_NAME || "",
  };
}

export function getBillingInfo(): BillingInfo {
  return {
    street: process.env.BILLING_STREET || "",
    city: process.env.BILLING_CITY || "",
    state: process.env.BILLING_STATE || "",
    zip: process.env.BILLING_ZIP || "",
    country: process.env.BILLING_COUNTRY || "",
  };
}

export function getDefaultShipping(): ShippingInfo | undefined {
  if (!process.env.SHIPPING_NAME) return undefined;
  return {
    name: process.env.SHIPPING_NAME,
    street: process.env.SHIPPING_STREET || "",
    city: process.env.SHIPPING_CITY || "",
    state: process.env.SHIPPING_STATE || "",
    zip: process.env.SHIPPING_ZIP || "",
    country: process.env.SHIPPING_COUNTRY || "",
    email: process.env.SHIPPING_EMAIL || "",
    phone: process.env.SHIPPING_PHONE || "",
  };
}

// ---- CDP (Coinbase Onramp) accessors ----

export function getCdpProjectId(): string {
  return process.env.CDP_PROJECT_ID || "";
}

export function getCdpApiKeyId(): string {
  return process.env.CDP_API_KEY_ID || "";
}

export function getCdpApiKeySecret(): string {
  return process.env.CDP_API_KEY_SECRET || "";
}

// ---- Config management ----

export function loadOrCreateConfig(): ProxoConfig {
  const existing = getConfig();
  if (existing) return existing;

  const config: ProxoConfig = {
    master_wallet: {
      address: "",
      private_key: process.env.PROXO_MASTER_PRIVATE_KEY || "",
    },
    network: getNetwork(),
    usdc_contract: getUsdcContract(),
    max_transaction_amount: 25,
    default_order_expiry_seconds: 300,
    port: getPort(),
  };

  saveConfig(config);
  return config;
}
