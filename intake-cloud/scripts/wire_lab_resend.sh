#!/usr/bin/env bash
# Put RESEND_API_KEY on finsandpins-intake-cloud without echoing the value.
# Usage (from a Terminal that already has the key; do not paste into chat):
#   printenv RESEND_API_KEY | ./scripts/wire_lab_resend.sh
#   # or:
#   ./scripts/wire_lab_resend.sh   # then paste key, Enter, Ctrl-D
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WR="${ROOT}/node_modules/.bin/wrangler"
if [[ ! -x "$WR" ]]; then
  npm install
fi
echo "Reading RESEND_API_KEY from stdin (not echoed)…"
"$WR" secret put RESEND_API_KEY
echo "Checking /health email field…"
curl -sS "https://finsandpins-intake-cloud.finsandpins.workers.dev/health" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("email=", d.get("email"), "moderation=", d.get("moderation"))'
