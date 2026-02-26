import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ProxoError, ErrorCodes, getRpcUrl } from "@proxo/core";
import { getChain, getPublicClient } from "./client.js";

/** ETH to auto-send to each new agent wallet (~$0.025, covers ~25 Base txs) */
export const AUTO_GAS_ETH = "0.00001";

export interface GasResult {
  tx_hash: string;
  amount: string;
}

export async function sendGas(
  masterPrivateKey: string,
  toAddress: string,
): Promise<GasResult> {
  try {
    const account = privateKeyToAccount(masterPrivateKey as `0x${string}`);
    const chain = getChain();

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(getRpcUrl() || undefined),
    });

    const hash = await walletClient.sendTransaction({
      to: toAddress as `0x${string}`,
      value: parseEther(AUTO_GAS_ETH),
    });

    const publicClient = getPublicClient();
    await publicClient.waitForTransactionReceipt({ hash });

    return { tx_hash: hash, amount: AUTO_GAS_ETH };
  } catch (error) {
    if (error instanceof ProxoError) throw error;
    throw new ProxoError(
      ErrorCodes.GAS_TRANSFER_FAILED,
      `Failed to send gas to new wallet: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
