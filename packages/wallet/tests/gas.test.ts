import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock viem before importing the module under test
const mockSendTransaction = vi.fn();
const mockWaitForTransactionReceipt = vi.fn();

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createWalletClient: () => ({
      sendTransaction: mockSendTransaction,
    }),
  };
});

vi.mock("viem/accounts", async () => {
  const actual =
    await vi.importActual<typeof import("viem/accounts")>("viem/accounts");
  return {
    ...actual,
    privateKeyToAccount: () => ({
      address: "0xMasterAddress" as `0x${string}`,
    }),
  };
});

vi.mock("../src/client.js", () => ({
  getChain: () => ({ id: 84532, name: "Base Sepolia" }),
  getPublicClient: () => ({
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
  }),
}));

vi.mock("@bloon/core", async () => {
  const actual = await vi.importActual<typeof import("@bloon/core")>(
    "@bloon/core",
  );
  return {
    ...actual,
    getRpcUrl: () => "https://fake-rpc.test",
  };
});

describe("sendGas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends ETH with correct amount and returns tx hash", async () => {
    const fakeHash = "0xabc123";
    mockSendTransaction.mockResolvedValue(fakeHash);
    mockWaitForTransactionReceipt.mockResolvedValue({ status: "success" });

    const { sendGas, AUTO_GAS_ETH } = await import("../src/gas.js");

    const result = await sendGas(
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      "0xRecipientAddress",
    );

    expect(mockSendTransaction).toHaveBeenCalledOnce();
    const callArgs = mockSendTransaction.mock.calls[0][0];
    expect(callArgs.to).toBe("0xRecipientAddress");
    // parseEther("0.00001") = 10_000_000_000_000n (10^13 wei)
    expect(callArgs.value).toBe(10_000_000_000_000n);

    expect(mockWaitForTransactionReceipt).toHaveBeenCalledWith({
      hash: fakeHash,
    });

    expect(result.tx_hash).toBe(fakeHash);
    expect(result.amount).toBe(AUTO_GAS_ETH);
  });

  it("throws GAS_TRANSFER_FAILED when sendTransaction fails", async () => {
    mockSendTransaction.mockRejectedValue(new Error("insufficient funds"));

    const { sendGas } = await import("../src/gas.js");
    const { ErrorCodes } = await import("@bloon/core");

    try {
      await sendGas(
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        "0xRecipientAddress",
      );
      expect.fail("should have thrown");
    } catch (error: unknown) {
      expect((error as { code: string }).code).toBe(
        ErrorCodes.GAS_TRANSFER_FAILED,
      );
      expect((error as Error).message).toContain("insufficient funds");
    }
  });

  it("throws GAS_TRANSFER_FAILED when receipt wait fails", async () => {
    mockSendTransaction.mockResolvedValue("0xhash");
    mockWaitForTransactionReceipt.mockRejectedValue(
      new Error("receipt timeout"),
    );

    const { sendGas } = await import("../src/gas.js");
    const { ErrorCodes } = await import("@bloon/core");

    try {
      await sendGas(
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        "0xRecipientAddress",
      );
      expect.fail("should have thrown");
    } catch (error: unknown) {
      expect((error as { code: string }).code).toBe(
        ErrorCodes.GAS_TRANSFER_FAILED,
      );
    }
  });
});
