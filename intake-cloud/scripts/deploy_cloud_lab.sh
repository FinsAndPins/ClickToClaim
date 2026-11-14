#!/usr/bin/env bash
# Deploy the SEPARATE cloud-lab intake Worker. Does not touch finsandpins-intake.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WR="${ROOT}/node_modules/.bin/wrangler"
KEYFILE="${KEYFILE:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/IntakeCloudPricing/.cloud_invoke_key}"

if [[ ! -x "$WR" ]]; then
  npm install
fi

echo "Creating D1 if needed (ignore error if exists)..."
"$WR" d1 create intake-cloud 2>/dev/null || true
echo "Creating R2 if needed..."
"$WR" r2 bucket create finsandpins-intake-cloud 2>/dev/null || true

echo
echo ">>> Paste the new database_id into wrangler.toml [[d1_databases]] database_id, then re-run if first time."
echo

# Migrate schemas (idempotent-ish)
for f in schema.sql schema_mac_handoff.sql schema_asking.sql schema_delivery.sql schema_finish_claim.sql schema_finish_collection_id.sql schema_seller_notes.sql schema_box_review_token.sql schema_early_detect.sql; do
  [[ -f "$f" ]] || continue
  echo "D1 migrate $f"
  "$WR" d1 execute intake-cloud --remote --file="./$f" || true
done

if [[ -f "$KEYFILE" ]]; then
  echo "Setting CLOUD_PRICE_INVOKE_KEY from keyfile..."
  "$WR" secret put CLOUD_PRICE_INVOKE_KEY --name finsandpins-intake-cloud < "$KEYFILE"
else
  echo "WARN: missing $KEYFILE — set with: npx wrangler secret put CLOUD_PRICE_INVOKE_KEY"
fi

echo "Set INVITE_CODE (same as prod or a lab-only code)..."
"$WR" secret put INVITE_CODE

echo "Deploying finsandpins-intake-cloud..."
"$WR" deploy

URL=$("$WR" deployments list 2>/dev/null | head -5 || true)
echo
echo "Done. Update PUBLIC_BASE_URL in wrangler.toml to the workers.dev URL if needed, then redeploy."
echo "Seller: workers.dev URL + ?invite=YOUR_CODE"
echo "Production sellmycollection.finsandpins.shop was NOT modified."
