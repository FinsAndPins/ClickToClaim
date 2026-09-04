#!/bin/bash
# Smoke-test a running intake server (local wrangler dev by default).
# Usage:
#   cd intake && npm run dev   # other terminal
#   ./scripts/smoke_local.sh
#   INTAKE_BASE_URL=https://sell.finsandpins.shop INVITE_CODE=yourcode ./scripts/smoke_local.sh

set -euo pipefail
BASE="${INTAKE_BASE_URL:-http://127.0.0.1:8787}"
INVITE="${INVITE_CODE:-local-dev}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "==> Smoke against $BASE"

curl -fsS "$BASE/health" | tee /tmp/intake_health.json
echo
python3 - <<'PY'
import json
h=json.load(open("/tmp/intake_health.json"))
assert h.get("ok") is True, h
print("health ok; moderation=", h.get("moderation"))
PY

# Establish invite cookie
code=$(curl -sS -o /tmp/invite_out.html -w "%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "$BASE/invite" --data-urlencode "code=$INVITE")
echo "invite POST -> $code (expect 302)"
home=$(curl -sS -o /tmp/home.html -w "%{http_code}" -b "$COOKIE_JAR" "$BASE/")
echo "home -> $home"
python3 - <<'PY'
from pathlib import Path
t=Path("/tmp/home.html").read_text()
assert "Sell your pin collection" in t, "home page missing headline"
assert "United States" in t, "US-only copy missing"
print("home copy ok")
PY

admin=$(curl -sS -o /tmp/admin.html -w "%{http_code}" "$BASE/admin")
echo "admin -> $admin (expect 200 locally with DEV_ADMIN_EMAIL)"
privacy=$(curl -sS -o /tmp/privacy.html -w "%{http_code}" -b "$COOKIE_JAR" "$BASE/privacy")
echo "privacy -> $privacy"
python3 - <<'PY'
from pathlib import Path
t=Path("/tmp/privacy.html").read_text()
assert "offer@finsandpins.shop" not in t, "offer email must not appear on public privacy page"
assert "finsandpins@gmail.com" not in t, "gmail must not appear on public privacy page"
print("privacy: no public emails")
PY

echo
echo "Smoke passed."
