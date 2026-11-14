#!/bin/bash
# One-command local setup for Sell My Collection intake.
# Run from anywhere:
#   bash intake/scripts/setup_local.sh
# Or:
#   cd intake && ./scripts/setup_local.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> intake local setup ($ROOT)"

if [[ ! -f .dev.vars ]]; then
  cp .dev.vars.example .dev.vars
  echo "Created .dev.vars from example (edit ship-to / emails if needed)."
else
  echo ".dev.vars already exists — leaving it alone."
fi

if [[ ! -d node_modules ]]; then
  npm install
else
  echo "node_modules present — skipping npm install (run npm install if deps look stale)."
fi

echo "Applying local D1 schema…"
npx wrangler d1 execute intake --local --file=./schema.sql

echo
echo "Done. Next:"
echo "  cd intake && npm run dev"
echo "  Seller:  http://127.0.0.1:8787/?invite=local-dev"
echo "  Staff:   http://127.0.0.1:8787/admin"
echo
echo "When ready for Cloudflare: see docs/HOME_DAY.md"
