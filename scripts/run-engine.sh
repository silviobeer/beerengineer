#!/usr/bin/env bash
# run-engine.sh — Runs the engine without tsx watch, restarts on crash.
#
# Use this instead of `npm run dev:engine` when running actual workflow runs.
# tsx watch restarts the engine whenever source files change on disk (including
# after git merges), which kills in-flight workers. This script uses start:api
# (plain tsx, no watcher) and only restarts on process exit.
#
# systemd Watchdog integration: when WATCHDOG_USEC is set (i.e. the service
# unit has WatchdogSec=), a background loop polls GET /health until the engine
# is up, then pings every WATCHDOG_USEC/2 and forwards sd_notify WATCHDOG=1.
# If the engine stops responding, systemd kills+restarts the service.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${ENGINE_LOG:-/tmp/beerengineer-engine.log}"
# Gap 7: Restart backoff — 3s was too short; Codex workers from the previous
# engine instance can take 60-90s to become stale. Restarting faster than that
# causes multiple orphanRecovery cycles to fire concurrently, saturating the
# event loop and triggering cascading Supabase timeouts.
# Use exponential backoff: first restart waits BASE_RESTART_DELAY, each
# subsequent crash within RESTART_RESET_WINDOW doubles the delay up to MAX.
BASE_RESTART_DELAY="${BEERENGINEER_RESTART_DELAY:-30}"
MAX_RESTART_DELAY="${BEERENGINEER_MAX_RESTART_DELAY:-120}"
RESTART_RESET_WINDOW=300   # seconds — reset backoff after a stable run this long
_restart_delay=$BASE_RESTART_DELAY
_last_start_ts=$(date +%s)

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

# Gap 1: distinguish a live/responsive engine from a zombie/frozen process
# holding the port. Kill the stale holder instead of refusing to start.
port_is_responsive() {
  curl -sf --max-time 3 "http://127.0.0.1:${ENGINE_PORT}/health" > /dev/null 2>&1
}

if ss -tlnp 2>/dev/null | grep -q ":${ENGINE_PORT} "; then
  if port_is_responsive; then
    echo "[engine-supervisor] FATAL: a live engine is already responding on port $ENGINE_PORT." >&2
    echo "[engine-supervisor]   ss -tlnp | grep :$ENGINE_PORT" >&2
    echo "[engine-supervisor]   lsof -ti :$ENGINE_PORT | xargs kill  # to stop it" >&2
    exit 1
  else
    echo "[engine-supervisor] WARNING: port $ENGINE_PORT is bound but not responding — killing stale holder." >&2
    lsof -ti :"$ENGINE_PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
    sleep 1
  fi
fi

# Gap 3: PID file — cross-check port ownership to detect recycled PIDs;
# use atomic write (write+rename) to avoid concurrent-startup race.
PID_FILE="/tmp/beerengineer-engine.pid"
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    # Cross-check: does this PID actually own the engine port?
    if ss -tlnp 2>/dev/null | grep -q "pid=${OLD_PID},"; then
      echo "[engine-supervisor] FATAL: PID $OLD_PID is alive and owns port $ENGINE_PORT." >&2
      exit 1
    else
      echo "[engine-supervisor] WARNING: PID $OLD_PID is alive but does not own port $ENGINE_PORT — stale PID file, continuing." >&2
    fi
  else
    echo "[engine-supervisor] removing stale PID file (old pid: ${OLD_PID:-unknown})." >&2
  fi
fi
# Atomic write via temp file + rename to avoid concurrent-startup race
echo "$$" > "${PID_FILE}.tmp"
mv -f "${PID_FILE}.tmp" "$PID_FILE"

echo "[engine-supervisor] starting (log: $LOG_FILE)" >&2

# Gap 5 + Gap 6: systemd watchdog loop.
# - Polls /health until the engine is ready (replaces fixed sleep 10).
# - Sends sd_notify WATCHDOG=1 every interval_s when healthy.
# - Logs a warning (not a fatal error) on each failed check.
# Gap 6: WATCHDOG_PID is captured and explicitly included in the EXIT trap.
watchdog_loop() {
  local interval_s=15
  if [ -n "${WATCHDOG_USEC:-}" ] && [ "$WATCHDOG_USEC" -gt 0 ] 2>/dev/null; then
    interval_s=$(( WATCHDOG_USEC / 2 / 1000000 ))
    [ "$interval_s" -lt 5 ] && interval_s=5
  fi

  # Poll until the engine is ready — don't ping systemd watchdog during startup
  local deadline=$(( $(date +%s) + 120 ))
  until curl -sf --max-time 4 "http://127.0.0.1:${ENGINE_PORT}/health" > /dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "[engine-watchdog] engine did not become ready within 120s" | tee -a "$LOG_FILE" >&2
      return 0  # supervisor will handle it via restart
    fi
    sleep 3
  done
  echo "[engine-watchdog] engine is ready, entering watchdog cadence (interval=${interval_s}s)" | tee -a "$LOG_FILE" >&2

  while true; do
    sleep "$interval_s"
    if curl -sf --max-time 4 "http://127.0.0.1:${ENGINE_PORT}/health" > /dev/null 2>&1; then
      if command -v systemd-notify > /dev/null 2>&1 && [ -n "${WATCHDOG_USEC:-}" ]; then
        systemd-notify WATCHDOG=1 2>/dev/null || true
      fi
    else
      echo "[engine-watchdog] /health check failed at $(date -Is) — engine may be frozen" | tee -a "$LOG_FILE" >&2
    fi
  done
}

watchdog_loop &
WATCHDOG_PID=$!

# Gap 6: update trap now that WATCHDOG_PID is known; kill it explicitly first.
trap 'kill "$WATCHDOG_PID" 2>/dev/null || true; rm -f "$PID_FILE"; kill -- -$$ 2>/dev/null || true' EXIT

while true; do
  _last_start_ts=$(date +%s)
  npm run start:api --workspace=@beerengineer/engine >> "$LOG_FILE" 2>&1
  EXIT_CODE=$?
  _now=$(date +%s)
  _uptime=$(( _now - _last_start_ts ))

  # Reset backoff if the engine ran stably for at least RESTART_RESET_WINDOW seconds
  if [ "$_uptime" -ge "$RESTART_RESET_WINDOW" ]; then
    _restart_delay=$BASE_RESTART_DELAY
    echo "[engine-supervisor] engine ran for ${_uptime}s — resetting restart backoff to ${_restart_delay}s" | tee -a "$LOG_FILE" >&2
  else
    echo "[engine-supervisor] engine ran for only ${_uptime}s (< ${RESTART_RESET_WINDOW}s) — increasing backoff" | tee -a "$LOG_FILE" >&2
  fi

  echo "[engine-supervisor] engine exited (code $EXIT_CODE) at $(date -Is), restarting in ${_restart_delay}s..." | tee -a "$LOG_FILE" >&2
  sleep "$_restart_delay"

  # Exponential backoff for rapid crash loops (double, cap at MAX)
  if [ "$_uptime" -lt "$RESTART_RESET_WINDOW" ]; then
    _restart_delay=$(( _restart_delay * 2 ))
    [ "$_restart_delay" -gt "$MAX_RESTART_DELAY" ] && _restart_delay=$MAX_RESTART_DELAY
  fi
done
