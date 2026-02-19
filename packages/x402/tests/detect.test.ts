import { describe, it, expect } from "vitest";
import { isAddress } from "viem";

// ---- Offline tests (always run) ----

describe("detectRoute (offline)", () => {
  it("returns browserbase for a normal 200 URL", async () => {
    const { detectRoute } = await import("../src/detect.js");
    const result = await detectRoute("https://example.com");
    expect(result.route).toBe("browserbase");
    expect(result.requirements).toBeUndefined();
  });

  it("throws URL_UNREACHABLE for an unreachable domain", async () => {
    const { detectRoute } = await import("../src/detect.js");
    const { ProxoError, ErrorCodes } = await import("@proxo/core");

    await expect(
      detectRoute("https://nonexistent.invalid"),
    ).rejects.toThrow(ProxoError);

    try {
      await detectRoute("https://nonexistent.invalid");
    } catch (error) {
      expect(error).toBeInstanceOf(ProxoError);
      expect((error as InstanceType<typeof ProxoError>).code).toBe(
        ErrorCodes.URL_UNREACHABLE,
      );
    }
  });
});

// ---- Network tests (require BASE_RPC_URL) ----

describe.skipIf(!process.env.BASE_RPC_URL)(
  "detectRoute (network)",
  () => {
    it("detects x402 route from PayAI echo merchant", async () => {
      const { detectRoute } = await import("../src/detect.js");

      const result = await detectRoute(
        "https://x402.payai.network/api/base-sepolia/paid-content",
      );

      expect(result.route).toBe("x402");
      expect(result.requirements).toBeDefined();
      expect(isAddress(result.requirements!.payTo)).toBe(true);
      expect(result.requirements!.maxAmountRequired).toBeTruthy();
      expect(result.requirements!.network).toBe("eip155:84532");
    });
  },
);
