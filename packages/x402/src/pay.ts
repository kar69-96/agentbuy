import { BloonError, ErrorCodes } from "@bloon/core";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

export interface X402PaymentResult {
  response: unknown;
  status: number;
  headers: Record<string, string>;
}

export async function payX402(
  url: string,
  privateKey: string,
): Promise<X402PaymentResult> {
  try {
    const signer = privateKeyToAccount(privateKey as `0x${string}`);

    const client = new x402Client();
    registerExactEvmScheme(client, { signer });

    const fetchWithPayment = wrapFetchWithPayment(fetch, client);
    const response = await fetchWithPayment(url, { method: "GET" });

    // Collect headers
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Parse body — try JSON, fall back to text
    let body: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    return { response: body, status: response.status, headers };
  } catch (error) {
    if (error instanceof BloonError) throw error;
    throw new BloonError(
      ErrorCodes.X402_PAYMENT_FAILED,
      error instanceof Error ? error.message : "x402 payment failed",
    );
  }
}
