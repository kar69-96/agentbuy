import * as crypto from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  generateId,
  createWallet as storeCreateWallet,
  getNetwork,
  loadConfig,
} from "@bloon/core";
import type { Wallet } from "@bloon/core";
import { sendGas } from "./gas.js";

export async function createWallet(agentName: string): Promise<Wallet> {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const wallet: Wallet = {
    wallet_id: generateId("w"),
    address: account.address,
    private_key: privateKey,
    funding_token: crypto.randomBytes(24).toString("base64url"),
    network: getNetwork(),
    agent_name: agentName,
    created_at: new Date().toISOString(),
  };

  // Send gas from master wallet before persisting — if this fails,
  // no wallet is saved (a wallet without gas is useless).
  const config = loadConfig();
  await sendGas(config.master_wallet.private_key, wallet.address);

  await storeCreateWallet(wallet);
  return wallet;
}
