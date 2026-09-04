#!/usr/bin/env python3
"""Build Title Word Review seed.json from pricing harness Firebase (read-only).

Uses ONLY selected_candidate (CTM match or CTP pick). Never pipeline_slot0.

Example:
  python3 build_seed_from_firebase.py --all --out seed.json --download-crops
  python3 build_seed_from_firebase.py --count 15 --out seed_pilot.json
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path

DB = "https://fins-and-pins-click-to-claim-default-rtdb.firebaseio.com"
CROP_RAW = (
    "https://raw.githubusercontent.com/FinsAndPins/PreparingInventory/main/"
    "{collection}/crops/{filename}"
)
RULES_PATH = Path(__file__).with_name("title_seed_rules.json")


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def load_rules() -> dict:
    return json.loads(RULES_PATH.read_text(encoding="utf-8"))


def chosen_listing(v: dict) -> dict | None:
    sc = v.get("selected_candidate")
    if not isinstance(sc, dict):
        return None
    if not (sc.get("title") or sc.get("itemUrl") or sc.get("itemId")):
        return None
    return sc


def sort_key(v: dict) -> tuple:
    bn = v.get("board_num")
    pn = v.get("pin_n")
    try:
        return (int(bn), int(pn), v.get("crop_filename") or "")
    except (TypeError, ValueError):
        return (999, 999, v.get("crop_filename") or "")


def to_seed_row(v: dict, collection: str) -> dict:
    sc = chosen_listing(v)
    assert sc is not None
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
        "selected_candidate_idx": v.get("selected_candidate_idx"),
        "listing_source": (
            "ctm_match" if v.get("ctm_match_status") == "match" else "click_to_price"
        ),
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
    """Greedy diversity pick for pilot batches."""
    rules = load_rules()
    picked: list[dict] = []
    seen: set[str] = set()
    titles_seen: set[str] = set()

    def title_of(v: dict) -> str:
        sc = chosen_listing(v) or {}
        return (sc.get("title") or "").strip().lower()

    def tags(v: dict) -> list[str]:
        t = title_of(v)
        out = ["ctm" if v.get("ctm_match_status") == "match" else "ctp"]
        for m in rules.get("makers", []) + ["star wars", "gummi", "hunchback", "darkwing"]:
            if m in t:
                out.append(m)
        if len(t) < 50:
            out.append("short")
        elif len(t) > 70:
            out.append("long")
        else:
            out.append("mid")
        return out

    def add(v: dict) -> bool:
        title = title_of(v)
        if title and title in titles_seen:
            return False
        picked.append(v)
        if title:
            titles_seen.add(title)
        for tag in tags(v):
            seen.add(tag)
        return True

    for v in rows:
        if v.get("ctm_match_status") == "match":
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
            tg = tags(v)
            score = len(set(tg) - seen) + 0.05 * len(title.split())
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
    ap.add_argument("--count", type=int, default=0, help="0 = all eligible pins")
    ap.add_argument("--all", action="store_true", help="Include all eligible pins")
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

    rows.sort(key=sort_key)
    print(f"Eligible (match + selected_candidate): {len(rows)}")

    if args.all or args.count <= 0:
        picked = rows
    else:
        picked = pick_diverse(rows, args.count)

    seed = [to_seed_row(v, args.collection) for v in picked]
    meta = {
        "collection": args.collection,
        "pin_count": len(seed),
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "rules_file": "title_seed_rules.json",
    }
    args.out.write_text(
        json.dumps({"meta": meta, "pins": seed}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(seed)} pins -> {args.out}")

    if args.download_crops:
        crop_dir = args.out.parent / "crops"
        crop_dir.mkdir(parents=True, exist_ok=True)
        wanted = {s["crop_filename"] for s in seed}
        for existing in crop_dir.glob("*.jpg"):
            if existing.name not in wanted:
                existing.unlink()
                print("removed", existing.name)
        for i, s in enumerate(seed, 1):
            dest = crop_dir / s["crop_filename"]
            if dest.exists():
                continue
            print(f"crop [{i}/{len(seed)}]", dest.name)
            urllib.request.urlretrieve(s["crop_source_url"], dest)


if __name__ == "__main__":
    main()
