import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

describe.skipIf(!process.env.BASE_RPC_URL)(
  "transferUSDC (network)",
  () => {
    it("throws TRANSFER_FAILED for insufficient balance", async () => {
      const { transferUSDC } = await import("../src/transfer.js");
      const { BloonError, ErrorCodes } = await import("@bloon/core");

      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);

      await expect(
        transferUSDC(privateKey, account.address, "1.00"),
      ).rejects.toThrow(BloonError);

      try {
        await transferUSDC(privateKey, account.address, "1.00");
      } catch (error) {
        expect(error).toBeInstanceOf(BloonError);
        expect((error as InstanceType<typeof BloonError>).code).toBe(
          ErrorCodes.TRANSFER_FAILED,
        );
      }
    });
  },
);
