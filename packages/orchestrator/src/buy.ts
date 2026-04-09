import {
  type Order,
  type ShippingInfo,
  BloonError,
  ErrorCodes,
  generateId,
  createOrder,
  calculateFee,
  calculateTotal,
  getDefaultShipping,
  loadConfig,
  getQueryResult,
} from "@bloon/core";
import { discoverPrice } from "@bloon/checkout";

export interface BuyInput {
  url?: string;
  query_id?: string;
  shipping?: ShippingInfo;
  selections?: Record<string, string>;
}

export async function buy(input: BuyInput): Promise<Order> {
  const { query_id } = input;

  // 1. Resolve product data — either from query cache or fresh discovery
  let productName: string;
  let price: string;
  let priceSource: string;
  let imageUrl: string | undefined;
  let originalPrice: string | undefined;
  let currency: string | undefined;
  let brand: string | undefined;
  let url: string;

  if (query_id) {
    // Look up cached query result
    const cached = getQueryResult(query_id);
    if (!cached) {
      throw new BloonError(
        ErrorCodes.QUERY_NOT_FOUND,
        `Query result not found: ${query_id}`,
      );
    }
    if (new Date(cached.expires_at) < new Date()) {
      throw new BloonError(
        ErrorCodes.QUERY_EXPIRED,
        `Query result expired: ${query_id}`,
      );
    }

    url = cached.product.url;
    productName = cached.product.name;
    price = cached.product.price;
    priceSource = cached.discovery_method;
    imageUrl = cached.product.image_url;
    originalPrice = cached.product.original_price;
    currency = cached.product.currency;
    brand = cached.product.brand;
  } else if (input.url) {
    url = input.url;

    // Validate URL
    try {
      new URL(url);
    } catch {
      throw new BloonError(ErrorCodes.INVALID_URL, `Invalid URL: ${url}`);
    }

    // Resolve shipping (needed for Tier 2 cart discovery)
    const resolvedShipping = input.shipping || getDefaultShipping();

    // Discover price from scratch
    let discovery;
    try {
      discovery = await discoverPrice(url, resolvedShipping ?? undefined);
    } catch (e) {
      if (e instanceof BloonError) throw e;
      throw new BloonError(
        ErrorCodes.PRICE_EXTRACTION_FAILED,
        `Price discovery failed for ${url}: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }

    productName = discovery.name;
    price = discovery.price;
    priceSource = discovery.method;
    imageUrl = discovery.image_url;
  } else {
    throw new BloonError(
      ErrorCodes.MISSING_FIELD,
      "url or query_id is required",
    );
  }

  // 2. Resolve shipping
  const resolvedShipping = input.shipping || getDefaultShipping();
  if (!resolvedShipping) {
    throw new BloonError(
      ErrorCodes.SHIPPING_REQUIRED,
      "Shipping address required for browser checkout (no defaults configured)",
    );
  }

  // Validate all required shipping fields are non-empty
  const shipping = resolvedShipping;
  const requiredShippingFields = ['name', 'street', 'city', 'state', 'zip', 'country', 'email', 'phone'] as const;
  const blankFields = requiredShippingFields.filter(f => !shipping[f]?.trim());
  if (blankFields.length > 0) {
    throw new BloonError(
      ErrorCodes.MISSING_FIELD,
      `Missing required fields: ${blankFields.map(f => `shipping.${f}`).join(', ')}`,
    );
  }

  // 3. Validate selections if provided
  if (input.selections) {
    for (const [key, value] of Object.entries(input.selections)) {
      if (typeof key !== 'string' || typeof value !== 'string' || !key.trim() || !value.trim()) {
        throw new BloonError(ErrorCodes.INVALID_SELECTION, 'Selections must have non-empty string keys and values');
      }
    }
  }

  // 4. Calculate fees
  const fee = calculateFee(price);
  const total = calculateTotal(price);

  // 5. Build order
  const config = loadConfig();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + config.default_order_expiry_seconds * 1000,
  );

  const order: Order = {
    order_id: generateId("ord"),
    status: "awaiting_confirmation",
    product: {
      name: productName,
      url,
      price,
      source: priceSource,
      image_url: imageUrl,
      original_price: originalPrice,
      currency,
      brand,
    },
    payment: {
      total,
      price,
      fee,
      fee_rate: "2%",
    },
    shipping: resolvedShipping,
    selections: input.selections,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  await createOrder(order);

  return order;
}
