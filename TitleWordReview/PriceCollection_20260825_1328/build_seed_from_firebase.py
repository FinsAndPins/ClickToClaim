#!/usr/bin/env python3
"""Build a Title Word Review seed.json from pricing harness Firebase (read-only).

Does not modify pin_pricing_tests. Writes only the local seed file you pass via --out.

Example:
  python3 build_seed_from_firebase.py \\
    --test-run-id test_PriceCollection_20260825_1328__build_18953_visual_baseline \\
    --collection PriceCollection_20260825_1328 \\
    --count 15 \\
    --out seed.json \\
    --download-crops
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

DB = "https://fins-and-pins-click-to-claim-default-rtdb.firebaseio.com"
CROP_RAW = (
    "https://raw.githubusercontent.com/FinsAndPins/PreparingInventory/main/"
    "{collection}/crops/{filename}"
)


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def diversity_tags(v: dict) -> list[str]:
    t = (v.get("listing_title") or "")
    low = t.lower()
    tags = []
    if v.get("ctm_match_status") == "match":
        tags.append("ctm")
    if v.get("price_source") == "manual":
        tags.append("manual")
    elif v.get("price_source") == "listing":
        tags.append("ctp" if v.get("ctm_match_status") != "match" else "listing")
    for m in (
        "wdi",
        "dssh",
        "dsf",
        "dec",
        "adorbs",
        "d23",
        "le ",
        "mog",
        "star wars",
        "gummi",
        "hunchback",
        "darkwing",
        "pirates",
    ):
        if m in low:
            tags.append(m.strip())
    if len(t) < 50:
        tags.append("short")
    elif len(t) > 70:
        tags.append("long")
    else:
        tags.append("mid")
    return tags


def to_seed_row(v: dict, collection: str) -> dict:
    sc = v.get("selected_candidate") if isinstance(v.get("selected_candidate"), dict) else {}
    slot = v.get("pipeline_slot0") if isinstance(v.get("pipeline_slot0"), dict) else {}
    src = sc or slot
    fn = v.get("crop_filename") or ""
    return {
        "pin_key": v.get("pin_key"),
        "crop_filename": fn,
        "board_num": v.get("board_num"),
        "pin_n": v.get("pin_n"),
        "match_status": v.get("match_status"),
        "ctm_match_status": v.get("ctm_match_status"),
        "price_source": v.get("price_source"),
        "display_price": v.get("display_price"),
        "ebay_title": v.get("listing_title") or src.get("title") or "",
        "ebay_price": src.get("total_price") if src.get("total_price") is not None else src.get("price"),
        "ebay_thumb_url": src.get("thumbUrl") or "",
        "ebay_item_url": src.get("itemUrl") or src.get("itemId") or "",
        "crop_url": f"crops/{fn}",
        "crop_source_url": CROP_RAW.format(collection=collection, filename=fn),
    }


def pick_diverse(rows: list[dict], count: int) -> list[dict]:
    picked: list[dict] = []
    seen: set[str] = set()
    titles_seen: set[str] = set()

    def add(v: dict) -> bool:
        title = (v.get("listing_title") or "").strip().lower()
        if title and title in titles_seen:
            return False
        picked.append(v)
        if title:
            titles_seen.add(title)
        for tag in diversity_tags(v):
            seen.add(tag)
        return True

    for v in rows:
        if v.get("price_source") == "manual":
            add(v)
            if len(picked) >= count:
                return picked

    for v in rows:
        if v.get("ctm_match_status") == "match" and v not in picked:
            add(v)
            if len(picked) >= count:
                return picked

    rest = [v for v in rows if v not in picked]
    while len(picked) < count and rest:
        best = None
        best_score = -1.0
        for v in rest:
            tags = diversity_tags(v)
            new = len(set(tags) - seen)
            title = (v.get("listing_title") or "").strip().lower()
            if title in titles_seen:
                continue
            score = new + 0.05 * len((v.get("listing_title") or "").split())
            if score > best_score:
                best_score = score
                best = v
        if best is None:
            break
        add(best)
        rest.remove(best)
    return picked


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--test-run-id",
        default="test_PriceCollection_20260825_1328__build_18953_visual_baseline",
    )
    ap.add_argument("--approach-id", default="visual_baseline")
    ap.add_argument("--collection", default="PriceCollection_20260825_1328")
    ap.add_argument("--count", type=int, default=15)
    ap.add_argument("--out", type=Path, default=Path("seed.json"))
    ap.add_argument("--download-crops", action="store_true")
    args = ap.parse_args()

    url = f"{DB}/pin_pricing_tests/{args.test_run_id}/{args.approach_id}/pins.json"
    print("Fetching", url)
    pins = fetch_json(url)
    rows = [
        v
        for v in pins.values()
        if isinstance(v, dict) and v.get("match_status") in ("match", "priced")
    ]
    picked = pick_diverse(rows, args.count)
    seed = [to_seed_row(v, args.collection) for v in picked]
    args.out.write_text(json.dumps(seed, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(seed)} pins -> {args.out}")

    if args.download_crops:
        crop_dir = args.out.parent / "crops"
        crop_dir.mkdir(parents=True, exist_ok=True)
        for s in seed:
            dest = crop_dir / s["crop_filename"]
            src = s["crop_source_url"]
            print("crop", dest.name)
            urllib.request.urlretrieve(src, dest)


if __name__ == "__main__":
    main()
