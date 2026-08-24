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
    v1_path = EXPORTS / "proposals.json"
    visual: dict[str, dict[str, float]] = {}
    for path in (v2_path, v1_path):
        if not path.is_file():
            continue
        props = json.loads(path.read_text(encoding="utf-8")).get("proposals") or []
        for p in props:
            stem = p.get("crop_stem") or ""
            if not stem:
                continue
            bucket = visual.setdefault(stem, {})
            for c in p.get("candidates") or []:
                key = c.get("inventory_key")
                if not key:
                    continue
                score = float(c.get("score") or 0)
                if key not in bucket or score > bucket[key]:
                    bucket[key] = score

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
            blob = " ".join(
                str(ir.get(k) or "")
                for k in ("inventory_key", "board_id", "board_label", "display_label", "crop_stem")
            ).lower()
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
                    "board_num": ir.get("board_num"),
                    "board_label": ir.get("board_label") or "",
                    "pin_n": ir.get("pin_n"),
                    "display_label": ir.get("display_label") or "",
                    "score": hybrid,
                    "visual_score": round(vscore, 4) if vscore else None,
                    "text_score": round(text_score, 4) if text_score else None,
                }
            )
        rows.sort(key=lambda r: (-r["score"], r["inventory_key"]))
        rankings[stem] = rows

    out = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "method": "resnet18_v1_plus_title_token_hint",
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
