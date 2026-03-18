#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/home/snehit/project/opencode-dashboard"

cleanup() {
  if [[ -n "${SYNC_PID:-}" ]] && kill -0 "$SYNC_PID" 2>/dev/null; then
    kill "$SYNC_PID" 2>/dev/null || true
  fi
  if [[ -n "${DEV_PID:-}" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill "$DEV_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

cd "$ROOT_DIR"

/home/snehit/.bun/bin/bun run sync:codex &
SYNC_PID=$!

/home/snehit/.bun/bin/bun run dev &
DEV_PID=$!

wait -n "$SYNC_PID" "$DEV_PID"
EXIT_CODE=$?

cleanup
exit "$EXIT_CODE"
