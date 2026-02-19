import { describe, it, expect } from "vitest";
import { calculateFee, calculateTotal } from "../src/fees.js";
import { ProxoError, ErrorCodes } from "../src/types.js";

describe("calculateFee", () => {
  it('browserbase fee for $17.99 rounds up to "0.90"', () => {
    // 17.99 * 0.05 = 0.8995, ceil to 2dp = 0.90
    expect(calculateFee("17.99", "browserbase")).toBe("0.90");
  });

  it('x402 fee for $0.10 returns exact "0.0005"', () => {
    // 0.10 * 0.005 = 0.0005, < 0.01, exact
    expect(calculateFee("0.10", "x402")).toBe("0.0005");
  });

  it("throws PRICE_EXCEEDS_LIMIT for price > $25", () => {
    expect(() => calculateFee("30.00", "browserbase")).toThrow(ProxoError);
    try {
      calculateFee("30.00", "browserbase");
    } catch (e) {
      expect((e as ProxoError).code).toBe(ErrorCodes.PRICE_EXCEEDS_LIMIT);
    }
  });

  it("does NOT throw for price exactly $25.00", () => {
    expect(() => calculateFee("25.00", "browserbase")).not.toThrow();
  });

  it('browserbase fee for $10.00 is "0.50"', () => {
    // 10.00 * 0.05 = 0.50, exact at 2dp
    expect(calculateFee("10.00", "browserbase")).toBe("0.50");
  });

  it('x402 fee for $1.00 is "0.005"', () => {
    // 1.00 * 0.005 = 0.005, < 0.01, exact
    expect(calculateFee("1.00", "x402")).toBe("0.005");
  });

  it('x402 fee for $20.00 rounds up to "0.10"', () => {
    // 20.00 * 0.005 = 0.10, >= 0.01, round to 2dp = 0.10
    expect(calculateFee("20.00", "x402")).toBe("0.10");
  });
});

describe("calculateTotal", () => {
  it('total for $17.99 browserbase is "18.89"', () => {
    // 17.99 + 0.90 = 18.89
    expect(calculateTotal("17.99", "browserbase")).toBe("18.89");
  });

  it('total for $0.10 x402 is "0.1005"', () => {
    // 0.10 + 0.0005 = 0.1005
    expect(calculateTotal("0.10", "x402")).toBe("0.1005");
  });

  it("throws PRICE_EXCEEDS_LIMIT for price > $25", () => {
    expect(() => calculateTotal("30.00", "browserbase")).toThrow(ProxoError);
  });
});
