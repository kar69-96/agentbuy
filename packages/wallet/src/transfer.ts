import { createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getUsdcContract, getRpcUrl, ProxoError, ErrorCodes } from "@proxo/core";
import { getChain, getPublicClient } from "./client.js";
import { USDC_ABI } from "./usdc-abi.js";
import { getBalance } from "./balance.js";

export interface TransferResult {
  tx_hash: string;
  from: string;
  to: string;
  amount: string;
}

export async function transferUSDC(
  fromPrivateKey: string,
  toAddress: string,
  amount: string,
): Promise<TransferResult> {
  try {
    const account = privateKeyToAccount(fromPrivateKey as `0x${string}`);

    const balance = await getBalance(account.address);
    if (parseFloat(balance) < parseFloat(amount)) {
      throw new ProxoError(
        ErrorCodes.TRANSFER_FAILED,
        `Insufficient balance: have ${balance} USDC, need ${amount} USDC`,
      );
    }

    const chain = getChain();
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(getRpcUrl() || undefined),
    });

    const usdcAddress = getUsdcContract() as `0x${string}`;
    const parsedAmount = parseUnits(amount, 6);

    const hash = await walletClient.writeContract({
      address: usdcAddress,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [toAddress as `0x${string}`, parsedAmount],
    });

    const publicClient = getPublicClient();
    await publicClient.waitForTransactionReceipt({ hash });

    return {
      tx_hash: hash,
      from: account.address,
      to: toAddress,
      amount,
    };
  } catch (error) {
    if (error instanceof ProxoError) throw error;
    throw new ProxoError(
      ErrorCodes.TRANSFER_FAILED,
      error instanceof Error ? error.message : "Transfer failed",
    );
  }
}
