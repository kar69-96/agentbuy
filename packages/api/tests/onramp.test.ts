import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---- Mock external packages ----

vi.mock("@proxo/wallet", () => ({
  createWallet: vi.fn(),
  getBalance: vi.fn(),
  generateQR: vi.fn(),
}));

vi.mock("@proxo/orchestrator", () => ({
  buy: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("jose", () => ({
  importPKCS8: vi.fn(),
  SignJWT: vi.fn(),
}));

import { getBalance, generateQR } from "@proxo/wallet";
import * as jose from "jose";
import { createApp } from "../src/server.js";

const mockedGetBalance = vi.mocked(getBalance);
const mockedGenerateQR = vi.mocked(generateQR);

// ---- Test helpers ----

let tmpDir: string;
let app: ReturnType<typeof createApp>;

const TEST_WALLET_ID = "proxo_w_onramp01";
const TEST_ADDRESS = "0x" + "a".repeat(40);
const TEST_FUNDING_TOKEN = "tok_onramp_fund";

function setupWallet(): void {
  const walletsPath = path.join(tmpDir, "wallets.json");
  fs.writeFileSync(
    walletsPath,
    JSON.stringify({
      wallets: [
        {
          wallet_id: TEST_WALLET_ID,
          address: TEST_ADDRESS,
          private_key: "0x" + "b".repeat(64),
          funding_token: TEST_FUNDING_TOKEN,
          network: "base-sepolia",
          agent_name: "OnrampAgent",
          created_at: "2026-02-20T00:00:00.000Z",
        },
      ],
    }),
  );
}

function setupConfig(): void {
  const configPath = path.join(tmpDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      master_wallet: {
        address: "0x" + "c".repeat(40),
        private_key: "0x" + "d".repeat(64),
      },
      network: "base-sepolia",
      usdc_contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      max_transaction_amount: 25,
      default_order_expiry_seconds: 300,
      port: 3000,
    }),
  );
}

async function req(method: string, pathStr: string) {
  const url = `http://localhost${pathStr}`;
  return app.request(url, { method });
}

// ---- Setup / Teardown ----

let savedCdpKeyId: string | undefined;
let savedCdpKeySecret: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxo-onramp-test-"));
  process.env.PROXO_DATA_DIR = tmpDir;
  savedCdpKeyId = process.env.CDP_API_KEY_ID;
  savedCdpKeySecret = process.env.CDP_API_KEY_SECRET;
  setupWallet();
  setupConfig();
  vi.clearAllMocks();
  app = createApp();
  mockedGetBalance.mockResolvedValue("50.00");
  mockedGenerateQR.mockResolvedValue("data:image/png;base64,FAKE_QR");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.PROXO_DATA_DIR;
  // Restore CDP env vars
  if (savedCdpKeyId !== undefined) process.env.CDP_API_KEY_ID = savedCdpKeyId;
  else delete process.env.CDP_API_KEY_ID;
  if (savedCdpKeySecret !== undefined) process.env.CDP_API_KEY_SECRET = savedCdpKeySecret;
  else delete process.env.CDP_API_KEY_SECRET;
});

// ---- GET /fund/:token/onramp-session ----

describe("GET /fund/:token/onramp-session", () => {
  it("returns 503 when CDP keys are not configured", async () => {
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;

    const res = await req("GET", `/fund/${TEST_FUNDING_TOKEN}/onramp-session`);
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json.error).toBe("Coinbase Onramp not configured");
  });

  it("returns 404 for invalid funding token", async () => {
    const res = await req("GET", "/fund/invalid_token/onramp-session");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error.code).toBe("WALLET_NOT_FOUND");
  });

  it("returns onrampUrl when CDP keys are configured and CDP API succeeds", async () => {
    process.env.CDP_API_KEY_ID = "test-key-id";
    process.env.CDP_API_KEY_SECRET = "dGVzdC1rZXk="; // base64("test-key")

    // Mock jose
    const mockSign = vi.fn().mockResolvedValue("mock-jwt-token");
    const mockSetNotBefore = vi.fn().mockReturnValue({ sign: mockSign });
    const mockSetExpTime = vi.fn().mockReturnValue({ setNotBefore: mockSetNotBefore });
    const mockSetIssuedAt = vi.fn().mockReturnValue({ setExpirationTime: mockSetExpTime });
    const mockSetHeader = vi.fn().mockReturnValue({ setIssuedAt: mockSetIssuedAt });

    vi.mocked(jose.SignJWT).mockImplementation(() => ({
      setProtectedHeader: mockSetHeader,
    }) as unknown as jose.SignJWT);
    vi.mocked(jose.importPKCS8).mockResolvedValue({} as jose.KeyLike);

    // Mock global fetch for CDP API
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: "cdp-session-token-123" }),
    } as Response);

    try {
      const res = await req("GET", `/fund/${TEST_FUNDING_TOKEN}/onramp-session`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.onrampUrl).toContain("https://pay.coinbase.com/buy/select-asset");
      expect(json.onrampUrl).toContain("sessionToken=cdp-session-token-123");
      expect(json.onrampUrl).toContain("defaultAsset=USDC");
      expect(json.onrampUrl).toContain("defaultPaymentMethod=CARD");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 502 when CDP API returns an error", async () => {
    process.env.CDP_API_KEY_ID = "test-key-id";
    process.env.CDP_API_KEY_SECRET = "dGVzdC1rZXk=";

    const mockSign = vi.fn().mockResolvedValue("mock-jwt-token");
    const mockSetNotBefore = vi.fn().mockReturnValue({ sign: mockSign });
    const mockSetExpTime = vi.fn().mockReturnValue({ setNotBefore: mockSetNotBefore });
    const mockSetIssuedAt = vi.fn().mockReturnValue({ setExpirationTime: mockSetExpTime });
    const mockSetHeader = vi.fn().mockReturnValue({ setIssuedAt: mockSetIssuedAt });

    vi.mocked(jose.SignJWT).mockImplementation(() => ({
      setProtectedHeader: mockSetHeader,
    }) as unknown as jose.SignJWT);
    vi.mocked(jose.importPKCS8).mockResolvedValue({} as jose.KeyLike);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    } as unknown as Response);

    try {
      const res = await req("GET", `/fund/${TEST_FUNDING_TOKEN}/onramp-session`);
      expect(res.status).toBe(502);

      const json = await res.json();
      expect(json.error).toContain("Coinbase Onramp error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---- Funding page HTML ----

describe("Funding page HTML — onramp integration", () => {
  it("contains Buy with Card section when CDP keys are configured", async () => {
    process.env.CDP_API_KEY_ID = "test-key-id";
    process.env.CDP_API_KEY_SECRET = "dGVzdC1rZXk=";

    // Recreate app to pick up new env
    app = createApp();

    const res = await req("GET", `/fund/${TEST_FUNDING_TOKEN}`);
    const html = await res.text();

    expect(html).toContain("Buy with Card");
    expect(html).toContain("No account needed");
    expect(html).toContain("Buy USDC");
    expect(html).toContain("Send USDC Directly");
    expect(html).toContain("OR");
  });

  it("contains Coinbase ToS acknowledgment", async () => {
    process.env.CDP_API_KEY_ID = "test-key-id";
    process.env.CDP_API_KEY_SECRET = "dGVzdC1rZXk=";
    app = createApp();

    const res = await req("GET", `/fund/${TEST_FUNDING_TOKEN}`);
    const html = await res.text();

    expect(html).toContain("Coinbase");
    expect(html).toContain("Terms of Service");
    expect(html).toContain("Privacy Policy");
  });

  it("does not contain CDP API keys in HTML response", async () => {
    process.env.CDP_API_KEY_ID = "secret-key-id-do-not-leak";
    process.env.CDP_API_KEY_SECRET = "c2VjcmV0LXNlY3JldC1rZXk=";
    app = createApp();

    const res = await req("GET", `/fund/${TEST_FUNDING_TOKEN}`);
    const html = await res.text();

    expect(html).not.toContain("secret-key-id-do-not-leak");
    expect(html).not.toContain("c2VjcmV0LXNlY3JldC1rZXk=");
    expect(html).not.toContain("CDP_API_KEY_ID");
    expect(html).not.toContain("CDP_API_KEY_SECRET");
  });
});
