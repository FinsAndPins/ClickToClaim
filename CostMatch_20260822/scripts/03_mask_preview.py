#!/usr/bin/env python3
"""Write before/after mask previews for visual QC (CostMatch one-off)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from image_prep import prepare_for_display_pair  # noqa: E402

EXPORTS = ROOT / "exports"
OUT = ROOT / "previews" / "mask_qc"
THUMBS_SOLD = ROOT / "thumbs" / "sold_ctr"
THUMBS_INV = ROOT / "thumbs" / "inventory"
PAIR_W = 640
PAIR_H = 320


def save_pair(raw: Image.Image, masked: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    raw = raw.copy()
    raw.thumbnail((PAIR_W // 2, PAIR_H), Image.Resampling.LANCZOS)
    masked = masked.copy()
    masked.thumbnail((PAIR_W // 2, PAIR_H), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (raw.width + masked.width + 8, max(raw.height, masked.height)), (32, 32, 32))
    canvas.paste(raw, (0, 0))
    canvas.paste(masked, (raw.width + 8, 0))
    canvas.save(dest, "JPEG", quality=85, optimize=True)


def main() -> None:
    sold = json.loads((EXPORTS / "sold_ctr_pins.json").read_text(encoding="utf-8"))
    inv = json.loads((EXPORTS / "inventory_units.json").read_text(encoding="utf-8"))

    n_sold = min(24, len(sold))
    n_inv = min(24, len(inv))

    for r in sold[:n_sold]:
        stem = r.get("crop_stem") or ""
        p = THUMBS_SOLD / f"{stem}.jpg"
        if not p.is_file():
            continue
        raw, masked = prepare_for_display_pair(Image.open(p), "sold_ctr")
        save_pair(raw, masked, OUT / "sold" / f"{stem}.jpg")

    for r in inv[:n_inv]:
        key = r.get("inventory_key") or ""
        p = THUMBS_INV / f"{key}.jpg"
        if not p.is_file():
            continue
        raw, masked = prepare_for_display_pair(Image.open(p), "catalog_flyer")
        save_pair(raw, masked, OUT / "catalog" / f"{key}.jpg")

    summary = {
        "sold_previews": n_sold,
        "catalog_previews": n_inv,
        "out_dir": str(OUT.relative_to(ROOT)),
        "note": "Left = original thumb, right = masked embed input",
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
