#!/usr/bin/env python3
"""Build Whatnot bulk-upload CSV from Title Word Review accepted labels.

Reads accepted labels + pricing from Firebase, applies title/description rules
from title_seed_rules.json, rounds prices up to the nearest $5.

Example:
  python3 build_whatnot_csv.py
  python3 build_whatnot_csv.py --out training_exports/whatnot_upload.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DB = "https://fins-and-pins-click-to-claim-default-rtdb.firebaseio.com"
COLLECTION = "PriceCollection_20260825_1328"
BATCH_ID = "batch_full_98_v1"
PRICING_RUN = "test_PriceCollection_20260825_1328__build_18953_visual_baseline"
PRICING_APPROACH = "visual_baseline"
CROP_PAGES_BASE = (
    "https://finsandpins.github.io/ClickToClaim/TitleWordReview/"
    f"{COLLECTION}/crops/"
)

HEADERS = [
    "Category",
    "Sub Category",
    "Title",
    "Description",
    "Quantity",
    "Type",
    "Price",
    "Shipping Profile",
    "Condition",
    "Image URL 1",
    "SKU",
]

# Franchises/shows not always captured in title_seed_rules movie_phrases.
EXTRA_FRANCHISE_PHRASES = [
    "ant-man and the wasp quantumania",
    "antman and the wasp quantumania",
    "the three musketeers",
    "three musketeers",
    "darkwing duck",
    "robin hood",
    "pinocchio",
    "the muppets",
    "muppets",
    "luca",
    "club 33",
    "disney auctions",
    "disney shopping",
    "off the page",
    "lady and the tramp",
    "quantumania",
]


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def safe_pk(pin_key: str) -> str:
    return re.sub(r"[.#$\[\]]", "_", pin_key or "")


def round_up_to_5(price) -> int:
    value = float(price)
    if value <= 0:
        return 0
    return int(math.ceil(value / 5.0) * 5)


def normalize_key(word: str) -> str:
    k = re.sub(r"[!.,:;()]+$", "", (word or "").lower()).strip()
    if re.match(r"^le\s*-?\s*\d+$", k) or re.match(r"^le\d+$", k):
        return "le"
    return k


def title_case_phrase(phrase: str) -> str:
    small = {"of", "the", "and", "in", "a", "an", "on", "for", "with", "from"}
    words = phrase.split()
    out = []
    for i, w in enumerate(words):
        if i > 0 and w.lower() in small:
            out.append(w.lower())
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def find_franchise(ebay_title: str, desc_only_words, movie_phrases: list[str]) -> str:
    ebay_low = (ebay_title or "").lower()
    phrases = sorted(set(movie_phrases + EXTRA_FRANCHISE_PHRASES), key=len, reverse=True)
    for phrase in phrases:
        if phrase in ebay_low:
            return title_case_phrase(phrase)

    if desc_only_words:
        desc_low = [str(w).lower() for w in desc_only_words]
        for phrase in phrases:
            pwords = phrase.split()
            if all(w in desc_low for w in pwords):
                return title_case_phrase(phrase)
        return " ".join(str(w) for w in desc_only_words)

    if "quantumania" in ebay_low or "antman" in ebay_low or "ant-man" in ebay_low:
        return "Ant-Man and the Wasp Quantumania"
    return ""


def acronyms_in_title(title: str, expansions: dict) -> list[str]:
    seen = set()
    lines = []
    for word in (title or "").split():
        key = normalize_key(word)
        if key in expansions and key not in seen:
            seen.add(key)
            lines.append(expansions[key])
    return lines


def img_ref(board_num, pin_n) -> str:
    try:
        board = int(board_num)
        pin = int(pin_n)
    except (TypeError, ValueError):
        board = board_num
        pin = pin_n
    return f"IMG {board}-{int(pin):02d}"


def build_description(title: str, ebay_title: str, desc_only_words, rules: dict, board_num, pin_n) -> str:
    parts = ["Please rely on the photo, rather than the description."]
    parts.extend(acronyms_in_title(title, rules.get("acronym_expansions") or {}))
    franchise = find_franchise(ebay_title, desc_only_words, rules.get("movie_phrases") or [])
    if franchise:
        parts.append(franchise)
    if re.search(r"\bLE\b", title or "", re.I):
        parts.append("Limited Edition")
    parts.append(img_ref(board_num, pin_n))
    return " ".join(p for p in parts if p)


def sort_key(row: dict) -> tuple:
    try:
        return (int(row.get("board_num") or 999), int(row.get("pin_n") or 999), row.get("crop_filename") or "")
    except (TypeError, ValueError):
        return (999, 999, row.get("crop_filename") or "")


def build_rows(rules: dict, seed_by_crop: dict, labels: dict, pricing: dict) -> list[dict]:
    rows = []
    for _k, label in labels.items():
        if not label or not label.get("accepted"):
            continue
        crop = label.get("crop_filename") or ""
        seed = seed_by_crop.get(crop)
        if not seed:
            continue
        pin_key = label.get("pin_key") or seed.get("pin_key")
        pk = safe_pk(pin_key)
        price_row = pricing.get(pk) or pricing.get(pin_key) or {}
        raw_price = price_row.get("display_price", seed.get("display_price"))
        if raw_price is None:
            continue
        title = (label.get("cleaned_title") or "").strip()
        if not title:
            continue
        board_num = seed.get("board_num")
        pin_n = seed.get("pin_n")
        img_url = CROP_PAGES_BASE + crop
        sku = f"Board_{board_num}_Pin_{pin_n}"
        rows.append(
            {
                "board_num": board_num,
                "pin_n": pin_n,
                "crop_filename": crop,
                "Category": "Collectibles",
                "Sub Category": "Disney Pins",
                "Title": title,
                "Description": build_description(
                    title,
                    label.get("ebay_title") or seed.get("ebay_title") or "",
                    label.get("description_only_words"),
                    rules,
                    board_num,
                    pin_n,
                ),
                "Quantity": "1",
                "Type": "Auction",
                "Price": str(round_up_to_5(raw_price)),
                "Shipping Profile": "0-1 Oz",
                "Condition": "Used",
                "Image URL 1": img_url,
                "SKU": sku,
                "raw_price": raw_price,
                "reviewed_by": label.get("reviewed_by"),
            }
        )
    rows.sort(key=sort_key)
    return rows


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=HEADERS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({h: row.get(h, "") for h in HEADERS})


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Whatnot CSV from Title Word Review accepts")
    parser.add_argument(
        "--out",
        default="training_exports/whatnot_upload_PriceCollection_20260825_1328.csv",
        help="Output CSV path",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    rules = json.loads((root / "title_seed_rules.json").read_text(encoding="utf-8"))
    seed_doc = json.loads((root / "seed.json").read_text(encoding="utf-8"))
    seed_by_crop = {p["crop_filename"]: p for p in seed_doc.get("pins") or []}

    labels = fetch_json(f"{DB}/title_word_review/{COLLECTION}/{BATCH_ID}/pins.json") or {}
    pricing = (
        fetch_json(f"{DB}/pin_pricing_tests/{PRICING_RUN}/{PRICING_APPROACH}/pins.json") or {}
    )

    rows = build_rows(rules, seed_by_crop, labels, pricing)
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = root / out_path
    write_csv(out_path, rows)

    meta_path = out_path.with_suffix(".json")
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(),
        "collection": COLLECTION,
        "batch_id": BATCH_ID,
        "pin_count": len(rows),
        "price_rounding": "round_up_to_nearest_5",
        "csv_path": str(out_path.name),
        "sample": rows[:3],
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {len(rows)} listings to {out_path}")
    print(f"Meta: {meta_path}")


if __name__ == "__main__":
    main()
