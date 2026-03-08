# Future Additions — Bloon

Features explicitly deferred from v1 to keep scope tight.

---

## v1.5 Candidates

### Exa.ai Product Search
- Exa.ai is already integrated as Stage 2.5 in the discovery pipeline (URL → product info extraction)
- This v1.5 addition is **search-first**: agents describe what they want ("wireless mouse under $20") instead of providing a URL
- Exa.ai `/search` returns product URLs → Bloon handles the purchase
- New endpoint: `POST /api/search` with `query` and `wallet_id`
- Requires `EXA_API_KEY` in .env (already used for discovery)

### API Key Authentication
- Optional `Authorization: Bearer <key>` header on all endpoints
- Generated per wallet at creation time
- Backwards-compatible — wallet_id-only access still works unless operator enables key requirement
- Needed before any public deployment

### Wallet Key Encryption
- Encrypt private keys in `~/.bloon/wallets.json` at rest
- Decrypt on demand using a master passphrase or env var
- Currently keys are plaintext with filesystem permissions only

### Human-in-the-Loop Approval
- Optional flag on wallet creation: `require_approval: true`
- When enabled, `POST /api/buy` returns a quote and holds until the human approves via the funding page or a webhook callback
- v1 is fully autonomous — the agent decides whether to confirm, no human approval step

### Rate Limiting
- Per wallet_id rate limits on buy/confirm
- Configurable in `~/.bloon/config.json`
- Prevents runaway spending even if wallet_id leaks

### Confirm Idempotency
- `POST /api/confirm` should be idempotent — calling it twice with the same `order_id` returns the existing receipt instead of double-executing
- Prevents race conditions where two confirm calls hit the server simultaneously
- v1 has no guard beyond order status check; v1.5 adds proper idempotency keys or mutex

### Webhook Notifications
- `POST /api/wallets` accepts optional `webhook_url`
- Bloon POSTs to the URL on: order confirmed, order completed, order failed
- Enables async workflows — agent doesn't need to poll

---

## v2.0 Candidates

### MCP Wrapper
- Thin MCP server that calls the REST API internally
- Exposes Bloon tools natively in Claude Desktop, Cursor, etc.
- Same 5 operations: create_wallet, check_balance, query, buy, confirm
- REST API remains the source of truth

### Spending Dashboard & Frontend
- Full React (or Next.js) frontend for operators and agents
- **Wallet overview** — balances, funding status, active sessions at a glance
- **Transaction history** — filterable/sortable table of all purchases with receipt details
- **Spending analytics** — charts for spend over time, spend by merchant/domain, fee breakdown (x402 vs browser), category tags
- **Budget controls** — set daily/weekly/monthly spend limits per wallet, alerts when thresholds are hit
- **Live activity feed** — real-time status of in-progress checkouts (quote → confirm → receipt)
- **Receipt viewer** — detailed receipt view with line items, screenshots from Browserbase sessions
- Served from the same Hono server (static build) or deployed separately
- Read-only for v2, write operations (create wallets, set limits, trigger refunds) in v2.5
- Auth via operator API key (reuses v1.5 auth system)

### Multi-Network Support
- Support Ethereum mainnet, Arbitrum, Optimism, Polygon
- Network selection per wallet or per transaction
- Automatic bridge detection for cross-chain transfers

### Multi-Currency
- Accept ETH, DAI, USDT alongside USDC
- Automatic conversion to USDC for payment (via DEX)
- Price quotes in multiple currencies

### PostgreSQL Storage
- Replace JSON files with PostgreSQL
- Enables multi-tenant, concurrent access, proper indexing
- Migration script from JSON → Postgres

### Cloud Deployment
- Hosted version with HTTPS and custom domains
- Docker container + docker-compose
- Environment-based config (no .env file in production)

---

## v3.0 Candidates

### Multi-Tenant
- Multiple operators, each with isolated wallets and billing
- Operator-level API keys and permissions
- Usage-based billing for the platform itself

### Agent SDKs
- TypeScript and Python SDKs wrapping the REST API
- Type-safe, with built-in retry logic and error handling
- Published to npm and PyPI

### Subscription Purchases
- Recurring payment schedules
- Auto-renewal with balance checks
- Cancellation and refund flows

### Price Comparison
- Query multiple merchants for the same product
- Return ranked results by price, shipping time, availability
- Requires Exa.ai or similar product search

### Bulk Purchasing
- Batch multiple orders in a single API call
- Optimized Browserbase session reuse
- Volume-based fee discounts
