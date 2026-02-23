import type { Wallet, Order, Receipt } from "@proxo/core";
import { getOrdersByWallet } from "@proxo/core";

export function formatWalletCreateResponse(
  wallet: Wallet,
  balance: string,
  baseUrl: string,
) {
  return {
    wallet_id: wallet.wallet_id,
    address: wallet.address,
    network: wallet.network,
    agent_name: wallet.agent_name,
    balance_usdc: balance,
    funding_url: `${baseUrl}/fund/${wallet.funding_token}`,
    created_at: wallet.created_at,
  };
}

export function formatWalletGetResponse(
  wallet: Wallet,
  balance: string,
  baseUrl: string,
) {
  const orders = getOrdersByWallet(wallet.wallet_id);
  const transactions = orders.map((o) => ({
    type: "purchase" as const,
    order_id: o.order_id,
    product: o.product.name,
    merchant: new URL(o.product.url).hostname,
    route: o.payment.route,
    price: o.payment.price,
    fee: o.payment.fee,
    total: o.payment.amount_usdc,
    status: o.status,
    timestamp: o.completed_at || o.confirmed_at || o.created_at,
  }));

  return {
    wallet_id: wallet.wallet_id,
    address: wallet.address,
    network: wallet.network,
    agent_name: wallet.agent_name,
    balance_usdc: balance,
    created_at: wallet.created_at,
    transactions,
  };
}

export function formatBuyResponse(order: Order, balance: string) {
  const expiresIn = Math.max(
    0,
    Math.floor((new Date(order.expires_at).getTime() - Date.now()) / 1000),
  );

  return {
    order_id: order.order_id,
    product: {
      name: order.product.name,
      url: order.product.url,
      source: new URL(order.product.url).hostname,
    },
    payment: {
      item_price: order.payment.price,
      fee: order.payment.fee,
      fee_rate: order.payment.fee_rate,
      total: order.payment.amount_usdc,
      route: order.payment.route,
      discovery_method: order.product.source,
      wallet_id: order.wallet_id,
      wallet_balance: balance,
    },
    status: order.status,
    expires_in: expiresIn,
  };
}

export function formatConfirmResponse(order: Order, receipt: Receipt) {
  return {
    order_id: order.order_id,
    status: "completed" as const,
    receipt,
  };
}

export function formatConfirmFailedResponse(order: Order) {
  return {
    order_id: order.order_id,
    status: "failed" as const,
    error: order.error,
  };
}
