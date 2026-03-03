import { describe, it, expect } from "vitest";
import { calculateFee, calculateTotal } from "../src/fees.js";
import { BloonError, ErrorCodes } from "../src/types.js";

describe("calculateFee", () => {
  it('browserbase fee for $17.99 rounds up to "0.36"', () => {
    // 17.99 * 0.02 = 0.3598, ceil to 2dp = 0.36
    expect(calculateFee("17.99", "browserbase")).toBe("0.36");
  });

  it('x402 fee for $0.10 returns exact "0.002"', () => {
    // 0.10 * 0.02 = 0.002, < 0.01, exact
    expect(calculateFee("0.10", "x402")).toBe("0.002");
  });

  it("throws PRICE_EXCEEDS_LIMIT for price > $25", () => {
    expect(() => calculateFee("30.00", "browserbase")).toThrow(BloonError);
    try {
      calculateFee("30.00", "browserbase");
    } catch (e) {
      expect((e as BloonError).code).toBe(ErrorCodes.PRICE_EXCEEDS_LIMIT);
    }
  });

  it("does NOT throw for price exactly $25.00", () => {
    expect(() => calculateFee("25.00", "browserbase")).not.toThrow();
  });

  it('browserbase fee for $10.00 is "0.20"', () => {
    // 10.00 * 0.02 = 0.20, exact at 2dp
    expect(calculateFee("10.00", "browserbase")).toBe("0.20");
  });

  it('x402 fee for $1.00 is "0.02"', () => {
    // 1.00 * 0.02 = 0.02, >= 0.01, round to 2dp = 0.02
    expect(calculateFee("1.00", "x402")).toBe("0.02");
  });

  it('x402 fee for $20.00 is "0.40"', () => {
    // 20.00 * 0.02 = 0.40, >= 0.01, round to 2dp = 0.40
    expect(calculateFee("20.00", "x402")).toBe("0.40");
  });
});

describe("calculateTotal", () => {
  it('total for $17.99 browserbase is "18.35"', () => {
    // 17.99 + 0.36 = 18.35
    expect(calculateTotal("17.99", "browserbase")).toBe("18.35");
  });

  it('total for $0.10 x402 is "0.102"', () => {
    // 0.10 + 0.002 = 0.102
    expect(calculateTotal("0.10", "x402")).toBe("0.102");
  });

  it("throws PRICE_EXCEEDS_LIMIT for price > $25", () => {
    expect(() => calculateTotal("30.00", "browserbase")).toThrow(BloonError);
  });
});
