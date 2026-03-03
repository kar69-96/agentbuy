import { Hono } from "hono";
import { BloonError, ErrorCodes } from "@bloon/core";
import { query } from "@bloon/orchestrator";
import { formatQueryResponse } from "../formatters.js";

export const queryRoutes = new Hono();

queryRoutes.post("/query", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.url || typeof body.url !== "string" || body.url.trim() === "") {
    throw new BloonError(ErrorCodes.MISSING_FIELD, "url is required");
  }
  const result = await query({ url: body.url.trim() });
  return c.json(formatQueryResponse(result));
});
