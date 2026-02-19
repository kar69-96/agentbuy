# Proxo

**Any website. Any product. One USDC payment. The agent handles the rest.**

Proxo is an MCP server that lets AI agents purchase anything on the internet using USDC — and optionally get paid for their own services. The agent sends USDC to Proxo. Proxo figures out the rest: if the merchant speaks x402, Proxo pays them natively. If not, Proxo spins up a cloud browser and completes the checkout. The agent gets back a receipt either way. Same flow, same interface, regardless of what's on the other end.

The internet has two emerging payment layers for agents: x402 (for services that natively accept stablecoin over HTTP) and ACP (Stripe/OpenAI's protocol for opted-in merchants). But 99.9% of e-commerce speaks neither. Proxo bridges that gap — turning every checkout page on the web into an endpoint an agent can pay.

## Fee Model

The agent always pays Proxo's wallet. Proxo handles downstream payment and keeps a markup.

- **x402-native merchants:** 0.5% markup (Proxo pays the service on behalf of the agent)
- **Non-x402 merchants (via Browserbase):** 5% markup (covers cloud browser sessions, Stagehand LLM inference, and margin)

The agent never sees the difference. One flow, one interface, one receipt format.

## How It Works

Proxo exposes four tools via MCP that any compatible agent (Claude, Gemini, Codex, etc.) can call — two for purchasing, two for wallet management:

### Tool 1: `buy`

The agent passes either a URL or a description of what it wants, plus fulfillment info if needed. Proxo returns a quote — the total amount to send, Proxo's payment address, and an order reference.

If the agent passes a description instead of a URL, Proxo searches the web (via Exa.ai) and selects the best option automatically.

```
Agent calls: buy({
  query: "USB-C hub with at least 3 ports, under $20",
  shipping: {
    name: "Jane Doe",
    address: "123 Main St, Austin, TX 78701",
    email: "jane@example.com",
    phone: "512-555-0100"
  }
})

Proxo returns: {
  order_id: "proxo_ord_9x2k4m",
  product: {
    name: "Anker 5-in-1 USB-C Hub",
    url: "https://amazon.com/dp/B08...",
    price: "17.99",
    source: "amazon.com"
  },
  payment: {
    address: "0xProxoWallet...",     // Always the same Proxo wallet
    amount_usdc: "18.89",            // $17.99 + 5% (non-x402 merchant)
    fee: "0.90",
    fee_rate: "5%",
    route: "browserbase",
    reference: "18890742",           // Unique nonce
    expires_in: 120                  // Seconds
  },
  status: "awaiting_payment"
}
```

Or with a direct URL:

```
Agent calls: buy({
  url: "https://api.weather402.com/forecast",
})

Proxo returns: {
  order_id: "proxo_ord_3n7p1q",
  product: {
    name: "Weather Forecast API",
    url: "https://api.weather402.com/forecast",
    price: "0.10",
    source: "api.weather402.com"
  },
  payment: {
    address: "0xProxoWallet...",
    amount_usdc: "0.1005",           // $0.10 + 0.5% (x402 merchant)
    fee: "0.0005",
    fee_rate: "0.5%",
    route: "x402",
    reference: "01005032",
    expires_in: 120
  },
  status: "awaiting_payment"
}
```

The agent doesn't choose the route. Proxo probes the URL, detects x402 or not, and returns the right quote. The agent just sees: "send this much USDC to this address."

### Tool 2: `confirm`

The agent sends USDC to Proxo's wallet on Base and provides the transaction hash. Proxo verifies on-chain, executes the purchase (via x402 or Browserbase), and returns a receipt.

```
Agent calls: confirm({
  order_id: "proxo_ord_9x2k4m",
  tx_hash: "0xabc123..."
})

Proxo returns: {
  order_id: "proxo_ord_9x2k4m",
  status: "completed",
  receipt: {
    product: "Anker 5-in-1 USB-C Hub",
    merchant: "amazon.com",
    route: "browserbase",
    price: "17.99",
    fee: "0.90",
    total_paid: "18.89",
    order_number: "112-4567890-1234567",
    estimated_delivery: "Feb 21, 2026",
    confirmation_email: "sent to jane@example.com",
    tx_hash: "0xabc123...",
    timestamp: "2026-02-18T14:32:00Z"
  }
}
```

For x402 purchases, the receipt includes the service response directly:

```
Proxo returns: {
  order_id: "proxo_ord_3n7p1q",
  status: "completed",
  receipt: {
    product: "Weather Forecast API",
    merchant: "api.weather402.com",
    route: "x402",
    price: "0.10",
    fee: "0.0005",
    total_paid: "0.1005",
    tx_hash: "0xdef456...",
    timestamp: "2026-02-18T14:33:00Z"
  },
  response: {
    weather: "sunny",
    temperature: 72,
    location: "Austin, TX"
  }
}
```

Every purchase — x402 or Browserbase — produces a receipt with the same fields. The agent always knows: what it bought, from where, how much it paid, what fee was taken, and which route was used.

### Tool 3: `create_wallet`

The agent creates a new Proxo wallet and chooses its account type: buy (can only purchase) or buy_sell (can purchase and receive payments / sell services).

```
Agent calls: create_wallet({
  type: "buy",
  agent_name: "Shopping Agent"
})

Proxo returns: {
  wallet_id: "proxo_w_7k2m9x",
  address: "0x4d5e6f...",
  network: "base",
  type: "buy",
  agent_name: "Shopping Agent",
  balance_usdc: "0.00",
  created_at: "2026-02-18T14:30:00Z"
}
```

For buy/sell accounts, the agent also provides service details and gets x402 Bazaar config back:

```
Agent calls: create_wallet({
  type: "buy_sell",
  agent_name: "Market Research Agent",
  service: {
    description: "Deep-dive market analysis reports",
    price_per_call: "0.50",
    endpoint: "https://my-agent.example.com/research"
  }
})

Proxo returns: {
  wallet_id: "proxo_w_8m3n4p",
  address: "0x7a8b9c...",
  network: "base",
  type: "buy_sell",
  agent_name: "Market Research Agent",
  balance_usdc: "0.00",
  created_at: "2026-02-18T14:30:00Z",
  x402: {
    pay_to: "0x7a8b9c...",
    asset: "USDC",
    scheme: "exact",
    facilitator: "https://x402.org/facilitator",
    bazaar_listing: "https://x402.org/bazaar/proxo_w_8m3n4p",
    discovery_url: "https://x402.org/facilitator/discovery/resources?address=0x7a8b9c...",
    middleware_snippet: {
      express: "app.use(paymentMiddleware('0x7a8b9c...', { '/research': { price: '$0.50', network: 'base' } }, facilitator))",
      hono: "app.use('/*', x402Middleware({ ... }))"
    }
  }
}
```

Under the hood, wallets are Coinbase CDP Server Wallets — non-custodial, programmatic, no seed phrase management. Buy accounts are simple: fund with USDC on Base, start purchasing. Buy/sell accounts are automatically registered in the x402 Bazaar on creation, so other agents can discover and pay them immediately. Fund either type by sending USDC on Base to the returned address.

### Tool 4: `wallet_info`

The agent retrieves its wallet details — balance, full transaction history with receipts, and (for buy/sell accounts) x402 config.

```
Agent calls: wallet_info({
  wallet_id: "proxo_w_7k2m9x"
})

Proxo returns: {
  wallet_id: "proxo_w_7k2m9x",
  address: "0x4d5e6f...",
  network: "base",
  type: "buy",
  agent_name: "Shopping Agent",
  created_at: "2026-02-18T14:30:00Z",
  balance_usdc: "41.11",
  transactions: [
    {
      order_id: "proxo_ord_9x2k4m",
      type: "purchase",
      product: "Anker 5-in-1 USB-C Hub",
      merchant: "amazon.com",
      route: "browserbase",
      price: "17.99",
      fee: "0.90",
      total: "18.89",
      order_number: "112-4567890-1234567",
      status: "completed",
      timestamp: "2026-02-18T14:32:00Z"
    },
    {
      order_id: "proxo_ord_3n7p1q",
      type: "purchase",
      product: "Weather Forecast API",
      merchant: "api.weather402.com",
      route: "x402",
      price: "0.10",
      fee: "0.0005",
      total: "0.1005",
      status: "completed",
      timestamp: "2026-02-18T14:33:00Z"
    },
    {
      type: "deposit",
      amount: "60.00",
      from: "0xabc...",
      tx_hash: "0xdef...",
      timestamp: "2026-02-18T10:00:00Z"
    }
  ]
}
```

For buy/sell accounts, the response also includes the `x402` config block and `received` transactions (payments from other agents for services).

## Payment Flow

The agent's experience is always the same, regardless of what's behind the URL:

```
┌──────────────────────────────────────────────────────────┐
│                      AI AGENT                             │
│  (Claude, Gemini, Codex, or any MCP-compatible agent)    │
└───────────────────────┬──────────────────────────────────┘
                        │
           ┌────────────▼────────────┐
           │  1. buy                 │  ← URL or description + shipping
           │                         │
           │  If description:        │
           │  • Search via Exa.ai    │
           │  • Pick best option     │
           │                         │
           │  Probe URL:             │
           │  • x402? → 0.5% fee    │
           │  • else  → 5% fee      │
           └────────────┬────────────┘
                        │ Returns: quote + Proxo's payment address
                        │
           ┌────────────▼────────────┐
           │  Agent sends USDC on    │
           │  Base to Proxo wallet   │  ← Always the same address
           └────────────┬────────────┘
                        │ Transaction hash
                        │
           ┌────────────▼────────────┐
           │  2. confirm             │  ← Agent provides tx_hash
           │                         │
           │  Proxo verifies on-chain│
           │  (viem, ~2 sec)         │
           │                         │
           │  ┌────────────────────┐ │
           │  │ AUTO-ROUTE:        │ │
           │  │ x402 → pay service │ │  ← Proxo pays from its wallet
           │  │ else → Browserbase │ │  ← Proxo checks out via browser
           │  └────────┬───────────┘ │
           │           │             │
           └───────────┬─────────────┘
                       │
                       ▼
             ┌───────────────────┐
             │  Receipt returned │  → Always: product, merchant, route,
             │                   │    price, fee, total, confirmation
             └───────────────────┘
```

### The Key Insight: Agent Always Pays Proxo

The agent never interacts with the merchant's payment system. It always sends USDC to Proxo's wallet. Proxo then:

1. **For x402 merchants:** Proxo pays the x402 service from its own wallet using `@x402/fetch`, keeps the 0.5% spread, and returns the service response + receipt to the agent.
2. **For non-x402 merchants:** Proxo launches a Browserbase session, executes checkout with a pre-saved payment method via Stagehand, and returns the order confirmation + receipt.

This means the agent's code is identical whether it's buying a $0.10 API call or a $25 physical product. One address, one flow, one receipt format.

## Wallet Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                        AI AGENT                              │
└──────────┬──────────────────────────────────┬───────────────┘
           │                                  │
  ┌────────▼────────────────────────┐  ┌─────▼──────────────┐
  │ 3. create_wallet                │  │ 4. wallet_info     │
  │                                 │  │                    │
  │ • Choose: "buy" or "buy_sell"   │  │ • Balance          │
  │ • Generate Base wallet (CDP)    │  │ • Full tx history  │
  │ • Return address for funding    │  │   with receipts    │
  │                                 │  │                    │
  │ If buy_sell:                    │  │ If buy_sell:       │
  │ • Auto-publish to x402 Bazaar  │  │ • x402 config      │
  │ • Return x402 config +         │  │ • Received payments │
  │   middleware snippets           │  │                    │
  └────────┬───────────┬────────────┘  └────────────────────┘
           │           │
           ▼           ▼
  ┌────────────┐  ┌──────────────────────────┐
  │ Fund it:   │  │ buy_sell only:           │
  │ Send USDC  │  │ Immediately discoverable │
  │ on Base    │  │ in x402 Bazaar — other   │
  │            │  │ agents can find + pay    │
  └────────────┘  └──────────────────────────┘
```

## Architecture

### Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Interface | MCP Server (TypeScript) | How agents communicate with Proxo |
| Product Search | Exa.ai API | Find products when agent passes a description |
| Payment Verification | viem + Base RPC | Watch for USDC transfers on-chain |
| x402 Payments | @x402/fetch + @x402/evm | Pay x402 services from Proxo's wallet |
| Browser Automation | Browserbase + Stagehand | Execute checkout on non-x402 websites |
| Wallet Management | Coinbase CDP Server Wallets | Agent wallet creation, balance, history |
| Hosting | Vercel / Railway | Serverless — works 24/7 |

### Key Design Decisions

- **Agent always pays Proxo:** One payment address, one flow. Proxo handles downstream routing. The agent never touches x402 headers, browser sessions, or merchant payment forms.
- **Unified `buy` tool:** URL or description — Proxo resolves both. No separate search step. The agent says what it wants and gets a quote.
- **Receipts on every transaction:** Every purchase — x402 or Browserbase — produces a structured receipt with the same fields. Full transaction history is always available via `wallet_info`.
- **MCP-first:** Not a CLI, not a REST API (though one could be added). MCP is how agents discover and use tools natively. Ship as an MCP server and every major LLM can use it immediately.
- **Serverless browsers:** Browserbase runs checkout in the cloud. No dependency on any local machine.
- **Unique cent amounts as nonces:** The exact USDC amount (down to the cent) serves as a unique transaction identifier. $18.890742 is different from $18.890743. Simple, effective, no on-chain infrastructure needed.
- **Pre-saved payment method:** Browserbase checkout uses a pre-configured payment method in the browser profile. No card details are transmitted through the agent or MCP layer.

## Implementation Base: `coinbase/x402` MCP Example

Proxo is built on top of the official `coinbase/x402` monorepo (5.4k stars, 1.1k forks) — specifically the MCP server example at `examples/typescript/clients/mcp`. This is the most developer-loved x402 implementation, ships as modular npm packages, and already works with Claude Desktop out of the box.

### Why this repo over alternatives

We evaluated the full x402 ecosystem — MCPay (pay-per-call MCP infrastructure), elizaOS/mcp-gateway (MCP aggregator with x402 payments), Google's a2a-x402 (Agent-to-Agent payments), and several community wrappers. None are the right base:

- **MCPay** is a full product (registry, dashboard, Next.js, database). We need 4 MCP tools, not a platform.
- **elizaOS/mcp-gateway** is a multi-server aggregator. We're a single server doing one thing well.
- **Google a2a-x402** is a protocol extension, not a product. Future roadmap at best.

The `coinbase/x402` MCP example is ~100 lines of TypeScript and gives us the exact pattern we need: an MCP server that wraps HTTP requests with automatic x402 payment handling.

### What we get for free from `@x402/*` packages

| Package | What it does | How Proxo uses it |
|---------|-------------|-------------------|
| `@x402/fetch` | Wraps `fetch` with auto-402 interception | Proxo pays x402 services from its own wallet |
| `@x402/evm` | EVM signing via viem | Signs x402 payment headers + verifies USDC on Base |
| `@x402/extensions` | Bazaar discovery API | Agents discover x402 services; buy_sell wallets auto-list |
| `@modelcontextprotocol/sdk` | MCP server framework | Already used in the reference example we're forking |

### Proxo's addition: the auto-detect router

The official x402 client handles 402 responses. Proxo extends this with a routing layer — probe the URL, detect x402 or not, and execute the right path. The agent never sees any of this.

```typescript
async function executePurchase(url: string, options: PurchaseOptions) {
  // Step 1: Probe the URL
  const probe = await fetch(url, { method: 'HEAD' });

  if (probe.status === 402) {
    // x402-native — pay from Proxo's wallet (0.5% markup)
    const result = await x402Pay(url, options);
    return { ...result, route: "x402", fee_rate: "0.5%" };
  }

  // Not x402 — checkout via Browserbase + Stagehand (5% markup)
  const result = await browserCheckout(url, options.shipping);
  return { ...result, route: "browserbase", fee_rate: "5%" };
}
```

## Recommended Repo Structure

```
proxo/
├── packages/
│   ├── core/              # Types, routing logic, x402 detection, pricing, receipts
│   ├── x402/              # Thin wrapper on @x402/fetch — Proxo pays on behalf of agent
│   ├── checkout/           # Browserbase + Stagehand browser automation
│   ├── wallet/            # CDP Server Wallet creation, balance, buy vs buy_sell
│   └── mcp/               # MCP server — 4 tools (buy, confirm, create_wallet, wallet_info)
├── examples/
│   ├── claude-desktop/    # MCP config for Claude Desktop
│   └── agent-script/      # Standalone agent using Proxo
├── .env.example
├── package.json
└── README.md
```

## Constraints (v1)

- **$25 max per transaction** — limits financial exposure
- **Physical products + digital services** — anything with a web checkout or x402 endpoint
- **USDC on Base only** — fast (~2s), cheap (~$0.001), widely held
- **0.5% fee for x402 purchases** — Proxo pays the service, keeps the spread
- **5% fee for non-x402 purchases** — covers Browserbase sessions, Stagehand LLM inference, and margin
- **Agent always pays Proxo** — one wallet address, one flow, Proxo routes downstream
- **Receipts on every transaction** — structured receipt with product, merchant, route, price, fee, total, confirmation
- **US shipping only (v1)** — simplifies checkout flows for MVP
- **Two account types** — `buy` (purchase only) or `buy_sell` (purchase + receive payments via x402 Bazaar)

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Double-spend / replay | Unique cent-amount nonces; each amount can only be used once |
| Prompt injection | Agent communicates via structured MCP tool calls, not free text. No natural language hits the checkout flow. |
| Failed purchases | Monitored via Browserbase session replay. Manual refunds for v1; automated refund queue for v2. |
| Card fraud / abuse | $25 cap per transaction. Pre-saved payment method never exposed to agents. |
| Stagehand manipulation | Stagehand receives deterministic instructions from server code, not from agent input. Agent data (shipping info) is sanitized before injection. |
| Proxo wallet security | Proxo's hot wallet holds operational float only. Revenue swept to cold storage on schedule. |

## Competitive Landscape

| Solution | What it does | Gap Proxo fills |
|----------|-------------|-----------------|
| x402 (Coinbase) | Native stablecoin payments over HTTP | Only works if the seller has integrated x402 |
| ACP (Stripe/OpenAI) | Agentic checkout for opted-in merchants | Only works for merchants in the ACP network |
| Sponge (YC) | Agent wallets + business gateway for selling to agents | Requires businesses to onboard via Gateway; can't buy from arbitrary websites |
| Locus (YC F25) | Control layer for agent spending (policy, escrow, audit) | No purchasing capability; no sell-side marketplace |
| Coinbase Agentic Wallets | Agent wallets + x402 Bazaar payments | Only for x402-enabled services |
| **Proxo** | **Any URL. One USDC payment. Receipt back.** | **Bridges the 99.9% of the web that doesn't speak any agent protocol. Same agent flow for x402 and non-x402.** |

## Roadmap

### v1 (Ship today)

- MCP server with 4 tools (`buy`, `confirm`, `create_wallet`, `wallet_info`)
- Unified `buy` tool: accepts URL or description, returns quote
- Agent always pays Proxo's wallet — Proxo routes downstream
- x402 auto-detection: 0.5% markup
- Browserbase + Stagehand checkout for non-x402 sites: 5% markup
- Structured receipts on every transaction
- Full transaction history via `wallet_info`
- `create_wallet` with `buy` vs `buy_sell` account type
- CDP Server Wallet creation + auto-Bazaar publish for buy_sell accounts
- USDC on Base payment verification
- $25 cap, US only

### v2

- Automated refund queue for failed purchases
- Wallet-to-wallet transfers between Proxo agents
- Spending controls: daily budgets, per-tx limits
- Multiple payment methods / virtual cards

### v3

- Stripe Issuing integration (per-transaction virtual cards, eliminate personal card dependency)
- International shipping support
- Smart routing: x402 → ACP → browser automation (cheapest/fastest path wins)
- Approval workflows for human oversight
- Multi-agent treasury management (shared wallets, budgets, permissions)

## Why Now

- x402 just launched and has 15M+ transactions — agents are actively spending stablecoins
- Coinbase Agentic Wallets shipped last week — agents now have wallets by default
- Stripe ACP is onboarding merchants — but coverage is <1% of e-commerce
- Browserbase + Stagehand v3 makes browser automation reliable enough for production checkout flows
- The gap is clear: agents have money and intent, but most of the web can't accept their payments. Proxo is the bridge.
