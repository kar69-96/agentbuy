# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Bloon?

Bloon is a REST API (TypeScript/Hono) that lets AI agents purchase anything on the internet using a stored credit card. No API keys. No registration. Bloon discovers product info, calculates a 2% fee, and executes checkout via Browserbase cloud browser with Stagehand. Same interface, same receipt format for every purchase.

## Project Status

Active development. Specification lives in `plans/`. The `crawling` and `checkout` packages have working discovery pipelines. Closed source.

## Architecture

> **When:** Designing new features, understanding code flow, or answering "where does X live?" questions. Skim on first read; no need to re-read on every run.

### REST API (Hono) — NOT MCP

Bloon is API-first. MCP wrapper is planned for v2. The API has 3 JSON endpoints:

- `POST /api/query` — discover product info, options, required fields
- `POST /api/buy` — get purchase quote for any URL (does NOT spend)
- `POST /api/confirm` — execute purchase, get receipt

### Auth Model

No auth (single operator). API key auth planned for v1.5.

### Two-Phase Purchase

1. `POST /api/buy` → returns a quote (price, fee, total). Nothing is spent.
2. `POST /api/confirm` → executes browser checkout with credit card, returns receipt.

### Payment

All purchases go through **browser checkout**: Browserbase + Stagehand (Claude Sonnet 4). 2% fee. Fresh session per checkout. Domain-level page caching for repeat flows.

### Credential Placeholder System

> **When:** Working on `packages/checkout` or anything touching card/payment form fields.

LLM never sees real card numbers. Card fields are filled via Playwright CDP directly into the DOM — never through Stagehand's LLM. Non-card fields use Stagehand's `variables` parameter (`%var%` syntax) which substitutes at the execution layer. Real values come from `.env` and never enter the LLM context.

## Tech Stack

> **When:** Adding dependencies, debugging import/version issues, or choosing a library. Not needed for routine edits.

- **API Server:** Hono 4.x
- **Browser Automation:** @browserbasehq/stagehand + Browserbase
- **Browser LLM (Checkout):** Claude Sonnet 4 (via Stagehand)
- **Discovery LLM:** Gemini 2.5 Flash (Firecrawl extraction + Browserbase fallback)
- **HTML Processing:** cheerio + turndown (Browserbase fallback HTML→Markdown)
- **Gemini SDK:** @google/generative-ai (structured extraction)
- **Storage:** JSON files in `~/.bloon/` (chmod 600)

## Package Structure

> **When:** Creating new files, moving code, or deciding which package owns a piece of logic.

```
packages/
├── core/           # Types, fees, store (JSON persistence), config, concurrency pool
├── orchestrator/   # Business logic: query(), buy(), confirm(), buildReceipt()
├── crawling/       # Product discovery: Firecrawl + Exa.ai + Browserbase+Gemini fallback
│   ├── src/
│   │   ├── discover.ts              # Discovery orchestrator (3 attempts + repair path)
│   │   ├── exa.ts                   # Exa.ai Stage 2.5 extraction (parallel)
│   │   ├── extract.ts               # Firecrawl /v1/scrape wrapper
│   │   ├── browserbase-adapter.ts   # HTTP server: Playwright microservice (port 3003)
│   │   ├── browserbase-extract.ts   # Browserbase+Gemini fallback extraction
│   │   ├── parser-ensemble.ts       # Multi-source candidate scoring/ranking
│   │   ├── providers.ts             # Pluggable provider abstraction
│   │   ├── variant.ts               # Variant price resolution (Steps 2/3)
│   │   ├── constants.ts             # Patterns, schemas, selectors, limits
│   │   └── ...                      # client, crawl, helpers, poll, shopify, types
│   └── scripts/                     # start.sh, stop.sh, health.sh
├── checkout/       # Browserbase sessions, Stagehand, credential fills, domain cache, discovery
└── api/            # Hono server, routes, formatters, error handler
stubs/
├── wallet/         # (archived) viem wallet package — moved here during credit-card-only migration
└── x402/           # (archived) x402 payment package — moved here during credit-card-only migration
```

## Key Design Decisions

> **When:** Proposing architectural changes, questioning why something works a certain way, or considering alternatives. Not needed for routine bug fixes.

- **API-first, not MCP** — curl-testable, language-agnostic, simpler debugging. MCP wrapper in v2.
- **No auth** — single operator mode. API key auth in v1.5.
- **Credit card only** — all payments via browser checkout with stored card credentials. Blockchain/USDC removed.
- **Fresh Browserbase sessions** — destroyed after each checkout. Domain-level page caching (cookies/localStorage) for repeat flows.
- **Shipping per-purchase** — custom shipping in buy request. No defaults. Returns `SHIPPING_REQUIRED` if missing for physical items.

## Constraints (v1)

> **When:** Evaluating whether a feature or behavior is in scope for v1, or when a user asks "can Bloon do X?"

- No API key auth
- No rate limiting
- JSON file storage (no database)
- Localhost only (deploy behind reverse proxy for production)

## Rules
- Never build site specific adaptors, always build agnostic

## Security — ALWAYS APPLIES

> **When:** Every run. These rules are non-negotiable regardless of task.

- LLM must NEVER see real card numbers — use the placeholder system (`x_card_number`, etc.)
- Agent data (shipping info) MUST be sanitized before passing as Stagehand variables
- Card fields are filled via Playwright CDP, never through Stagehand's LLM
- Card credentials stored in `.env` — never commit `.env` to source control

## Workflows

### Adding an API Endpoint

> **When:** Adding or modifying API routes in `packages/api`. Skip for non-API work.

1. Define request/response types in `packages/core/src/types.ts`
2. Implement business logic in the relevant package (checkout or crawling)
3. Create route handler in `packages/api/src/routes/`
4. Wire the route in `packages/api/src/server.ts`
5. Test with curl

### Testing a Browser Checkout Flow

> **When:** Working on `packages/checkout` or browser automation. Skip for non-checkout work.

1. Use Browserbase session replay to verify each step
2. Test with a known product URL and fixed shipping info
3. Confirm receipt fields match the unified format
4. Verify LLM conversation log has zero real credential values
5. Check that no agent-provided data leaks into unintended form fields

## Final Steps

> **When:** After finishing any task that touches source code (implementation, bug fix, refactor). Skip for documentation-only or plan-only changes.

Run these in order after finishing any code task:

0. **Only if API endpoints were added, changed, or removed:** update `/docs/skill.md` to reflect the current endpoints.
1. `pnpm type-check` — fix any TypeScript errors before proceeding
2. `pnpm lint` — fix any linting errors related to your changes
3. `pnpm format` — ensure consistent formatting
4. `pnpm test` — ensure no regressions
5. Update `plans/Progress.md` — record what was built, test results, and any checklist changes
6. **Update the "Test Updates" section** in `plans/Progress.md` — this section at the top of the file should be overwritten with the latest test results (pass/fail counts, failing test details, recent fixes). It is the single source of truth for current test status.

## Gotchas

> **When:** Working on the related package. Each bullet applies to a specific area — only consult the relevant ones.

- Browserbase sessions are cloud-hosted — never assume local filesystem access in `packages/checkout`
- Fresh Browserbase sessions mean no login state — checkout must work as guest
- Domain cache stores cookies/localStorage only — never cache auth tokens

## Testing

> **When:** Writing tests, debugging test failures, or running the test suite. Not needed for non-test work.

### Pre-flight: Start Firecrawl + Browserbase Adapter

Before running any discovery/crawling tests (bulk URL tests, e2e discovery tests, or anything that hits real sites), ensure the Firecrawl server and Browserbase adapter are running:

```bash
# 1. Start Firecrawl + Browserbase adapter (single command, starts both)
pnpm firecrawl:start

# 2. Verify they're healthy
pnpm firecrawl:health                              # Firecrawl on :3002
curl -sf http://localhost:3003/health && echo OK    # Browserbase adapter on :3003
```

**Required env vars** (must be set before starting):
- `GOOGLE_API_KEY_QUERY` or `GOOGLE_API_KEY` — for Firecrawl LLM extraction + Gemini fallback
- `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` — for Browserbase adapter (JS rendering, bot-bypass)
- `EXA_API_KEY` — for Exa.ai Stage 2.5 (optional, tier skipped if not set)
- `FIRECRAWL_API_KEY` — defaults to `fc-selfhosted` for local Firecrawl

**After testing**, stop the services:
```bash
pnpm firecrawl:stop
```

If the adapter is not running, Firecrawl's Browserbase+Gemini repair path will fail silently (`fetch failed`), and many URLs that would otherwise pass will return null. Unit tests (`pnpm test`) do not require these services — they use mocks.

### General Testing Notes

- Always test on real websites (Shopify → Target → Best Buy → Amazon)
- Each build phase has a test gate — don't proceed until all pass
- Use curl for all API testing
- See `plans/07-testing-guidelines.md` and `plans/14-phased-build-plan.md` for details

## Plans Reference

> **When:** You need detailed specs beyond what's in this file. Look up the relevant doc rather than guessing.

All specification docs are in `plans/`:

| Doc | Contents |
|-----|----------|
| `01-mvp-scope.md` | What's in/out for v1 |
| `02-user-flow.md` | Step-by-step user flows |
| `03-technical-spec.md` | Architecture, stack, package structure |
| `04-roadmap.md` | v1 → v1.5 → v2 → v3 |
| `05-future-additions.md` | Deferred features by version |
| `06-human-dependencies.md` | What the operator needs to set up |
| `07-testing-guidelines.md` | Test categories, websites, security checks |
| `08-api-reference.md` | Full REST API with curl examples |
| `09-data-models.md` | TypeScript interfaces |
| `10-environment-setup.md` | .env, prerequisites, running the server |
| `11-security-model.md` | Threat model, credential flow |
| `12-computer-use.md` | Browserbase + Stagehand deep dive (Phase 4) |
| `13-error-handling.md` | Error codes, HTTP statuses, recovery |
| `14-phased-build-plan.md` | 7 phases with test gates |
| `16-firecrawl-discovery.md` | Firecrawl pipeline: retry strategy, confidence thresholds, Browserbase repair, candidate ranking, failure tracking |
| `17-query-endpoint.md` | Query endpoint deep dive: discovery pipeline |
| `18-agentmail.md` | AgentMail integration for checkout email verification codes |
| `18-firecrawl-server.md` | Running self-hosted Firecrawl + Browserbase adapter (start/stop, ports, config) |
| `19-exa-discovery.md` | Exa.ai Stage 2.5 discovery: pipeline position, implementation, env vars |
| `20-orchestrator.md` | Orchestrator package: query/buy/confirm business logic, receipts |
| `21-discovery-pipeline.md` | Unified discovery pipeline reference: all 4 tiers, failure codes, env vars, files |
| `endpoints/query-endpoint.md` | Full query endpoint pipeline: all stages, env vars, scoring weights, failure codes |
| `skill.md` | Agent-facing API quick reference (lives in `/docs/skill.md`) |

## Documentation Sync

> **When:** Exiting plan mode after a major architectural change has been planned.

Do both:

1. **Update `plans/`** — review all markdown files in `plans/` and update any that are affected by the change (data models, API reference, user flows, roadmap, etc.)
2. **Update `docs/skill.md`** — if the change is client-facing and adjusts how end-users interact with the platform (API endpoints, request/response shapes, error codes, workflows), update `docs/skill.md` to match the current implementation

## Preferences
- Internal docs should be in /plans and user-facing docs should be in /docs
