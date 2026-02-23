import { Hono } from "hono";
import { ProxoError, ErrorCodes, getWallet } from "@proxo/core";
import { buy } from "@proxo/orchestrator";
import { getBalance } from "@proxo/wallet";
import { formatBuyResponse } from "../formatters.js";

export const buyRoutes = new Hono();

// POST /api/buy — get purchase quote
buyRoutes.post("/buy", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  if (!body.url || typeof body.url !== "string" || body.url.trim() === "") {
    throw new ProxoError(ErrorCodes.MISSING_FIELD, "url is required");
  }

  if (
    !body.wallet_id ||
    typeof body.wallet_id !== "string" ||
    body.wallet_id.trim() === ""
  ) {
    throw new ProxoError(ErrorCodes.MISSING_FIELD, "wallet_id is required");
  }

  const order = await buy({
    url: body.url.trim(),
    wallet_id: body.wallet_id.trim(),
    shipping: body.shipping,
  });

  const wallet = getWallet(order.wallet_id)!;
  const balance = await getBalance(wallet.address);

  return c.json(formatBuyResponse(order, balance));
});
