#!/usr/bin/env bash
# One command to run the whole stack: free ports -> build -> start gateway + studio.
# Studio hot-reloads (frontend edits need no restart). After backend edits,
# just re-run `pnpm dev`. Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GATEWAY_PORT="${GATEWAY_PORT:-4400}"
STUDIO_PORT="${STUDIO_PORT:-3100}"

free_port() { lsof -ti "tcp:$1" 2>/dev/null | xargs kill -9 2>/dev/null || true; }

echo "[dev] freeing ports ${GATEWAY_PORT} and ${STUDIO_PORT}"
free_port "$GATEWAY_PORT"
free_port "$STUDIO_PORT"

echo "[dev] building packages (turbo cache makes this fast)"
pnpm build

cleanup() {
  echo ""
  echo "[dev] shutting down"
  free_port "$GATEWAY_PORT"
  free_port "$STUDIO_PORT"
  pkill -P $$ 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "[dev] starting gateway on :${GATEWAY_PORT} (loads .env: LLM + ANDROID_HOME)"
PORT="$GATEWAY_PORT" pnpm --filter @oas/gateway start &

echo "[dev] starting studio on :${STUDIO_PORT}"
PORT="$STUDIO_PORT" NEXT_PUBLIC_GATEWAY_URL="http://localhost:${GATEWAY_PORT}" \
  pnpm --filter @oas/studio dev &

echo ""
echo "  Studio   -> http://localhost:${STUDIO_PORT}"
echo "  Gateway  -> http://localhost:${GATEWAY_PORT}"
echo "  (Ctrl+C stops both)"
echo ""
wait
