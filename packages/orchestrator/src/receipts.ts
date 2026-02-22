import type { Order, Receipt } from "@proxo/core";
import type { X402PaymentResult } from "@proxo/x402";
import type { CheckoutResult } from "@proxo/checkout";

export interface ReceiptInput {
  order: Order;
  tx_hash: string;
  x402Result?: X402PaymentResult;
  checkoutResult?: CheckoutResult;
}

export function buildReceipt(input: ReceiptInput): Receipt {
  const { order, tx_hash, x402Result, checkoutResult } = input;

  const receipt: Receipt = {
    product: order.product.name,
    merchant: new URL(order.product.url).hostname,
    route: order.payment.route,
    price: order.payment.price,
    fee: order.payment.fee,
    total_paid: order.payment.amount_usdc,
    tx_hash,
    timestamp: new Date().toISOString(),
  };

  if (order.payment.route === "x402" && x402Result) {
    receipt.response = x402Result.response as Record<string, unknown> | undefined;
  }

  if (order.payment.route === "browserbase" && checkoutResult) {
    receipt.order_number = checkoutResult.orderNumber;
    receipt.browserbase_session_id = checkoutResult.sessionId;
  }

  return receipt;
}
