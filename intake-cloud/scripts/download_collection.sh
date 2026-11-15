#!/bin/bash
# MacBook helper: download a collection's original photos after they pass moderation.
#
# Usage:
#   ./scripts/download_collection.sh COLLECTION_ID [OUT_DIR]
#
# Local:
#   INTAKE_BASE_URL=http://127.0.0.1:8787 ./scripts/download_collection.sh <id>
#
# Then drop OUT_DIR into the existing ClickToRequest / pricing watcher inbox.

set -euo pipefail
COLLECTION_ID="${1:-}"
if [[ -z "$COLLECTION_ID" ]]; then
  echo "Usage: $0 COLLECTION_ID [OUT_DIR]"
  exit 1
fi
BASE="${INTAKE_BASE_URL:-http://127.0.0.1:8787}"
OUT="${2:-$HOME/Desktop/Intake_${COLLECTION_ID}}"
mkdir -p "$OUT"
curl -fsS "$BASE/admin/collections/${COLLECTION_ID}/manifest.json" -o "$OUT/manifest.json"
python3 - "$BASE" "$OUT" <<'PY'
import json, os, sys, urllib.request
base, out = sys.argv[1], sys.argv[2]
with open(os.path.join(out, "manifest.json")) as f:
    data = json.load(f)
photos = data.get("photos") or []
print(f"Collection {data.get('collectionId')}  {data.get('seller_name')}  {len(photos)} photos")
for i, p in enumerate(photos, 1):
    name = os.path.basename(p.get("filename") or f"{p['id']}.jpg")
    dest = os.path.join(out, f"{i:03d}_{name}")
    url = base.rstrip("/") + p["url"]
    print(f"  {i}/{len(photos)} {name}")
    urllib.request.urlretrieve(url, dest)
print("Done:", out)
print("Next: drop this folder into the pricing watcher inbox.")
PY
