import { Hono } from "hono";
import { ProxoError, ErrorCodes, getOrder } from "@proxo/core";
import { confirm } from "@proxo/orchestrator";
import {
  formatConfirmResponse,
  formatConfirmFailedResponse,
} from "../formatters.js";

export const confirmRoutes = new Hono();

// POST /api/confirm — execute purchase
confirmRoutes.post("/confirm", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  if (
    !body.order_id ||
    typeof body.order_id !== "string" ||
    body.order_id.trim() === ""
  ) {
    throw new ProxoError(ErrorCodes.MISSING_FIELD, "order_id is required");
  }

  try {
    const result = await confirm({ order_id: body.order_id.trim() });
    return c.json(formatConfirmResponse(result.order, result.receipt));
  } catch (err) {
    // For CHECKOUT_FAILED / X402_PAYMENT_FAILED with tx_hash,
    // return 200 with failed order details per spec
    if (
      err instanceof ProxoError &&
      (err.code === ErrorCodes.CHECKOUT_FAILED ||
        err.code === ErrorCodes.X402_PAYMENT_FAILED)
    ) {
      const order = getOrder(body.order_id.trim());
      if (order?.error?.tx_hash) {
        return c.json(formatConfirmFailedResponse(order));
      }
    }
    throw err;
  }
});
