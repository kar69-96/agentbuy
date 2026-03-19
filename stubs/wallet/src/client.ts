import { createPublicClient, http, type PublicClient } from "viem";
import { base, baseSepolia } from "viem/chains";
import { getNetwork, getRpcUrl } from "@bloon/core";
import type { Chain } from "viem";

export function getChain(): Chain {
  return getNetwork() === "base" ? base : baseSepolia;
}

let cachedClient: PublicClient | null = null;

export function getPublicClient(): PublicClient {
  if (!cachedClient) {
    cachedClient = createPublicClient({
      chain: getChain(),
      transport: http(getRpcUrl() || undefined),
    });
  }
  return cachedClient;
}
