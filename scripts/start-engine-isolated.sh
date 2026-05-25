#!/usr/bin/env bash
# start-engine-isolated.sh — Launch the engine inside a dedicated systemd user
# scope so it survives terminal-cgroup OOM kills.
#
# Background: when launched directly from a terminal (vte-spawn-*.scope),
# systemd-oomd treats the whole terminal cgroup as one OOM target. A
# memory-pressure spike from any worker tears down the entire scope — engine,
# supervisor, and all 9 in-flight runs together. This wrapper detaches the
# engine into its own --user --scope and sets MemoryHigh/MemoryMax so oomd
# reaps individual worker descendants instead of the engine root.
#
# Gap 4: if called from an interactive terminal, detach via setsid so that
# SIGHUP on session/terminal close does not propagate to the scope.
# Stdio is redirected to the engine log file in detached mode.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ENGINE="$SCRIPT_DIR/run-engine.sh"
ENGINE_LOG="${ENGINE_LOG:-/tmp/beerengineer-engine.log}"

if [[ ! -x "$RUN_ENGINE" ]]; then
  echo "[start-engine-isolated] $RUN_ENGINE not executable" >&2
  exit 1
fi

# Gap 4: if stdin or stdout is a terminal, re-exec via setsid to detach from
# the controlling terminal. The scope will survive session close / SIGHUP.
if [ -t 0 ] || [ -t 1 ]; then
  echo "[start-engine-isolated] interactive terminal detected — detaching with setsid (log: $ENGINE_LOG)" >&2
  exec setsid "$0" "$@" </dev/null >>"$ENGINE_LOG" 2>&1
fi

ENGINE_PORT=4100
CONFIG_FILE="$HOME/.config/beerengineer-nodejs/config.json"
if [ -f "$CONFIG_FILE" ] && [ -r "$CONFIG_FILE" ]; then
  PORT_FROM_CONFIG=$(node -e "try{const c=require('$CONFIG_FILE');process.stdout.write(String(c.enginePort||4100))}catch(e){process.stdout.write('4100')}" 2>/dev/null)
  if [ -n "$PORT_FROM_CONFIG" ]; then
    ENGINE_PORT="$PORT_FROM_CONFIG"
  fi
fi

# Gap 1: distinguish a live/responsive engine from a zombie/frozen process.
port_is_responsive() {
  curl -sf --max-time 3 "http://127.0.0.1:${ENGINE_PORT}/health" > /dev/null 2>&1
}

if ss -tlnp 2>/dev/null | grep -q ":${ENGINE_PORT} "; then
  if port_is_responsive; then
    echo "[start-engine-isolated] FATAL: a live engine is already responding on port $ENGINE_PORT." >&2
    echo "[start-engine-isolated]   ss -tlnp | grep :$ENGINE_PORT" >&2
    echo "[start-engine-isolated]   lsof -ti :$ENGINE_PORT | xargs kill  # to stop it" >&2
    exit 1
  else
    echo "[start-engine-isolated] WARNING: port $ENGINE_PORT is bound but not responding — killing stale holder." >&2
    lsof -ti :"$ENGINE_PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
    sleep 1
  fi
fi

UNIT_NAME="beerengineer-engine"
MEM_HIGH="${BEERENGINEER_MEM_HIGH:-8G}"
MEM_MAX="${BEERENGINEER_MEM_MAX:-10G}"
CPU_QUOTA="${BEERENGINEER_CPU_QUOTA:-600%}"
IO_WEIGHT="${BEERENGINEER_IO_WEIGHT:-200}"
WORKER_CAP="${BEERENGINEER_WORKER_CAP:-7}"

if systemctl --user is-active --quiet "${UNIT_NAME}.scope" 2>/dev/null; then
  echo "[start-engine-isolated] ${UNIT_NAME}.scope is already active — refusing to start a second one" >&2
  systemctl --user status "${UNIT_NAME}.scope" --no-pager | head -n 5 >&2
  exit 2
fi

echo "[start-engine-isolated] launching ${UNIT_NAME}.scope (MemoryHigh=$MEM_HIGH MemoryMax=$MEM_MAX CPUQuota=$CPU_QUOTA IOWeight=$IO_WEIGHT)" >&2

exec systemd-run --user \
  --unit="${UNIT_NAME}" \
  --scope \
  --collect \
  --property="KillMode=control-group" \
  --property="StandardOutput=append:${ENGINE_LOG}" \
  --property="StandardError=append:${ENGINE_LOG}" \
  --property="MemoryHigh=${MEM_HIGH}" \
  --property="MemoryMax=${MEM_MAX}" \
  --property="ManagedOOMSwap=auto" \
  --property="ManagedOOMMemoryPressure=auto" \
  --property="ManagedOOMPreference=avoid" \
  --property="CPUQuota=${CPU_QUOTA}" \
  --property="IOWeight=${IO_WEIGHT}" \
  --setenv=BEERENGINEER_CODEX_SANDBOX_BYPASS="${BEERENGINEER_CODEX_SANDBOX_BYPASS:-true}" \
  --setenv=BEERENGINEER_WORKER_CAP="${WORKER_CAP}" \
  --setenv=PATH="$PATH" \
  --setenv=HOME="$HOME" \
  -- "$RUN_ENGINE"
