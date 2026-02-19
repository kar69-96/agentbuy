import * as crypto from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  generateId,
  createWallet as storeCreateWallet,
  getNetwork,
} from "@proxo/core";
import type { Wallet } from "@proxo/core";

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

  await storeCreateWallet(wallet);
  return wallet;
}
