import { Hono } from "hono";
import { BloonError, ErrorCodes } from "@bloon/core";
import { buy } from "@bloon/orchestrator";
import { formatBuyResponse } from "../formatters.js";

export const buyRoutes = new Hono();

// POST /api/buy — get purchase quote
buyRoutes.post("/buy", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const hasUrl = body.url && typeof body.url === "string" && body.url.trim() !== "";
  const hasQueryId = body.query_id && typeof body.query_id === "string";

  if (!hasUrl && !hasQueryId) {
    throw new BloonError(ErrorCodes.MISSING_FIELD, "url or query_id is required");
  }

  const order = await buy({
    url: hasUrl ? body.url.trim() : undefined,
    query_id: hasQueryId ? body.query_id : undefined,
    shipping: body.shipping,
    selections: body.selections,
  });

  return c.json(formatBuyResponse(order));
});
