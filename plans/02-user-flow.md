# User Flow — Bloon v1

## Personas

1. **Agent Owner** — Funds wallet via QR code, tells agent to buy things.
2. **AI Agent** — Any LLM agent or script that can make HTTP requests.

---

## Flow 1: Wallet Creation & Funding

```
Agent:
  POST /api/wallets { "agent_name": "Shopping Agent" }

Returns:
  wallet_id: "bloon_w_7k2m9x"
  funding_url: "http://localhost:3000/fund/a8f3x9k2m7p..."

Agent tells human: "Fund your wallet here: <funding_url>"

Human opens funding_url → QR code + live balance ($0.00)
Human scans QR → sends $50 USDC on Base → page updates: $50.00

Agent:
  GET /api/wallets/bloon_w_7k2m9x → balance: "50.00"
```

---

## Flow 2: Product Discovery (Recommended First Step)

```
Agent:
  POST /api/query { "url": "https://allbirds.com/products/mens-tree-runners" }

Server runs 4-tier discovery: Firecrawl --> Exa.ai --> scrape --> Browserbase

Returns:
  product: { name: "Men's Tree Runners", price: "98.00", brand: "Allbirds" }
  options: [{ name: "Color", values: ["Charcoal", "Navy"] }, { name: "Size", values: ["8", "9", "10"] }]
  required_fields: [shipping.name, shipping.email, ..., selections]
  route: "browserbase"
  discovery_method: "firecrawl"

Agent now knows what fields to include in the buy request.
```

---

## Flow 3: Purchase via URL (with query first)

```
Agent:
  POST /api/buy {
    "url": "https://allbirds.com/products/mens-tree-runners",
    "wallet_id": "bloon_w_7k2m9x",
    "shipping": { "name": "Karthik", "street": "123 Main St", ... },
    "selections": { "Color": "Charcoal", "Size": "10" }
  }

Returns: order_id, product (Men's Tree Runners, $98.00), payment ($99.96, 2% fee)

Agent decides to proceed:
  POST /api/confirm { "order_id": "bloon_ord_9x2k4m" }

Server: transfers USDC, launches 12-step browser checkout, fills forms, submits order

Returns: receipt { order_number: "112-456...", estimated_delivery: "Feb 21" }
```

---

## Flow 4: Purchase via URL (shipping NOT provided)

```
Agent:
  POST /api/buy {
    "url": "https://target.com/p/bluetooth-speaker/...",
    "wallet_id": "bloon_w_7k2m9x"
  }

Returns:
  { "error": { "code": "SHIPPING_REQUIRED", "message": "..." } }

Agent asks human for address, then re-calls POST /api/buy with shipping included.
```

---

## Flow 5: x402 API Purchase

```
Agent:
  POST /api/buy {
    "url": "https://api.weather402.com/forecast?lat=30.27&lon=-97.74",
    "wallet_id": "bloon_w_7k2m9x"
  }

Server: HEAD request -> 402! -> x402 route. Fee: $0.10 x 2% = $0.002

Returns: order_id, product (Weather API, $0.10), payment ($0.102, x402 route)

Agent:
  POST /api/confirm { "order_id": "bloon_ord_3n7p1q" }

Returns: receipt + response: { weather: "sunny", temperature: 72 }

Agent uses the weather data directly from the response field.
```

---

## Flow 6: Check Wallet & History

```
Agent:
  GET /api/wallets/bloon_w_7k2m9x

Returns: balance ($31.53), transactions: [deposit +$50, purchase -$18.35, purchase -$0.12]

Agent: "You have $31.53 remaining. 2 purchases made."
```

---

## Key UX Principles

1. **No auth.** Any agent makes HTTP requests. wallet_id is the only credential.
2. **One link is the only onboarding.** Create wallet --> human opens funding_url --> scans QR --> funded.
3. **Query first, then buy.** query discovers product info and tells the agent exactly what fields to include.
4. **Agent always asks before spending.** buy returns a quote. confirm executes. Two steps.
5. **Shipping collected when needed.** Physical products without an address get SHIPPING_REQUIRED.
6. **Same flow regardless of route.** x402 and browser produce identical receipt structures.
7. **Domain caching for speed.** Repeat purchases from the same merchant skip cookie banners.
