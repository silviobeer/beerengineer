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

echo "[engine-supervisor] starting (log: $LOG_FILE)" >&2

while true; do
  npm run start:api --workspace=@beerengineer/engine >> "$LOG_FILE" 2>&1
  EXIT_CODE=$?
  echo "[engine-supervisor] engine exited (code $EXIT_CODE) at $(date -Is), restarting in ${RESTART_DELAY}s..." | tee -a "$LOG_FILE" >&2
  sleep "$RESTART_DELAY"
done
