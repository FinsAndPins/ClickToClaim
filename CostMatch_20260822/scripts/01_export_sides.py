#!/usr/bin/env python3
"""One-off export: CTR sold pins + D23 inventory units with catalog cost.

Read-only against CTR/pricing/inventory sources. Writes only under CostMatch_20260822/.
Not used by PrepareClickToClaim, pricing watcher, or show templates.
"""
from __future__ import annotations

import csv
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
EXPORTS = ROOT / "exports"
THUMBS_SOLD = ROOT / "thumbs" / "sold_ctr"
THUMBS_INV = ROOT / "thumbs" / "inventory"

CTR_SHOW = "20260822"
RUN_ID = "test_PriceCollection_20260821_1147__build_20260822_fullres_visual_baseline"
FB_URL = (
    "https://fins-and-pins-click-to-claim-default-rtdb.firebaseio.com/"
    f"pin_pricing_tests/{RUN_ID}/visual_baseline/pins.json"
)
CROPS_DIR = Path.home() / (
    "Library/Application Support/FinsAndPins/PreparingInventoryGit/"
    "PriceCollection_20260821_1147/crops"
)
CATALOG_PRICES = REPO / "D23Inventory2026" / "catalog-prices.json"
D23_BOARDS = REPO / "2026D23" / "boards"
EXTRA_BOARDS = REPO / "D23Inventory2026" / "extra-boards"
EXTRA_BOARD_TITLES = {
    "D23MP_AUG14": "D23 Marketplace · Fri Aug 14",
    "D23MP_AUG15": "D23 Marketplace · Sat Aug 15",
    "D23MP_AUG16": "D23 Marketplace · Sun Aug 16",
}

THUMB_MAX = 320  # long edge — light for GitHub Pages


def money(n: float | None) -> float | None:
    if n is None:
        return None
    try:
        v = float(n)
    except (TypeError, ValueError):
        return None
    if not (v > 0) or v != v:
        return None
    return round(v, 2)


def save_thumb(im: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    img = im.convert("RGB")
    img.thumbnail((THUMB_MAX, THUMB_MAX), Image.Resampling.LANCZOS)
    img.save(dest, "JPEG", quality=82, optimize=True)


def crop_from_board(board_img: Path, pred: dict) -> Image.Image:
    im = Image.open(board_img).convert("RGB")
    w, h = im.size
    # Roboflow-style center x/y + width/height in pixels
    cx = float(pred["x"])
    cy = float(pred["y"])
    bw = float(pred["width"])
    bh = float(pred["height"])
    left = max(0, int(round(cx - bw / 2)))
    top = max(0, int(round(cy - bh / 2)))
    right = min(w, int(round(cx + bw / 2)))
    bottom = min(h, int(round(cy + bh / 2)))
    if right <= left or bottom <= top:
        raise ValueError(f"bad box on {board_img.name}")
    return im.crop((left, top, right, bottom))


def catalog_unit_price(table: dict, pin_key: str) -> float | None:
    over = table.get("pin_overrides") or {}
    if pin_key in over and over[pin_key] is not None:
        return money(over[pin_key])
    board = pin_key.rsplit("-", 1)[0]
    defaults = table.get("board_defaults") or {}
    if board in defaults:
        return money(defaults[board])
    return None


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def export_sold() -> list[dict]:
    print(f"Fetching Firebase sold pins…")
    with urllib.request.urlopen(FB_URL, timeout=60) as resp:
        pins = json.loads(resp.read().decode("utf-8")) or {}

    rows: list[dict] = []
    missing_crop = 0
    for fb_key, p in sorted(pins.items(), key=lambda kv: kv[0]):
        if not p:
            continue
        sold = money(p.get("sale_price"))
        if sold is None:
            continue
        crop_filename = str(p.get("crop_filename") or "").strip()
        stem = Path(crop_filename).stem if crop_filename else ""
        src = CROPS_DIR / crop_filename if crop_filename else None
        thumb_rel = f"thumbs/sold_ctr/{stem}.jpg" if stem else ""
        if src and src.is_file() and stem:
            save_thumb(Image.open(src), ROOT / thumb_rel)
        else:
            missing_crop += 1
            thumb_rel = ""

        list_price = money(p.get("display_price"))
        rows.append(
            {
                "fb_key": fb_key,
                "pin_key": p.get("pin_key") or fb_key,
                "crop_stem": stem,
                "crop_filename": crop_filename,
                "thumb": thumb_rel,
                "list_price": list_price,
                "sold_price": sold,
                "match_status": p.get("match_status") or "",
                "sale_recorded_by": p.get("sale_recorded_by") or "",
                "sale_recorded_at": p.get("sale_recorded_at")
                or p.get("sale_recorded_date")
                or "",
                "board_num": p.get("board_num"),
                "pin_n": p.get("pin_n"),
                "listing_title": p.get("listing_title") or "",
            }
        )

    print(f"  sold rows: {len(rows)}  missing crops: {missing_crop}")
    return rows


def load_inventory_manifest() -> list[tuple[str, Path, str]]:
    """Match D23Inventory2026/index.html: 2026D23 boards then extra marketplace flyers."""
    entries: list[tuple[str, Path, str]] = []
    ctr_manifest = D23_BOARDS / "manifest.json"
    if ctr_manifest.is_file():
        ctr_names = json.loads(ctr_manifest.read_text(encoding="utf-8"))
        if isinstance(ctr_names, list):
            for name in ctr_names:
                entries.append((name, D23_BOARDS, "2026D23/boards"))
    else:
        for jp in sorted(D23_BOARDS.glob("PAGE_*.json")):
            entries.append((jp.stem, D23_BOARDS, "2026D23/boards"))
    extra_manifest = EXTRA_BOARDS / "manifest.json"
    if extra_manifest.is_file():
        extra_names = json.loads(extra_manifest.read_text(encoding="utf-8"))
        if isinstance(extra_names, list):
            for name in extra_names:
                entries.append((name, EXTRA_BOARDS, "D23Inventory2026/extra-boards"))
    else:
        for jp in sorted(EXTRA_BOARDS.glob("D23MP_*.json")):
            entries.append((jp.stem, EXTRA_BOARDS, "D23Inventory2026/extra-boards"))
    return entries


def board_label(board_id: str, manifest_index: int) -> str:
    return EXTRA_BOARD_TITLES.get(board_id) or f"Board {manifest_index + 1}"


def export_inventory(table: dict) -> list[dict]:
    rows: list[dict] = []
    manifest = load_inventory_manifest()
    board_rank = {board_id: idx for idx, (board_id, _, _) in enumerate(manifest)}
    for board_id, board_dir, label in manifest:
        jp = board_dir / f"{board_id}.json"
        if not jp.is_file():
            print(f"  WARN missing {jp}")
            continue
        jpg = board_dir / f"{board_id}.JPG"
        if not jpg.is_file():
            jpg = board_dir / f"{board_id}.jpg"
        if not jpg.is_file():
            print(f"  WARN no image for {jp.name}")
            continue
        data = json.loads(jp.read_text(encoding="utf-8"))
        preds = data.get("predictions") if isinstance(data, dict) else data
        if not isinstance(preds, list):
            continue
        rank = board_rank.get(board_id, 0)
        blabel = board_label(board_id, rank)
        for idx, pred in enumerate(preds):
            if not isinstance(pred, dict):
                continue
            pin_key = f"{board_id}-{idx}"
            pin_n = idx + 1
            cost = catalog_unit_price(table, pin_key)
            crop_stem = str(pred.get("crop_stem") or f"{board_id}_pin{idx:02d}")
            thumb_rel = f"thumbs/inventory/{pin_key}.jpg"
            try:
                save_thumb(crop_from_board(jpg, pred), ROOT / thumb_rel)
            except Exception as e:
                print(f"  WARN crop {pin_key}: {e}")
                thumb_rel = ""
            rows.append(
                {
                    "inventory_key": pin_key,
                    "board_id": board_id,
                    "board_num": rank + 1 if board_id not in EXTRA_BOARD_TITLES else None,
                    "board_label": blabel,
                    "pin_index": idx,
                    "pin_n": pin_n,
                    "display_label": f"{blabel} pin {pin_n}",
                    "crop_stem": crop_stem,
                    "thumb": thumb_rel,
                    "catalog_cost": cost,
                    "source_folder": label,
                    "board_image": f"{label}/{jpg.name}",
                }
            )
    priced = sum(1 for r in rows if r["catalog_cost"] is not None)
    print(f"  inventory units: {len(rows)}  with catalog cost: {priced}")
    return rows


def main() -> None:
    EXPORTS.mkdir(parents=True, exist_ok=True)
    THUMBS_SOLD.mkdir(parents=True, exist_ok=True)
    THUMBS_INV.mkdir(parents=True, exist_ok=True)

    table = json.loads(CATALOG_PRICES.read_text(encoding="utf-8"))
    sold = export_sold()
    inv = export_inventory(table)

    sold_fields = [
        "fb_key",
        "pin_key",
        "crop_stem",
        "crop_filename",
        "thumb",
        "list_price",
        "sold_price",
        "match_status",
        "sale_recorded_by",
        "sale_recorded_at",
        "board_num",
        "pin_n",
        "listing_title",
    ]
    inv_fields = [
        "inventory_key",
        "board_id",
        "board_num",
        "board_label",
        "pin_index",
        "pin_n",
        "display_label",
        "crop_stem",
        "thumb",
        "catalog_cost",
        "source_folder",
        "board_image",
    ]

    (EXPORTS / "sold_ctr_pins.json").write_text(
        json.dumps(sold, indent=2) + "\n", encoding="utf-8"
    )
    (EXPORTS / "inventory_units.json").write_text(
        json.dumps(inv, indent=2) + "\n", encoding="utf-8"
    )
    write_csv(EXPORTS / "sold_ctr_pins.csv", sold, sold_fields)
    write_csv(EXPORTS / "inventory_units.csv", inv, inv_fields)

    summary = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "ctr_show": CTR_SHOW,
        "pricing_run_id": RUN_ID,
        "sold_count": len(sold),
        "sold_with_thumb": sum(1 for r in sold if r.get("thumb")),
        "sold_list_total": round(sum(r["list_price"] or 0 for r in sold), 2),
        "sold_hammer_total": round(sum(r["sold_price"] or 0 for r in sold), 2),
        "inventory_count": len(inv),
        "inventory_with_cost": sum(1 for r in inv if r.get("catalog_cost") is not None),
        "inventory_cost_total_unique_skus": round(
            sum(r["catalog_cost"] or 0 for r in inv if r.get("catalog_cost") is not None),
            2,
        ),
        "notes": [
            "One-off CostMatch project — not a CTR template.",
            "catalog_cost = D23 flyer retail from D23Inventory2026/catalog-prices.json.",
            "Fully loaded cost (travel etc.) is tracked elsewhere and ignored here.",
        ],
    }
    (EXPORTS / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
