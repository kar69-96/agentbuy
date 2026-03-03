#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRAWLING_DIR="$(dirname "$SCRIPT_DIR")"
FIRECRAWL_DIR="$CRAWLING_DIR/firecrawl/apps/api"

if [ ! -d "$FIRECRAWL_DIR" ]; then
  echo "Error: Firecrawl submodule not found at $FIRECRAWL_DIR"
  echo "Run: cd packages/crawling && git submodule update --init"
  exit 1
fi

# Check for required env vars — prefer GOOGLE_API_KEY_QUERY, fall back to GOOGLE_API_KEY
FIRECRAWL_LLM_KEY="${GOOGLE_API_KEY_QUERY:-${GOOGLE_API_KEY:-}}"
if [ -z "$FIRECRAWL_LLM_KEY" ]; then
  echo "Error: GOOGLE_API_KEY_QUERY or GOOGLE_API_KEY must be set (used for LLM extraction)"
  exit 1
fi

echo "Starting Firecrawl API from source..."
echo "  Directory: $FIRECRAWL_DIR"
echo "  Port: ${FIRECRAWL_PORT:-3002}"

cd "$FIRECRAWL_DIR"

# Install deps if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install
fi

# Export env vars for Firecrawl
export PORT="${FIRECRAWL_PORT:-3002}"
export USE_DB_AUTHENTICATION=false
export OPENAI_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
export OPENAI_API_KEY="$FIRECRAWL_LLM_KEY"
export MODEL_NAME="${FIRECRAWL_MODEL:-gemini-2.5-flash}"

# Start the API server
echo "Starting on port $PORT..."
pnpm run start &
FIRECRAWL_PID=$!

echo "Firecrawl PID: $FIRECRAWL_PID"
echo "$FIRECRAWL_PID" > "$CRAWLING_DIR/.firecrawl.pid"

# Wait for health check
echo "Waiting for Firecrawl to be ready..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
    echo "Firecrawl is ready on port $PORT"
    exit 0
  fi
  sleep 1
done

echo "Warning: Firecrawl did not respond to health check within 60s"
echo "It may still be starting up. Check: curl http://localhost:$PORT/health"
