#!/usr/bin/env sh
set -eu

for cmd in node npm git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "beerengineer install prerequisite missing: $cmd" >&2
    echo "Install Node.js 22+, npm, and Git, then rerun this command." >&2
    exit 1
  fi
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$SCRIPT_DIR/beerengineer.js" install --from-bootstrap posix "$@"
