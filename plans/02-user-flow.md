# User Flow — Proxo v1

## Personas

1. **Agent Owner** — Funds wallet via QR code, tells agent to buy things.
2. **AI Agent** — Any LLM agent or script that can make HTTP requests.

---

## Flow 1: Wallet Creation & Funding

```
Agent:
  POST /api/wallets { "agent_name": "Shopping Agent" }

Returns:
  wallet_id: "proxo_w_7k2m9x"
  funding_url: "http://localhost:3000/fund/a8f3x9k2m7p..."

Agent tells human: "Fund your wallet here: <funding_url>"

Human opens funding_url → QR code + live balance ($0.00)
Human scans QR → sends $50 USDC on Base → page updates: $50.00

Agent:
  GET /api/wallets/proxo_w_7k2m9x → balance: "50.00"
```

---

## Flow 2: Purchase via URL (shipping provided)

```
Agent:
  POST /api/buy {
    "url": "https://amazon.com/dp/B08...",
    "wallet_id": "proxo_w_7k2m9x",
    "shipping": { "name": "Karthik", "street": "123 Main St", ... }
  }

Returns: order_id, product (Anker USB-C Hub, $17.99), payment ($18.89, 5% fee)

Agent decides to proceed:
  POST /api/confirm { "order_id": "proxo_ord_9x2k4m" }

Server: transfers USDC, launches browser checkout, fills forms, submits order

Returns: receipt { order_number: "112-456...", estimated_delivery: "Feb 21" }
```

---

## Flow 3: Purchase via URL (shipping NOT provided)

```
Agent:
  POST /api/buy {
    "url": "https://target.com/p/bluetooth-speaker/...",
    "wallet_id": "proxo_w_7k2m9x"
  }

IF .env has default shipping -> uses defaults, returns quote normally

IF no defaults -> returns:
  { "error": { "code": "SHIPPING_REQUIRED", "message": "..." } }

Agent asks human for address, then re-calls POST /api/buy with shipping included.
```

---

## Flow 4: x402 API Purchase

```
Agent:
  POST /api/buy {
    "url": "https://api.weather402.com/forecast?lat=30.27&lon=-97.74",
    "wallet_id": "proxo_w_7k2m9x"
  }

Server: HEAD request -> 402! -> x402 route. Fee: $0.10 x 0.5% = $0.0005

Returns: order_id, product (Weather API, $0.10), payment ($0.1005, x402 route)

Agent:
  POST /api/confirm { "order_id": "proxo_ord_3n7p1q" }

Returns: receipt + response: { weather: "sunny", temperature: 72 }

Agent uses the weather data directly from the response field.
```

---

## Flow 5: Check Wallet & History

```
Agent:
  GET /api/wallets/proxo_w_7k2m9x

Returns: balance ($31.01), transactions: [deposit +$50, purchase -$18.89, purchase -$0.10]

Agent: "You have $31.01 remaining. 2 purchases made."
```

---

## Key UX Principles

1. **No auth.** Any agent makes HTTP requests. wallet_id is the only credential.
2. **One link is the only onboarding.** Create wallet -> human opens funding_url -> scans QR -> funded.
3. **Agent always asks before spending.** buy returns a quote. confirm executes. Two steps.
4. **Shipping collected when needed.** Physical products without an address get SHIPPING_REQUIRED.
5. **Same flow regardless of route.** x402 and browser produce identical receipt structures.
6. **Domain caching for speed.** Repeat purchases from the same merchant skip cookie banners.
