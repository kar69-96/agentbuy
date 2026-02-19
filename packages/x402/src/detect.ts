import { type PaymentRoute, type X402Requirements, ProxoError, ErrorCodes } from "@proxo/core";
import { getNetwork } from "@proxo/core";

export interface DetectResult {
  route: PaymentRoute;
  requirements?: X402Requirements;
}

const CHAIN_IDS: Record<string, string> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

export async function detectRoute(url: string): Promise<DetectResult> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new ProxoError(ErrorCodes.URL_UNREACHABLE, `Cannot reach ${url}`);
  }

  if (response.status !== 402) {
    return { route: "browserbase" };
  }

  // Parse x402 v2 response format
  try {
    const body = await response.json();
    const accepts: unknown[] = body.accepts ?? body.x402?.accepts ?? [];
    const network = getNetwork();
    const chainId = CHAIN_IDS[network];

    for (const entry of accepts) {
      const e = entry as Record<string, unknown>;
      if (e.network === chainId) {
        const requirements: X402Requirements = {
          scheme: String(e.scheme ?? "exact"),
          network: String(e.network),
          maxAmountRequired: String(e.maxAmountRequired),
          payTo: String(e.payTo),
          asset: String(e.asset ?? ""),
          resource: e.resource != null ? String(e.resource) : undefined,
          description: e.description != null ? String(e.description) : undefined,
        };
        return { route: "x402", requirements };
      }
    }

    // No matching network found — fallback
    return { route: "browserbase" };
  } catch {
    // Could not parse x402 body — fallback
    return { route: "browserbase" };
  }
}
