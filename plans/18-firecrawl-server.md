# Running the Firecrawl Server

How to set up, start, and operate the self-hosted Firecrawl instance used by Bloon's product discovery pipeline.

## Prerequisites

- Node.js 18+
- pnpm
- Git (for submodule)
- A Google API key (`GOOGLE_API_KEY` or `GOOGLE_API_KEY_QUERY`) for LLM extraction via Gemini

Optional (for JS-rendered pages):
- `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` — enables the Browserbase adapter that gives Firecrawl headless Chrome rendering

## One-Time Setup

### 1. Initialize the submodule

The Firecrawl source lives as a git submodule at `packages/crawling/firecrawl/`.

```bash
cd packages/crawling
git submodule update --init
```

This clones the [mendableai/firecrawl](https://github.com/mendableai/firecrawl) repo into `packages/crawling/firecrawl/`.

### 2. Set environment variables

Add to your `.env` (see `.env.example`):

```env
# Required — LLM key for extraction (Gemini)
GOOGLE_API_KEY=AIza...
# Or use a separate key just for query/discovery:
# GOOGLE_API_KEY_QUERY=AIza...

# Firecrawl connection (defaults shown)
FIRECRAWL_BASE_URL=http://localhost:3002
FIRECRAWL_API_KEY=fc-test   # any non-empty string works for self-hosted

# Optional — Browserbase for JS rendering
BROWSERBASE_API_KEY=bb_live_...
BROWSERBASE_PROJECT_ID=proj_...
```

**Note:** `FIRECRAWL_API_KEY` must be set (any value) or the crawling package skips Firecrawl entirely. For self-hosted, the key isn't validated — it just needs to be non-empty.

## Starting the Server

From the repo root:

```bash
pnpm firecrawl:start
```

This runs `packages/crawling/scripts/start.sh`, which:

1. Checks the submodule exists at `packages/crawling/firecrawl/apps/api`
2. Verifies `GOOGLE_API_KEY_QUERY` or `GOOGLE_API_KEY` is set
3. Starts the **Browserbase adapter** on port 3003 (if Browserbase keys are set)
4. Installs Firecrawl deps (`pnpm install` in the submodule, first run only)
5. Starts the **Firecrawl API** on port 3002 (default)
6. Waits up to 60s for the health check to pass

### What gets started

| Process | Port | Purpose |
|---------|------|---------|
| Firecrawl API | 3002 (default) | `/v1/scrape`, `/v1/crawl` endpoints |
| Browserbase adapter | 3003 (default) | Playwright microservice for JS rendering |

### Custom ports

```bash
FIRECRAWL_PORT=4000 pnpm firecrawl:start    # Firecrawl on port 4000
ADAPTER_PORT=4001 pnpm firecrawl:start      # Adapter on port 4001
```

If you change `FIRECRAWL_PORT`, also update `FIRECRAWL_BASE_URL` in `.env` to match.

### Custom LLM model

The default model is `gemini-2.5-flash`. Override with:

```bash
FIRECRAWL_MODEL=gemini-2.0-flash pnpm firecrawl:start
```

## Health Check

```bash
pnpm firecrawl:health
```

Or manually:

```bash
curl http://localhost:3002/health
```

## Stopping the Server

```bash
pnpm firecrawl:stop
```

This kills both the Firecrawl API and the Browserbase adapter (if running). It reads PIDs from `.firecrawl.pid` and `.adapter.pid` in `packages/crawling/`, or falls back to finding processes by port.

## Troubleshooting

### Server won't start

- **"Firecrawl submodule not found"** — Run `cd packages/crawling && git submodule update --init`
- **"GOOGLE_API_KEY must be set"** — Add `GOOGLE_API_KEY` or `GOOGLE_API_KEY_QUERY` to `.env`
- **Port already in use** — Run `pnpm firecrawl:stop` first, or check `lsof -ti :3002`

### Health check fails after start

The server can take 30-60s to become ready on first launch (dep installation + startup). If the startup script's 60s timeout expires:

```bash
# Check if the process is still running
cat packages/crawling/.firecrawl.pid | xargs kill -0 2>/dev/null && echo "running" || echo "dead"

# Retry health check
curl http://localhost:3002/health
```

### Firecrawl tier is being skipped

The crawling package checks `FIRECRAWL_API_KEY` at runtime. If it's empty/unset, Firecrawl discovery is skipped and falls through to server-side scrape → Browserbase. Make sure `.env` has a non-empty `FIRECRAWL_API_KEY`.

### Browserbase adapter not starting

If you see "Warning: BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID not set", Firecrawl will still work but only with fetch-based scraping (no JavaScript rendering). Set both keys to enable the adapter.

## Self-Hosted vs Cloud

| | Self-Hosted | Cloud |
|---|---|---|
| URL | `http://localhost:3002` | `https://api.firecrawl.dev` |
| API key | Any non-empty string | Real `fc-...` key from firecrawl.dev |
| Rate limits | None | Per-plan limits |
| Credits | Unlimited | Per-plan credits |
| Fire Engine (anti-bot) | Not available | Available |
| LLM | Your Gemini key | Firecrawl's built-in |
| JS rendering | Via Browserbase adapter (optional) | Built-in |

To switch to cloud, update `.env`:

```env
FIRECRAWL_BASE_URL=https://api.firecrawl.dev
FIRECRAWL_API_KEY=fc-your-real-key
```

No server startup needed — the crawling package connects to the cloud API directly.
