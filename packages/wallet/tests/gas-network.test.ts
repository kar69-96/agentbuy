import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createPublicClient, http, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sendGas } from "../src/gas.js";
import { createWallet } from "../src/create.js";

// No mocks — these hit Base Sepolia for real.
// Skipped when env vars are missing (CI without secrets, local dev without keys).

const hasNetworkEnv =
  !!process.env.BASE_RPC_URL && !!process.env.BLOON_MASTER_PRIVATE_KEY;

/** RPC balance can lag a couple seconds after receipt confirmation. */
async function waitForBalance(
  client: PublicClient,
  address: `0x${string}`,
  maxWaitMs = 10_000,
): Promise<bigint> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const bal = await client.getBalance({ address });
    if (bal > 0n) return bal;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return 0n;
}

describe.skipIf(!hasNetworkEnv)("sendGas — network integration", () => {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_RPC_URL),
  });

  it(
    "sends ETH to a fresh wallet on Base Sepolia",
    async () => {
      const freshKey = generatePrivateKey();
      const freshAccount = privateKeyToAccount(freshKey);

      await sendGas(
        process.env.BLOON_MASTER_PRIVATE_KEY!,
        freshAccount.address,
      );

      const balance = await waitForBalance(publicClient, freshAccount.address);
      expect(balance).toBeGreaterThan(0n);
    },
    30_000,
  );

  it(
    "createWallet produces a wallet with ETH balance",
    async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "bloon-gas-test-"),
      );
      const origDataDir = process.env.BLOON_DATA_DIR;
      process.env.BLOON_DATA_DIR = tmpDir;

      try {
        const wallet = await createWallet("GasTestAgent");

        const balance = await waitForBalance(
          publicClient,
          wallet.address as `0x${string}`,
        );
        expect(balance).toBeGreaterThan(0n);
      } finally {
        if (origDataDir === undefined) {
          delete process.env.BLOON_DATA_DIR;
        } else {
          process.env.BLOON_DATA_DIR = origDataDir;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
