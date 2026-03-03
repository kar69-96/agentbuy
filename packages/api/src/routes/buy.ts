import { Hono } from "hono";
import { BloonError, ErrorCodes, getWallet } from "@bloon/core";
import { buy } from "@bloon/orchestrator";
import { getBalance } from "@bloon/wallet";
import { formatBuyResponse } from "../formatters.js";

export const buyRoutes = new Hono();

// POST /api/buy — get purchase quote
buyRoutes.post("/buy", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  if (!body.url || typeof body.url !== "string" || body.url.trim() === "") {
    throw new BloonError(ErrorCodes.MISSING_FIELD, "url is required");
  }

  if (
    !body.wallet_id ||
    typeof body.wallet_id !== "string" ||
    body.wallet_id.trim() === ""
  ) {
    throw new BloonError(ErrorCodes.MISSING_FIELD, "wallet_id is required");
  }

  const order = await buy({
    url: body.url.trim(),
    wallet_id: body.wallet_id.trim(),
    shipping: body.shipping,
    selections: body.selections,
  });

  const wallet = getWallet(order.wallet_id)!;
  const balance = await getBalance(wallet.address);

  return c.json(formatBuyResponse(order, balance));
});
