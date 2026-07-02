#!/usr/bin/env bash
# Copy shared Click To Request static assets into a show folder.
# Run after bootstrapping ClickToClaim/YYYYMMDD/ from a prior show template.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SHOW_ID="${1:?usage: sync_ctr_show_static.sh YYYYMMDD}"
DEST="${REPO}/${SHOW_ID}"

if [[ ! -d "$DEST" ]]; then
  echo "ERROR: show folder not found: $DEST" >&2
  exit 1
fi

STATIC="${REPO}/_show_static/collection-detection-app-square.png"
if [[ ! -f "$STATIC" ]]; then
  echo "ERROR: missing canonical asset: $STATIC" >&2
  exit 1
fi

cp -f "$STATIC" "${DEST}/collection-detection-app-square.png"
echo "Synced collection-detection-app-square.png -> ${DEST}/"
