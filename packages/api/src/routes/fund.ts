import { Hono } from "hono";
import {
  getWalletByFundingToken,
  getNetwork,
  getCdpApiKeyId,
  getCdpApiKeySecret,
} from "@proxo/core";
import { getBalance, generateQR } from "@proxo/wallet";
import * as jose from "jose";

export const fundRoutes = new Hono();

// GET /fund/:token — HTML funding page
fundRoutes.get("/:token", async (c) => {
  const token = c.req.param("token");
  const wallet = getWalletByFundingToken(token);

  if (!wallet) {
    return c.html("<h1>Not Found</h1><p>Invalid funding link.</p>", 404);
  }

  const balance = await getBalance(wallet.address);
  const qrDataUrl = await generateQR(wallet.address);
  const network = getNetwork();
  const networkLabel = network === "base" ? "Base (Mainnet)" : "Base Sepolia (Testnet)";
  const onrampAvailable = !!(getCdpApiKeyId() && getCdpApiKeySecret());

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fund Wallet — Proxo</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
    .card { background: #1a1a1a; border-radius: 16px; padding: 40px; max-width: 420px; width: 100%; text-align: center; border: 1px solid #2a2a2a; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; color: #fff; }
    .network { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; margin-bottom: 24px; }
    .network.testnet { background: #1a3a1a; color: #4ade80; }
    .network.mainnet { background: #3a2a1a; color: #fbbf24; }
    .section-title { font-size: 1rem; font-weight: 600; color: #fff; margin-bottom: 8px; }
    .section-subtitle { font-size: 0.75rem; color: #888; margin-bottom: 16px; }
    .onramp-btn { display: inline-block; padding: 12px 32px; background: #0052ff; color: #fff; font-size: 1rem; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; text-decoration: none; transition: background 0.2s; }
    .onramp-btn:hover { background: #0040cc; }
    .onramp-btn:disabled { background: #333; cursor: not-allowed; color: #888; }
    .onramp-status { font-size: 0.75rem; color: #888; margin-top: 8px; min-height: 1.2em; }
    .divider { display: flex; align-items: center; gap: 16px; margin: 24px 0; }
    .divider-line { flex: 1; height: 1px; background: #2a2a2a; }
    .divider-text { font-size: 0.75rem; color: #666; font-weight: 600; }
    .qr { margin: 0 auto 24px; }
    .qr img { border-radius: 8px; }
    .address { font-family: monospace; font-size: 0.8rem; background: #0a0a0a; padding: 12px; border-radius: 8px; word-break: break-all; cursor: pointer; border: 1px solid #2a2a2a; position: relative; }
    .address:hover { border-color: #4a4a4a; }
    .address .hint { font-size: 0.65rem; color: #666; margin-top: 4px; }
    .balance-section { margin-top: 24px; }
    .balance-label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
    .balance-value { font-size: 2rem; font-weight: 700; color: #fff; margin-top: 4px; }
    .balance-unit { font-size: 1rem; color: #888; font-weight: 400; }
    .tos { font-size: 0.6rem; color: #555; margin-top: 20px; line-height: 1.4; }
    .tos a { color: #666; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Fund Wallet</h1>
    <span class="network ${network === "base" ? "mainnet" : "testnet"}">${networkLabel}</span>

    <div id="onramp-section" class="${onrampAvailable ? "" : "hidden"}">
      <div class="section-title">Buy with Card</div>
      <div class="section-subtitle">No account needed · Zero fees on Base</div>
      <button class="onramp-btn" id="onramp-btn" onclick="openOnramp()">Buy USDC</button>
      <div class="onramp-status" id="onramp-status"></div>
    </div>

    <div class="divider ${onrampAvailable ? "" : "hidden"}" id="divider">
      <div class="divider-line"></div>
      <span class="divider-text">OR</span>
      <div class="divider-line"></div>
    </div>

    <div class="section-title">Send USDC Directly</div>
    <div class="qr"><img src="${qrDataUrl}" alt="Wallet QR Code" width="256" height="256"></div>
    <div class="address" onclick="navigator.clipboard.writeText('${wallet.address}')">
      ${wallet.address}
      <div class="hint">Click to copy</div>
    </div>

    <div class="balance-section">
      <div class="balance-label">USDC Balance</div>
      <div class="balance-value" id="balance">${balance} <span class="balance-unit">USDC</span></div>
    </div>

    <div class="tos">By using Coinbase Onramp, you agree to Coinbase's <a href="https://www.coinbase.com/legal/user_agreement" target="_blank">Terms of Service</a> and <a href="https://www.coinbase.com/legal/privacy" target="_blank">Privacy Policy</a>.</div>
  </div>
  <script>
    setInterval(async () => {
      try {
        const res = await fetch(window.location.pathname + '/balance');
        if (res.ok) {
          const data = await res.json();
          document.getElementById('balance').innerHTML = data.balance_usdc + ' <span class="balance-unit">USDC</span>';
        }
      } catch {}
    }, 10000);

    async function openOnramp() {
      const btn = document.getElementById('onramp-btn');
      const status = document.getElementById('onramp-status');
      btn.disabled = true;
      status.textContent = 'Getting session...';
      try {
        const res = await fetch(window.location.pathname + '/onramp-session');
        if (!res.ok) {
          const data = await res.json();
          status.textContent = data.error || 'Failed to start onramp';
          btn.disabled = false;
          return;
        }
        const data = await res.json();
        window.open(data.onrampUrl, '_blank');
        status.textContent = 'Opened in new tab';
        btn.disabled = false;
      } catch (e) {
        status.textContent = 'Network error';
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`;

  return c.html(html);
});

// GET /fund/:token/onramp-session — Generate Coinbase Onramp session URL
fundRoutes.get("/:token/onramp-session", async (c) => {
  const token = c.req.param("token");
  const wallet = getWalletByFundingToken(token);

  if (!wallet) {
    return c.json(
      { error: { code: "WALLET_NOT_FOUND", message: "Invalid funding token" } },
      404,
    );
  }

  const cdpApiKeyId = getCdpApiKeyId();
  const cdpApiKeySecret = getCdpApiKeySecret();

  if (!cdpApiKeyId || !cdpApiKeySecret) {
    return c.json({ error: "Coinbase Onramp not configured" }, 503);
  }

  // Import the base64-encoded EC private key as ES256
  const privateKeyPem = Buffer.from(cdpApiKeySecret, "base64").toString(
    "utf-8",
  );
  const ecKey = await jose.importPKCS8(privateKeyPem, "ES256");

  // Sign CDP JWT
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new jose.SignJWT({
    sub: cdpApiKeyId,
    iss: "cdp",
    aud: ["cdp_service"],
    uris: ["https://api.developer.coinbase.com/onramp/v1/token"],
  })
    .setProtectedHeader({
      alg: "ES256",
      kid: cdpApiKeyId,
      nonce: crypto.randomUUID(),
      typ: "JWT",
    })
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .setNotBefore(now)
    .sign(ecKey);

  // Request onramp session token from CDP
  const cdpRes = await fetch(
    "https://api.developer.coinbase.com/onramp/v1/token",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addresses: [
          { address: wallet.address, blockchains: ["base"] },
        ],
        assets: ["USDC"],
      }),
    },
  );

  if (!cdpRes.ok) {
    const text = await cdpRes.text();
    return c.json(
      { error: `Coinbase Onramp error: ${cdpRes.status} ${text}` },
      502,
    );
  }

  const cdpData = (await cdpRes.json()) as { token: string };
  const onrampUrl = `https://pay.coinbase.com/buy/select-asset?sessionToken=${cdpData.token}&defaultAsset=USDC&fiatCurrency=USD&defaultPaymentMethod=CARD`;

  return c.json({ onrampUrl });
});

// GET /fund/:token/balance — JSON balance (polled by funding page)
fundRoutes.get("/:token/balance", async (c) => {
  const token = c.req.param("token");
  const wallet = getWalletByFundingToken(token);

  if (!wallet) {
    return c.json({ error: { code: "WALLET_NOT_FOUND", message: "Invalid funding token" } }, 404);
  }

  const balance = await getBalance(wallet.address);
  return c.json({ balance_usdc: balance });
});
