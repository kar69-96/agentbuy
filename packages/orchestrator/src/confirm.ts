import {
  type Order,
  type Receipt,
  ProxoError,
  ErrorCodes,
  getOrder,
  getWallet,
  updateOrder,
  loadOrCreateConfig,
} from "@proxo/core";
import { transferUSDC } from "@proxo/wallet";
import { payX402 } from "@proxo/x402";
import { runCheckout } from "@proxo/checkout";
import { buildReceipt } from "./receipts.js";

export interface ConfirmInput {
  order_id: string;
}

export interface ConfirmResult {
  order: Order;
  receipt: Receipt;
}

export async function confirm(input: ConfirmInput): Promise<ConfirmResult> {
  const { order_id } = input;

  // 1. Look up order
  const order = getOrder(order_id);
  if (!order) {
    throw new ProxoError(
      ErrorCodes.ORDER_NOT_FOUND,
      `Order not found: ${order_id}`,
    );
  }

  // 2. Already completed — return existing receipt
  if (order.status === "completed" && order.receipt) {
    return { order, receipt: order.receipt };
  }

  // 3. Must be awaiting confirmation
  if (order.status !== "awaiting_confirmation") {
    throw new ProxoError(
      ErrorCodes.ORDER_NOT_FOUND,
      `Order ${order_id} is in status "${order.status}", expected "awaiting_confirmation"`,
    );
  }

  // 4. Expiry check
  if (new Date(order.expires_at) < new Date()) {
    await updateOrder(order_id, { status: "expired" });
    throw new ProxoError(
      ErrorCodes.ORDER_EXPIRED,
      `Order ${order_id} has expired`,
    );
  }

  // 5. Update to processing
  await updateOrder(order_id, { status: "processing" });

  // 6. Load wallet and config
  const wallet = getWallet(order.wallet_id);
  if (!wallet) {
    throw new ProxoError(
      ErrorCodes.WALLET_NOT_FOUND,
      `Wallet not found: ${order.wallet_id}`,
    );
  }

  const config = loadOrCreateConfig();
  const masterAddress = config.master_wallet.address;

  let txHash: string;

  try {
    if (order.payment.route === "x402") {
      // x402: transfer FEE to master, then pay service directly
      const feeTransfer = await transferUSDC(
        wallet.private_key,
        masterAddress,
        order.payment.fee,
      );
      txHash = feeTransfer.tx_hash;

      // Save tx_hash immediately
      await updateOrder(order_id, { tx_hash: txHash });

      // Pay the service from agent wallet
      const x402Result = await payX402(order.product.url, wallet.private_key);

      // Build receipt
      const receipt = buildReceipt({
        order,
        tx_hash: txHash,
        x402Result,
      });

      await updateOrder(order_id, {
        status: "completed",
        receipt,
        confirmed_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      return { order: { ...order, status: "completed", receipt }, receipt };
    } else {
      // Browserbase: transfer FULL amount to master
      const fullTransfer = await transferUSDC(
        wallet.private_key,
        masterAddress,
        order.payment.amount_usdc,
      );
      txHash = fullTransfer.tx_hash;

      // Save tx_hash immediately
      await updateOrder(order_id, { tx_hash: txHash });

      // Run browser checkout
      if (!order.shipping) {
        throw new ProxoError(
          ErrorCodes.SHIPPING_REQUIRED,
          "Shipping info missing on order for browser checkout",
        );
      }

      const checkoutResult = await runCheckout({
        order,
        shipping: order.shipping,
      });

      if (!checkoutResult.success) {
        throw new Error("Checkout did not confirm");
      }

      // Build receipt
      const receipt = buildReceipt({
        order,
        tx_hash: txHash,
        checkoutResult,
      });

      await updateOrder(order_id, {
        status: "completed",
        receipt,
        confirmed_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      return { order: { ...order, status: "completed", receipt }, receipt };
    }
  } catch (error) {
    // If USDC was already sent but execution failed
    const errorMessage =
      error instanceof Error ? error.message : "Execution failed";
    const errorCode =
      order.payment.route === "x402"
        ? ErrorCodes.X402_PAYMENT_FAILED
        : ErrorCodes.CHECKOUT_FAILED;

    await updateOrder(order_id, {
      status: "failed",
      error: {
        code: errorCode,
        message: errorMessage,
        tx_hash: txHash!,
        refund_status: "pending_manual",
      },
    });

    if (error instanceof ProxoError) throw error;
    throw new ProxoError(errorCode, errorMessage);
  }
}
