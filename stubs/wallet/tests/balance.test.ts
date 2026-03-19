import { describe, it, expect } from "vitest";
import { formatUsdc } from "../src/balance.js";

describe("formatUsdc", () => {
  it("formats 0n as '0.00'", () => {
    expect(formatUsdc(0n)).toBe("0.00");
  });

  it("formats 1000000n as '1.00'", () => {
    expect(formatUsdc(1000000n)).toBe("1.00");
  });

  it("formats 1500000n as '1.50'", () => {
    expect(formatUsdc(1500000n)).toBe("1.50");
  });

  it("formats 123456n as '0.123456'", () => {
    expect(formatUsdc(123456n)).toBe("0.123456");
  });

  it("formats 10n as '0.00001'", () => {
    expect(formatUsdc(10n)).toBe("0.00001");
  });

  it("formats 100000000n as '100.00'", () => {
    expect(formatUsdc(100000000n)).toBe("100.00");
  });

  it("formats 1n as '0.000001'", () => {
    expect(formatUsdc(1n)).toBe("0.000001");
  });
});

describe.skipIf(!process.env.BASE_RPC_URL)("getBalance (network)", () => {
  it("returns '0.00' for an empty address", async () => {
    const { getBalance } = await import("../src/balance.js");
    const { generatePrivateKey, privateKeyToAccount } = await import(
      "viem/accounts"
    );
    // Generate a fresh random address — guaranteed to have 0 USDC
    const freshAddress = privateKeyToAccount(generatePrivateKey()).address;
    const balance = await getBalance(freshAddress);
    expect(balance).toBe("0.00");
  });
});
