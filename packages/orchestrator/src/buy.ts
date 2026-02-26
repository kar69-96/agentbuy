import {
  type Order,
  type ShippingInfo,
  ProxoError,
  ErrorCodes,
  getWallet,
  generateId,
  createOrder,
  calculateFee,
  calculateTotal,
  getDefaultShipping,
  loadConfig,
} from "@proxo/core";
import { getBalance } from "@proxo/wallet";
import { discoverPrice } from "@proxo/checkout";
import { routeOrder } from "./router.js";

export interface BuyInput {
  url: string;
  wallet_id: string;
  shipping?: ShippingInfo;
  /** Caller-supplied price — skips price discovery when provided. */
  price?: string;
}

export async function buy(input: BuyInput): Promise<Order> {
  const { url, wallet_id } = input;

  // 1. Validate URL
  try {
    new URL(url);
  } catch {
    throw new ProxoError(ErrorCodes.INVALID_URL, `Invalid URL: ${url}`);
  }

  // 2. Look up wallet
  const wallet = getWallet(wallet_id);
  if (!wallet) {
    throw new ProxoError(
      ErrorCodes.WALLET_NOT_FOUND,
      `Wallet not found: ${wallet_id}`,
    );
  }

  // 3. Route detection
  const decision = await routeOrder(url);

  let productName: string;
  let price: string;
  let priceSource: string;
  let imageUrl: string | undefined;
  let resolvedShipping: ShippingInfo | undefined;

  if (decision.route === "x402") {
    // 4a. x402: price from requirements
    if (!decision.requirements) {
      throw new ProxoError(
        ErrorCodes.PRICE_EXTRACTION_FAILED,
        "x402 route detected but no payment requirements found",
      );
    }
    price = decision.requirements.maxAmountRequired;
    productName = decision.requirements.description || new URL(url).hostname;
    priceSource = "x402";
    // No shipping needed for x402
  } else {
    // 4b. Browserbase: resolve shipping, discover price
    resolvedShipping = input.shipping || getDefaultShipping();
    if (!resolvedShipping) {
      throw new ProxoError(
        ErrorCodes.SHIPPING_REQUIRED,
        "Shipping address required for browser checkout (no defaults configured)",
      );
    }

    if (input.price) {
      // Caller-supplied price — skip discovery
      price = input.price;
      productName = new URL(url).hostname;
      priceSource = "caller";
    } else {
      let discovery;
      try {
        discovery = await discoverPrice(url, resolvedShipping);
      } catch (e) {
        if (e instanceof ProxoError) throw e;
        throw new ProxoError(
          ErrorCodes.PRICE_EXTRACTION_FAILED,
          `Price discovery failed for ${url}: ${e instanceof Error ? e.message : "unknown error"}`,
        );
      }
      productName = discovery.name;
      price = discovery.price;
      priceSource = discovery.method;
      imageUrl = discovery.image_url;
    }
  }

  // 5. Calculate fees (also enforces $25 max)
  const fee = calculateFee(price, decision.route);
  const total = calculateTotal(price, decision.route);

  // 6. Balance check
  const balance = await getBalance(wallet.address);
  if (parseFloat(balance) < parseFloat(total)) {
    throw new ProxoError(
      ErrorCodes.INSUFFICIENT_BALANCE,
      `Insufficient balance: have ${balance} USDC, need ${total} USDC`,
    );
  }

  // 7. Build order
  const config = loadConfig();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + config.default_order_expiry_seconds * 1000,
  );

  const order: Order = {
    order_id: generateId("ord"),
    wallet_id,
    status: "awaiting_confirmation",
    product: {
      name: productName,
      url,
      price,
      source: priceSource,
      image_url: imageUrl,
    },
    payment: {
      amount_usdc: total,
      price,
      fee,
      fee_rate: decision.route === "x402" ? "0.5%" : "5%",
      route: decision.route,
    },
    shipping: resolvedShipping,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  await createOrder(order);

  return order;
}
