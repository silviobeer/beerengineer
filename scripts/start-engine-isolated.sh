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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ENGINE="$SCRIPT_DIR/run-engine.sh"

if [[ ! -x "$RUN_ENGINE" ]]; then
  echo "[start-engine-isolated] $RUN_ENGINE not executable" >&2
  exit 1
fi

UNIT_NAME="beerengineer-engine"
MEM_HIGH="${BEERENGINEER_MEM_HIGH:-4G}"
MEM_MAX="${BEERENGINEER_MEM_MAX:-6G}"
CPU_QUOTA="${BEERENGINEER_CPU_QUOTA:-600%}"
IO_WEIGHT="${BEERENGINEER_IO_WEIGHT:-200}"

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
  --property="MemoryHigh=${MEM_HIGH}" \
  --property="MemoryMax=${MEM_MAX}" \
  --property="ManagedOOMSwap=kill" \
  --property="CPUQuota=${CPU_QUOTA}" \
  --property="IOWeight=${IO_WEIGHT}" \
  --setenv=BEERENGINEER_CODEX_SANDBOX_BYPASS="${BEERENGINEER_CODEX_SANDBOX_BYPASS:-true}" \
  --setenv=PATH="$PATH" \
  --setenv=HOME="$HOME" \
  -- "$RUN_ENGINE"
