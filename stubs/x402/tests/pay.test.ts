import { describe, it, expect } from "vitest";

// The funded test wallet from Phase 2
const TEST_PRIVATE_KEY = process.env.TEST_WALLET_PRIVATE_KEY;

describe.skipIf(!process.env.BASE_RPC_URL || !TEST_PRIVATE_KEY)(
  "payX402 (network)",
  () => {
    it("pays the PayAI echo merchant and gets a 200 response", async () => {
      const { payX402 } = await import("../src/pay.js");

      const result = await payX402(
        "https://x402.payai.network/api/base-sepolia/paid-content",
        TEST_PRIVATE_KEY!,
      );

      expect(result.status).toBe(200);
      expect(result.response).toBeTruthy();
    }, 60_000); // 60s timeout for on-chain operations
  },
);
