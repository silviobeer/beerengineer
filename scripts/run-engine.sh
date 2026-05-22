#!/usr/bin/env bash
# run-engine.sh — Runs the engine without tsx watch, restarts on crash.
#
# Use this instead of `npm run dev:engine` when running actual workflow runs.
# tsx watch restarts the engine whenever source files change on disk (including
# after git merges), which kills in-flight workers. This script uses start:api
# (plain tsx, no watcher) and only restarts on process exit.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${ENGINE_LOG:-/tmp/beerengineer-engine.log}"
RESTART_DELAY=3

cd "$REPO_ROOT"

# Auto-detect common tool directories and add to PATH
for dir in "$HOME/.npm-global/bin" "$HOME/.cargo/bin" "$HOME/.local/bin"; do
  if [ -d "$dir" ] && [ -r "$dir" ] && [[ ":$PATH:" != *":$dir:"* ]]; then
    export PATH="$PATH:$dir"
  fi
done

ENGINE_PORT=4100
CONFIG_FILE="$HOME/.config/beerengineer-nodejs/config.json"
if [ -f "$CONFIG_FILE" ] && [ -r "$CONFIG_FILE" ]; then
  PORT_FROM_CONFIG=$(node -e "try{const c=require('$CONFIG_FILE');process.stdout.write(String(c.enginePort||4100))}catch(e){process.stdout.write('4100')}" 2>/dev/null)
  if [ -n "$PORT_FROM_CONFIG" ]; then
    ENGINE_PORT="$PORT_FROM_CONFIG"
  fi
fi

if ss -tlnp 2>/dev/null | grep -q ":$ENGINE_PORT "; then
  echo "[engine-supervisor] FATAL: port $ENGINE_PORT is already in use." >&2
  echo "[engine-supervisor] The engine is likely already running. Check:" >&2
  echo "[engine-supervisor]   ss -tlnp | grep :$ENGINE_PORT" >&2
  echo "[engine-supervisor] To kill the existing process:" >&2
  echo "[engine-supervisor]   lsof -ti :$ENGINE_PORT | xargs kill" >&2
  exit 1
fi

PID_FILE="/tmp/beerengineer-engine.pid"
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[engine-supervisor] FATAL: PID file $PID_FILE exists and process $OLD_PID is alive." >&2
    exit 1
  fi
fi
echo "$$" > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

echo "[engine-supervisor] starting (log: $LOG_FILE)" >&2

while true; do
  npm run start:api --workspace=@beerengineer/engine >> "$LOG_FILE" 2>&1
  EXIT_CODE=$?
  echo "[engine-supervisor] engine exited (code $EXIT_CODE) at $(date -Is), restarting in ${RESTART_DELAY}s..." | tee -a "$LOG_FILE" >&2
  sleep "$RESTART_DELAY"
done
