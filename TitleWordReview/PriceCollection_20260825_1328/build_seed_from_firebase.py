#!/usr/bin/env python3
"""Build Title Word Review seed.json from pricing harness Firebase (read-only).

Uses ONLY the listing Lexi/Steve chose:
  - ClickToMatch match → selected_candidate (often also pipeline slot 0)
  - ClickToPrice choice → selected_candidate (may differ from pipeline slot 0)

Never uses pipeline_slot0 as the title/thumb source when selected_candidate exists.
Pins without selected_candidate (e.g. manual price only) are skipped.

Does not modify pin_pricing_tests. Writes only the local --out file.

Example:
  python3 build_seed_from_firebase.py --count 15 --out seed.json --download-crops
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


def diversity_tags(v: dict, title: str) -> list[str]:
    low = (title or "").lower()
    tags = []
    if v.get("ctm_match_status") == "match":
        tags.append("ctm")
    else:
        tags.append("ctp")
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
        "aurora",
        "alice",
        "tramp",
    ):
        if m in low:
            tags.append(m.strip())
    if len(title) < 50:
        tags.append("short")
    elif len(title) > 70:
        tags.append("long")
    else:
        tags.append("mid")
    return tags


def chosen_listing(v: dict) -> dict | None:
    """Return the operator-chosen eBay listing, or None if none was chosen."""
    sc = v.get("selected_candidate")
    if not isinstance(sc, dict):
        return None
    if not (sc.get("title") or sc.get("itemUrl") or sc.get("itemId")):
        return None
    return sc


def to_seed_row(v: dict, collection: str) -> dict:
    sc = chosen_listing(v)
    assert sc is not None
    fn = v.get("crop_filename") or ""
    listing_source = (
        "ctm_match" if v.get("ctm_match_status") == "match" else "click_to_price"
    )
    return {
        "pin_key": v.get("pin_key"),
        "crop_filename": fn,
        "board_num": v.get("board_num"),
        "pin_n": v.get("pin_n"),
        "match_status": v.get("match_status"),
        "ctm_match_status": v.get("ctm_match_status"),
        "price_source": v.get("price_source"),
        "display_price": v.get("display_price"),
        "selected_candidate_idx": v.get("selected_candidate_idx"),
        "listing_source": listing_source,
        # Chosen listing ONLY — never pipeline_slot0
        "ebay_title": sc.get("title") or "",
        "ebay_price": sc.get("total_price")
        if sc.get("total_price") is not None
        else sc.get("price"),
        "ebay_thumb_url": sc.get("thumbUrl") or "",
        "ebay_item_url": sc.get("itemUrl") or sc.get("itemId") or "",
        "crop_url": f"crops/{fn}",
        "crop_source_url": CROP_RAW.format(collection=collection, filename=fn),
    }


def pick_diverse(rows: list[dict], count: int) -> list[dict]:
    picked: list[dict] = []
    seen: set[str] = set()
    titles_seen: set[str] = set()

    def title_of(v: dict) -> str:
        sc = chosen_listing(v) or {}
        return (sc.get("title") or "").strip().lower()

    def add(v: dict) -> bool:
        title = title_of(v)
        if title and title in titles_seen:
            return False
        picked.append(v)
        if title:
            titles_seen.add(title)
        sc = chosen_listing(v) or {}
        for tag in diversity_tags(v, sc.get("title") or ""):
            seen.add(tag)
        return True

    ctm = [v for v in rows if v.get("ctm_match_status") == "match"]
    for v in ctm:
        add(v)
        if len(picked) >= max(1, count // 3):
            break

    rest = [v for v in rows if v not in picked]
    while len(picked) < count and rest:
        best = None
        best_score = -1.0
        for v in rest:
            title = title_of(v)
            if title in titles_seen:
                continue
            sc = chosen_listing(v) or {}
            tags = diversity_tags(v, sc.get("title") or "")
            new = len(set(tags) - seen)
            score = new + 0.05 * len((sc.get("title") or "").split())
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
    rows = []
    for v in pins.values():
        if not isinstance(v, dict):
            continue
        if v.get("match_status") != "match":
            continue
        if v.get("price_source") != "listing":
            continue
        if not chosen_listing(v):
            continue
        rows.append(v)

    print(f"Eligible (match + selected_candidate): {len(rows)}")
    picked = pick_diverse(rows, args.count)
    seed = [to_seed_row(v, args.collection) for v in picked]
    args.out.write_text(json.dumps(seed, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(seed)} pins -> {args.out}")
    for s in seed:
        print(f"  {s['listing_source']:14} {s['crop_filename']} | {s['ebay_title'][:70]}")

    if args.download_crops:
        crop_dir = args.out.parent / "crops"
        crop_dir.mkdir(parents=True, exist_ok=True)
        wanted = {s["crop_filename"] for s in seed}
        for existing in crop_dir.glob("*.jpg"):
            if existing.name not in wanted:
                existing.unlink()
        for s in seed:
            dest = crop_dir / s["crop_filename"]
            if dest.exists():
                continue
            print("crop", dest.name)
            urllib.request.urlretrieve(s["crop_source_url"], dest)


if __name__ == "__main__":
    main()
