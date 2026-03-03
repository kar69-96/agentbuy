# Environment Setup — Bloon v1

## Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)
- A wallet app (Coinbase Wallet or MetaMask) with Base Sepolia network added

## .env.example

```env
# ---- Payment Credentials (never exposed to LLM) ----
CARD_NUMBER=4111111111111111
CARD_EXPIRY=12/25
CARD_CVV=123
CARDHOLDER_NAME=John Doe

# ---- Billing Address ----
BILLING_STREET=123 Main St
BILLING_CITY=Austin
BILLING_STATE=TX
BILLING_ZIP=78701
BILLING_COUNTRY=US

# ---- Shipping ----
# No default shipping. Shipping must be provided per-purchase in the buy request.
# Browser route purchases for physical items will fail with SHIPPING_REQUIRED if omitted.

# ---- API Keys ----
ANTHROPIC_API_KEY=sk-ant-...
BROWSERBASE_API_KEY=bb_live_...
BROWSERBASE_PROJECT_ID=proj_...
FIRECRAWL_API_KEY=fc-...           # Optional. Enables Firecrawl as primary discovery tier.
GOOGLE_API_KEY=...                 # For Stagehand LLM (Gemini 2.5 Flash)

# ---- Blockchain ----
BASE_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
NETWORK=base-sepolia

# ---- Server ----
PORT=3000

# ---- Bloon Master Wallet (auto-generated on first run if not set) ----
BLOON_MASTER_PRIVATE_KEY=0x...
```

## USDC Contracts

| Network | Address |
|---------|---------|
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base Mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Getting Test USDC

1. Get Base Sepolia ETH: https://www.alchemy.com/faucets/base-sepolia
2. Get test USDC: mint from test contract or faucet
3. Fund both: your personal wallet (for QR scanning) AND the Bloon master wallet

## Running the Server

```bash
# Install
pnpm install

# Build
pnpm -r build

# Start (production)
node packages/api/dist/index.js
# → Server running on http://localhost:3000

# Start (development, with hot reload)
pnpm --filter @bloon/api dev
```

## Data Directory

```
~/.bloon/
├── config.json       # Master wallet, network, settings
├── wallets.json      # Agent wallets (including private keys)
├── orders.json       # All orders and receipts
└── cache/            # Domain page cache
    ├── amazon.com.json
    └── target.com.json
```

Created automatically on first run with `chmod 600`.

## pnpm Workspace

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

## TypeScript Base Config

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

## Testing the API

```bash
# Create a wallet
curl -X POST http://localhost:3000/api/wallets \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"Test"}'

# Check balance
curl http://localhost:3000/api/wallets/WALLET_ID

# Open funding page in browser
open http://localhost:3000/fund/FUNDING_TOKEN

# Get a quote
curl -X POST http://localhost:3000/api/buy \
  -H "Content-Type: application/json" \
  -d '{"url":"https://target.com/p/...","wallet_id":"WALLET_ID"}'

# Execute purchase
curl -X POST http://localhost:3000/api/confirm \
  -H "Content-Type: application/json" \
  -d '{"order_id":"ORDER_ID"}'
```
