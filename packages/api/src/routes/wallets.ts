import { Hono } from "hono";
import { ProxoError, ErrorCodes, getWallet } from "@proxo/core";
import { createWallet, getBalance } from "@proxo/wallet";
import {
  formatWalletCreateResponse,
  formatWalletGetResponse,
} from "../formatters.js";

export const walletsRoutes = new Hono();

// POST /api/wallets — create wallet
walletsRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const agentName = body.agent_name;

  if (!agentName || typeof agentName !== "string" || agentName.trim() === "") {
    throw new ProxoError(
      ErrorCodes.MISSING_FIELD,
      "agent_name is required",
    );
  }

  const wallet = await createWallet(agentName.trim());
  const balance = await getBalance(wallet.address);
  const baseUrl = new URL(c.req.url).origin;

  return c.json(formatWalletCreateResponse(wallet, balance, baseUrl), 201);
});

// GET /api/wallets/:wallet_id — wallet details + transactions
walletsRoutes.get("/:wallet_id", async (c) => {
  const walletId = c.req.param("wallet_id");
  const wallet = getWallet(walletId);

  if (!wallet) {
    throw new ProxoError(
      ErrorCodes.WALLET_NOT_FOUND,
      `Wallet not found: ${walletId}`,
    );
  }

  const balance = await getBalance(wallet.address);
  const baseUrl = new URL(c.req.url).origin;

  return c.json(formatWalletGetResponse(wallet, balance, baseUrl));
});
