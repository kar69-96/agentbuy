import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getNetwork, getUsdcContract } from "@proxo/core";

// ---- Config tests — verify mainnet/testnet USDC contracts ----

let savedNetwork: string | undefined;

beforeEach(() => {
  savedNetwork = process.env.NETWORK;
});

afterEach(() => {
  if (savedNetwork !== undefined) process.env.NETWORK = savedNetwork;
  else delete process.env.NETWORK;
});

describe("mainnet config", () => {
  it("getNetwork() returns 'base' when NETWORK=base", () => {
    process.env.NETWORK = "base";
    expect(getNetwork()).toBe("base");
  });

  it("getUsdcContract() returns mainnet USDC when NETWORK=base", () => {
    process.env.NETWORK = "base";
    expect(getUsdcContract()).toBe(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    );
  });

  it("getNetwork() returns 'base-sepolia' when NETWORK=base-sepolia", () => {
    process.env.NETWORK = "base-sepolia";
    expect(getNetwork()).toBe("base-sepolia");
  });

  it("getUsdcContract() returns testnet USDC when NETWORK=base-sepolia", () => {
    process.env.NETWORK = "base-sepolia";
    expect(getUsdcContract()).toBe(
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    );
  });

  it("getNetwork() defaults to base-sepolia when NETWORK is unset", () => {
    delete process.env.NETWORK;
    expect(getNetwork()).toBe("base-sepolia");
  });
});
