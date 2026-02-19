import { formatUnits } from "viem";
import { getUsdcContract } from "@proxo/core";
import { getPublicClient } from "./client.js";
import { USDC_ABI } from "./usdc-abi.js";

export function formatUsdc(raw: bigint): string {
  const str = formatUnits(raw, 6);
  const dot = str.indexOf(".");
  if (dot === -1) return str + ".00";
  const decimals = str.length - dot - 1;
  if (decimals < 2) return str + "0".repeat(2 - decimals);
  return str;
}

export async function getBalance(address: string): Promise<string> {
  const client = getPublicClient();
  const raw = await client.readContract({
    address: getUsdcContract() as `0x${string}`,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
  return formatUsdc(raw);
}
