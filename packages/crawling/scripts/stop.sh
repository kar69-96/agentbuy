#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRAWLING_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$CRAWLING_DIR/.firecrawl.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping Firecrawl (PID $PID)..."
    kill "$PID"
    rm -f "$PID_FILE"
    echo "Firecrawl stopped."
  else
    echo "Firecrawl process $PID not running. Cleaning up PID file."
    rm -f "$PID_FILE"
  fi
else
  echo "No PID file found. Firecrawl may not be running."
  # Try to find and kill by port
  PID=$(lsof -ti :${FIRECRAWL_PORT:-3002} 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo "Found process $PID on port ${FIRECRAWL_PORT:-3002}, stopping..."
    kill "$PID"
    echo "Stopped."
  fi
fi
