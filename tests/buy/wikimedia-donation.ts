/**
 * Wikimedia $2.50 one-time donation — Browserbase CUA dry-run.
 * Tests the page-based checkout loop (≤5 LLM calls max).
 * Run: pnpm tsx tests/buy/wikimedia-donation.ts
 */
import "dotenv/config";
import { runCheckout } from "@bloon/checkout";
import type { Order, ShippingInfo } from "@bloon/core";

const shipping: ShippingInfo = {
  name: process.env.SHIPPING_NAME!,
  street: process.env.SHIPPING_STREET!,
  city: process.env.SHIPPING_CITY!,
  state: process.env.SHIPPING_STATE!,
  zip: process.env.SHIPPING_ZIP!,
  country: process.env.SHIPPING_COUNTRY!,
  email: process.env.SHIPPING_EMAIL!,
  phone: process.env.SHIPPING_PHONE!,
};

const order: Order = {
  order_id: `wiki-${Date.now()}`,
  wallet_id: "bloon_w_test01",
  status: "processing",
  product: {
    name: "Wikimedia Donation — $2.50 one-time",
    url: "https://donate.wikimedia.org/w/index.php?title=Special:LandingPage&country=ES&uselang=en&wmf_medium=wikimediaPortal&wmf_source=wikimediaPortalBtn&wmf_campaign=wikimediaPortalBtn",
    price: "2.50",
    source: "donate.wikimedia.org",
  },
  payment: {
    amount_usdc: "2.55",
    price: "2.50",
    fee: "0.05",
    fee_rate: "2%",
    route: "browserbase",
  },
  shipping,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
};

console.log(`Wikimedia donation dry-run — $2.50 one-time (page-based loop, ≤5 LLM calls)`);
console.log(`Shipping: ${shipping.name}, ${shipping.email}\n`);

const result = await runCheckout({
  order,
  shipping,
  dryRun: true,
  sessionOptions: { stealth: true, proxies: true, logSession: true },
});

console.log("\n=== RESULT ===");
console.log(`Success:  ${result.success}`);
console.log(`Session:  ${result.sessionId}`);
console.log(`Replay:   ${result.replayUrl}`);
console.log(`Total:    ${result.finalTotal ?? "(not extracted)"}`);
if (result.failedStep) console.log(`Failed:   ${result.failedStep}`);
if (result.errorMessage) console.log(`Error:    ${result.errorMessage.slice(0, 300)}`);
console.log(`Duration: ${((result.durationMs ?? 0) / 1000).toFixed(1)}s`);
