#!/usr/bin/env python3
"""Import Whatnot ledger rows (Board N Pin M) into Offerables15 inventory goneStems.

Additive only: never removes existing gone marks (manual pulls stay gone).

Usage:
  python3 import_whatnot_ledger.py ../ledgers/20260810_ledger.csv
  python3 import_whatnot_ledger.py ../ledgers/20260810_ledger.csv --source ledger_20260810 --dry-run
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOLD_JSON = ROOT / "sold-overlay" / "sold.json"
BOARDS_DIR = ROOT / "sold-overlay" / "boards"
FB_URL = (
    "https://fins-and-pins-click-to-claim-default-rtdb.firebaseio.com"
    "/showConfig/offerables15_inventory/goneStems.json"
)

BOARD_PIN_RE = re.compile(r"Board\s+(\d+)\s+Pin\s+(\d+)", re.I)
CANCELLED_RE = re.compile(r"cancel", re.I)


def norm_stem(stem: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", stem or "")


def pin_suffix(pin: int) -> str:
    return f"pin{pin:02d}" if pin < 10 else f"pin{pin}"


def load_board_map() -> dict[int, str]:
    sold = json.loads(SOLD_JSON.read_text(encoding="utf-8"))
    out: dict[int, str] = {}
    for b in sold.get("boards", []):
        board = int(b["board"])
        out[board] = b["stem"]
    return out


def crop_stem_for(board: int, pin: int, board_map: dict[int, str]) -> str | None:
    img = board_map.get(board)
    if not img:
        return None
    base = img.replace("IMG_", "img").lower()
    return f"{base}_{pin_suffix(pin)}"


def row_is_cancelled(row: dict[str, str]) -> bool:
    for key, val in row.items():
        if not val:
            continue
        lk = key.lower()
        if "cancel" in lk and CANCELLED_RE.search(val):
            return True
        if lk in ("status", "state", "order_status") and CANCELLED_RE.search(val):
            return True
    joined = " ".join(row.values())
    return bool(CANCELLED_RE.search(joined) and "uncancel" not in joined.lower())


def parse_board_pins_from_row(row: dict[str, str], min_board: int) -> list[tuple[int, int, str]]:
    found: list[tuple[int, int, str]] = []
    seen: set[tuple[int, int]] = set()
    for val in row.values():
        if not val:
            continue
        for m in BOARD_PIN_RE.finditer(val):
            board, pin = int(m.group(1)), int(m.group(2))
            if board < min_board:
                continue
            key = (board, pin)
            if key in seen:
                continue
            seen.add(key)
            found.append((board, pin, m.group(0)))
    return found


def parse_ledger_csv(path: Path, min_board: int = 48) -> list[dict]:
    rows_out: list[dict] = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise SystemExit(f"No CSV headers in {path}")
        for row in reader:
            if row_is_cancelled(row):
                continue
            for board, pin, label in parse_board_pins_from_row(row, min_board):
                rows_out.append({"board": board, "pin": pin, "label": label, "row": row})
    return rows_out


def fetch_existing() -> dict:
    with urllib.request.urlopen(FB_URL, timeout=120) as resp:
        return json.loads(resp.read().decode() or "{}")


def patch_firebase(updates: dict) -> None:
    req = urllib.request.Request(
        FB_URL,
        data=json.dumps(updates).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PATCH",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        resp.read()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("ledger_csv", type=Path, help="Whatnot ledger CSV path")
    ap.add_argument("--min-board", type=int, default=48)
    ap.add_argument("--source", default="ledger_import", help="Firebase source tag")
    ap.add_argument("--by", default="import_whatnot_ledger.py")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.ledger_csv.is_file():
        print(f"Missing ledger file: {args.ledger_csv}", file=sys.stderr)
        return 1

    board_map = load_board_map()
    parsed = parse_ledger_csv(args.ledger_csv, min_board=args.min_board)
    if not parsed:
        print("No Board N Pin M rows found (boards >= %d)." % args.min_board)
        return 1

    existing = fetch_existing()
    now = datetime.now(timezone.utc).isoformat()
    updates: dict[str, dict] = {}
    skipped_existing = 0
    unknown_board = 0

    for item in parsed:
        board, pin = item["board"], item["pin"]
        crop = crop_stem_for(board, pin, board_map)
        if not crop:
            unknown_board += 1
            continue
        key = norm_stem(crop)
        if key in existing or crop in existing:
            skipped_existing += 1
            continue
        updates[key] = {
            "gone": True,
            "crop_stem": crop,
            "at": now,
            "by": args.by,
            "source": args.source,
            "board": board,
            "pin": pin,
            "label": item["label"],
        }

    print(f"Parsed {len(parsed)} ledger pin refs (boards >= {args.min_board})")
    print(f"New marks to add: {len(updates)}")
    print(f"Already marked gone (kept): {skipped_existing}")
    if unknown_board:
        print(f"Skipped unknown board numbers: {unknown_board}")

    if args.dry_run:
        for k, v in sorted(updates.items(), key=lambda kv: (kv[1]["board"], kv[1]["pin"])):
            print(f"  {v['label']} -> {v['crop_stem']}")
        return 0

    if not updates:
        print("Nothing new to write.")
        return 0

    patch_firebase(updates)
    verify = fetch_existing()
    print(f"Firebase goneStems count now: {len(verify)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
