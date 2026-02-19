import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { privateKeyToAccount } from "viem/accounts";
import { isAddress } from "viem";
import { createWallet } from "../src/create.js";
import { getWallet, getNetwork } from "@proxo/core";

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
});
