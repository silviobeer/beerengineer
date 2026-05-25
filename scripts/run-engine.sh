#!/usr/bin/env bash
# run-engine.sh — Runs the engine without tsx watch, restarts on crash.
#
# Use this instead of `npm run dev:engine` when running actual workflow runs.
# tsx watch restarts the engine whenever source files change on disk (including
# after git merges), which kills in-flight workers. This script uses start:api
# (plain tsx, no watcher) and only restarts on process exit.
#
# systemd Watchdog integration: when WATCHDOG_USEC is set (i.e. the service
# unit has WatchdogSec=), a background loop pings GET /health every
# WATCHDOG_USEC/2 microseconds and sends sd_notify WATCHDOG=1 via
# systemd-notify. If the engine stops responding, systemd kills+restarts it.

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
trap 'rm -f "$PID_FILE"; kill -- -$$ 2>/dev/null || true' EXIT

echo "[engine-supervisor] starting (log: $LOG_FILE)" >&2

# systemd watchdog: ping /health and forward WATCHDOG=1 to systemd-notify.
# Only active when WatchdogSec is set in the unit (WATCHDOG_USEC exported by systemd).
watchdog_loop() {
  local interval_s=15  # default: ping every 15s
  if [ -n "${WATCHDOG_USEC:-}" ] && [ "$WATCHDOG_USEC" -gt 0 ] 2>/dev/null; then
    # Use half the watchdog period as the ping interval (systemd recommendation)
    interval_s=$(( WATCHDOG_USEC / 2 / 1000000 ))
    [ "$interval_s" -lt 5 ] && interval_s=5
  fi
  # Wait for engine to come up before first ping
  sleep 10
  while true; do
    if curl -sf --max-time 4 "http://127.0.0.1:${ENGINE_PORT}/health" > /dev/null 2>&1; then
      # Notify systemd watchdog if available
      if command -v systemd-notify > /dev/null 2>&1 && [ -n "${WATCHDOG_USEC:-}" ]; then
        systemd-notify WATCHDOG=1 2>/dev/null || true
      fi
    else
      echo "[engine-watchdog] /health check failed at $(date -Is) — engine may be frozen" | tee -a "$LOG_FILE" >&2
    fi
    sleep "$interval_s"
  done
}

watchdog_loop &
WATCHDOG_PID=$!

while true; do
  npm run start:api --workspace=@beerengineer/engine >> "$LOG_FILE" 2>&1
  EXIT_CODE=$?
  echo "[engine-supervisor] engine exited (code $EXIT_CODE) at $(date -Is), restarting in ${RESTART_DELAY}s..." | tee -a "$LOG_FILE" >&2
  sleep "$RESTART_DELAY"
done
