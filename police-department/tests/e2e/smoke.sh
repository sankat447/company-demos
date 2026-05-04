#!/usr/bin/env bash
# =============================================================================
#  smoke.sh — wrapper that runs bootstrap/05_smoke.sh.
#  Kept as a thin entrypoint so CI invokes a stable path
#  (tests/e2e/smoke.sh) regardless of how the bootstrap layout evolves.
# =============================================================================
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
ROOT="$(cd "$DIR/../.." && pwd)"
exec bash "$ROOT/bootstrap/05_smoke.sh" "$@"
