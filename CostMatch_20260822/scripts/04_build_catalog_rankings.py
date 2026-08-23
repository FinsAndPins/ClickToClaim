#!/usr/bin/env python3
"""Build full per-sold-pin inventory rankings for CostMatch pick UI.

Merges v2 visual scores with lightweight eBay-title token hints.
Writes exports/catalog_rankings.json only — does not touch proposals.json.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / "exports"

STOP = {
    "disney", "pin", "pins", "le", "limited", "edition", "the", "and", "for",
    "with", "new", "d23", "expo", "2026", "wdcs", "twdc", "dec", "wdi", "mog",
    "dssh", "dsf", "in", "hand", "exclusive", "series", "jumbo", "mini",
    "authentic", "logo", "rare", "sold", "out", "pin", "pins", "store",
}


def tokens(title: str) -> set[str]:
    raw = re.findall(r"[a-z0-9]+", (title or "").lower())
    return {t for t in raw if len(t) >= 3 and t not in STOP}


def main() -> None:
    sold = json.loads((EXPORTS / "sold_ctr_pins.json").read_text(encoding="utf-8"))
    inv = json.loads((EXPORTS / "inventory_units.json").read_text(encoding="utf-8"))
    v2_path = EXPORTS / "proposals_v2.json"
    visual: dict[str, dict[str, float]] = {}
    if v2_path.is_file():
        props = json.loads(v2_path.read_text(encoding="utf-8")).get("proposals") or []
        for p in props:
            stem = p.get("crop_stem") or ""
            visual[stem] = {
                c["inventory_key"]: float(c.get("score") or 0)
                for c in (p.get("candidates") or [])
            }

    inv_by_key = {r["inventory_key"]: r for r in inv}
    sold_rows = []
    rankings: dict[str, list[dict]] = {}

    for s in sold:
        stem = s.get("crop_stem") or ""
        if not stem:
            continue
        sold_rows.append(s)
        title_toks = tokens(s.get("listing_title") or "")
        vis = visual.get(stem, {})
        rows: list[dict] = []
        for ir in inv:
            key = ir["inventory_key"]
            board = str(ir.get("board_id") or "").lower()
            blob = f"{key} {board} {ir.get('crop_stem') or ''}".lower()
            text_hits = sum(1 for t in title_toks if t in blob)
            text_score = min(1.0, text_hits / max(1, min(6, len(title_toks))))
            vscore = vis.get(key, 0.0)
            # Title hint is weak (inventory keys lack character names) but helps board ids.
            hybrid = round(0.55 * vscore + 0.45 * text_score, 4)
            rows.append(
                {
                    "inventory_key": key,
                    "thumb": ir.get("thumb") or "",
                    "catalog_cost": ir.get("catalog_cost"),
                    "board_id": ir.get("board_id") or "",
                    "score": hybrid,
                    "visual_score": round(vscore, 4) if vscore else None,
                    "text_score": round(text_score, 4) if text_score else None,
                }
            )
        rows.sort(key=lambda r: (-r["score"], r["inventory_key"]))
        rankings[stem] = rows

    out = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "method": "visual_v2_plus_title_token_hint",
        "sold_count": len(sold_rows),
        "inventory_count": len(inv),
        "sold": sold_rows,
        "rankings": rankings,
    }
    path = EXPORTS / "catalog_rankings.json"
    path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {path} ({len(sold_rows)} sold × {len(inv)} inventory rows each)")


if __name__ == "__main__":
    main()
