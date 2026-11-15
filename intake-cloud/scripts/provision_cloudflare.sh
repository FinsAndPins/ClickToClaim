#!/bin/bash
# Interactive Cloudflare provision helper for intake.
# Requires: wrangler logged in (`npx wrangler login`).
# Does NOT print or ask for API keys in a way that gets committed.
#
#   cd intake && ./scripts/provision_cloudflare.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Cloudflare provision for finsandpins-intake"
echo "You must already have run: npx wrangler login"
echo

read -r -p "Create/use D1 database named 'intake'? [Y/n] " ans
ans=${ans:-Y}
if [[ "$ans" =~ ^[Yy]$ ]]; then
  echo "Creating D1 (safe if it already exists — ignore duplicate errors)…"
  npx wrangler d1 create intake || true
  echo
  echo "Copy the database_id UUID from the output above into wrangler.toml:"
  echo "  [[d1_databases]] → database_id = \"…\""
  echo
fi

read -r -p "Create/use R2 bucket 'finsandpins-intake'? [Y/n] " ans
ans=${ans:-Y}
if [[ "$ans" =~ ^[Yy]$ ]]; then
  npx wrangler r2 bucket create finsandpins-intake || true
fi

read -r -p "Apply schema.sql to REMOTE D1 now? (needs database_id in wrangler.toml) [y/N] " ans
ans=${ans:-N}
if [[ "$ans" =~ ^[Yy]$ ]]; then
  npx wrangler d1 execute intake --remote --file=./schema.sql
fi

echo
echo "Set secrets (paste when prompted — never commit these):"
echo "  npx wrangler secret put GOOGLE_VISION_API_KEY"
echo "  npx wrangler secret put RESEND_API_KEY"
echo "  npx wrangler secret put INVITE_CODE"
echo
echo "Then set production vars in Cloudflare dashboard or:"
echo "  PUBLIC_BASE_URL=https://sell.finsandpins.shop"
echo "  ENVIRONMENT=production"
echo "See docs/HOME_DAY.md for DNS + Access + deploy."
