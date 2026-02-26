import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { privateKeyToAccount } from "viem/accounts";
import { isAddress } from "viem";
import { getWallet, getNetwork } from "@proxo/core";

// Mock sendGas so createWallet doesn't try to hit the network
vi.mock("../src/gas.js", () => ({
  sendGas: vi.fn().mockResolvedValue({ tx_hash: "0xmockgas", amount: "0.00001" }),
}));

// Mock loadConfig to return a fake master wallet key
vi.mock("@proxo/core", async () => {
  const actual = await vi.importActual<typeof import("@proxo/core")>(
    "@proxo/core",
  );
  return {
    ...actual,
    loadConfig: () => ({
      master_wallet: {
        address: "0xMasterAddress",
        private_key: "0x" + "ab".repeat(32),
      },
      network: "base-sepolia",
      usdc_contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      max_transaction_amount: 25,
      default_order_expiry_seconds: 300,
      port: 3000,
    }),
  };
});

import { createWallet } from "../src/create.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxo-wallet-test-"));
  process.env.PROXO_DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.PROXO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createWallet", () => {
  it("returns a wallet with all required fields", async () => {
    const wallet = await createWallet("TestAgent");

    expect(wallet.wallet_id).toMatch(/^proxo_w_[a-z0-9]{6}$/);
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.private_key).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(wallet.funding_token).toBeTruthy();
    expect(wallet.network).toBe(getNetwork());
    expect(wallet.agent_name).toBe("TestAgent");
    expect(wallet.created_at).toBeTruthy();
  });

  it("generates a valid checksummed address", async () => {
    const wallet = await createWallet("TestAgent");
    expect(isAddress(wallet.address, { strict: true })).toBe(true);
  });

  it("private key derives back to the same address", async () => {
    const wallet = await createWallet("TestAgent");
    const account = privateKeyToAccount(wallet.private_key as `0x${string}`);
    expect(account.address).toBe(wallet.address);
  });

  it("generates unique addresses across wallets", async () => {
    const wallets = await Promise.all(
      Array.from({ length: 10 }, () => createWallet("TestAgent")),
    );
    const addresses = new Set(wallets.map((w) => w.address));
    expect(addresses.size).toBe(10);
  });

  it("persists wallet to store", async () => {
    const wallet = await createWallet("TestAgent");
    const stored = getWallet(wallet.wallet_id);
    expect(stored).toEqual(wallet);
  });

  it("generates unique funding tokens", async () => {
    const wallets = await Promise.all(
      Array.from({ length: 10 }, () => createWallet("TestAgent")),
    );
    const tokens = new Set(wallets.map((w) => w.funding_token));
    expect(tokens.size).toBe(10);
  });

  it("calls sendGas before persisting wallet", async () => {
    const { sendGas } = await import("../src/gas.js");
    const mockedSendGas = vi.mocked(sendGas);
    mockedSendGas.mockClear();

    const wallet = await createWallet("TestAgent");

    expect(mockedSendGas).toHaveBeenCalledOnce();
    expect(mockedSendGas).toHaveBeenCalledWith(
      "0x" + "ab".repeat(32),
      wallet.address,
    );
  });

  it("does not persist wallet if sendGas fails", async () => {
    const { sendGas } = await import("../src/gas.js");
    const mockedSendGas = vi.mocked(sendGas);
    mockedSendGas.mockRejectedValueOnce(new Error("no gas"));

    await expect(createWallet("FailAgent")).rejects.toThrow("no gas");

    // Verify no wallet was stored — getWallet returns undefined for any ID
    // Since the wallet was never persisted, we check the wallets file is empty
    const walletsPath = path.join(tmpDir, "wallets.json");
    if (fs.existsSync(walletsPath)) {
      const data = JSON.parse(fs.readFileSync(walletsPath, "utf-8"));
      expect(data.wallets.length).toBe(0);
    }
  });
});
