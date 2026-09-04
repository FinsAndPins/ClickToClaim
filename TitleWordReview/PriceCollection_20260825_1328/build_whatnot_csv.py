#!/usr/bin/env python3
"""Build Whatnot bulk-upload CSV from Title Word Review accepted labels.

Reads accepted labels + pricing from Firebase, applies title/description rules
from title_seed_rules.json + Disney Synonyms Keywords.txt, rounds prices up
to the nearest $5.

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
TITLE_PHOTO_SUFFIX = "PLEASE RELY ON THE PHOTO"
SYNONYMS_FILENAME = "Disney Synonyms Keywords.txt"

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


def parse_synonym_groups(path: Path) -> list[dict]:
    """Parse 'Primary Name: alias1, alias2' lines into synonym groups.

    Each group includes the primary name plus every alias. Matching any term
    in the title expands the description to the full group (acronyms + full
    names + synonyms), e.g. WDI or MOG → WDI, MOG, Walt Disney Imagineering,
    Mickey's of Glendale.
    """
    groups: list[dict] = []
    if not path.is_file():
        return groups
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        primary, rest = line.split(":", 1)
        primary = primary.strip()
        aliases = [a.strip() for a in rest.split(",") if a.strip()]
        terms: list[str] = []
        seen_low: set[str] = set()

        def add(term: str) -> None:
            t = term.strip()
            if not t:
                return
            low = t.lower()
            if low in seen_low:
                return
            seen_low.add(low)
            terms.append(t)

        # Acronyms / short tokens first, then longer / full names.
        short = [a for a in aliases if " " not in a]
        long_aliases = [a for a in aliases if " " in a]
        for a in short:
            add(a)
        add(primary)
        for a in long_aliases:
            add(a)

        if terms:
            groups.append({"primary": primary, "terms": terms, "match_lows": set(seen_low)})
    return groups


def title_matches_term(title_low: str, term_low: str) -> bool:
    if " " in term_low or "'" in term_low:
        return term_low in title_low
    return bool(re.search(rf"\b{re.escape(term_low)}\b", title_low))


def synonym_keywords_for_title(title: str, groups: list[dict]) -> list[str]:
    title_low = (title or "").lower()
    out: list[str] = []
    seen_low: set[str] = set()
    for group in groups:
        if not any(title_matches_term(title_low, t) for t in group["match_lows"]):
            continue
        for term in group["terms"]:
            low = term.lower()
            if low in seen_low:
                continue
            seen_low.add(low)
            out.append(term)
    return out


def leftover_acronym_expansions(title: str, expansions: dict, already_low: set[str]) -> list[str]:
    """Spell out title acronyms not already covered by a synonym group."""
    lines = []
    seen = set()
    for word in (title or "").split():
        key = normalize_key(word)
        if key not in expansions or key in seen:
            continue
        if key in already_low:
            continue
        expansion = expansions[key]
        if expansion.lower() in already_low:
            continue
        seen.add(key)
        lines.append(word.upper() if word.isupper() or len(word) <= 4 else word)
        lines.append(expansion)
    return lines


def img_ref(board_num, pin_n) -> str:
    try:
        board = int(board_num)
        pin = int(pin_n)
    except (TypeError, ValueError):
        board = board_num
        pin = pin_n
    return f"IMG {board}-{int(pin):02d}"


def with_photo_title_suffix(title: str) -> str:
    t = (title or "").strip()
    if not t:
        return t
    if re.search(rf"\b{re.escape(TITLE_PHOTO_SUFFIX)}\b", t, re.I):
        return t
    return f"{t} {TITLE_PHOTO_SUFFIX}"


def build_description(
    title: str,
    ebay_title: str,
    desc_only_words,
    rules: dict,
    synonym_groups: list[dict],
    board_num,
    pin_n,
) -> str:
    parts = ["Please rely on the photo, rather than the description."]
    syn_terms = synonym_keywords_for_title(title, synonym_groups)
    if syn_terms:
        parts.append(", ".join(syn_terms) + ".")
    already_low = {t.lower() for t in syn_terms}
    for term in syn_terms:
        already_low.add(normalize_key(term))
    leftover = leftover_acronym_expansions(title, rules.get("acronym_expansions") or {}, already_low)
    if leftover:
        parts.append(", ".join(leftover) + ".")
    franchise = find_franchise(ebay_title, desc_only_words, rules.get("movie_phrases") or [])
    if franchise:
        franchise_low = franchise.lower().strip()
        syn_lows = {t.lower() for t in syn_terms}
        # Skip franchise text that duplicates a synonym-group keyword string.
        if franchise_low not in syn_lows and franchise_low not in already_low:
            parts.append(franchise + ".")
            already_low.add(franchise_low)
    if re.search(r"\bLE\b", title or "", re.I):
        parts.append("Limited Edition.")
    parts.append(img_ref(board_num, pin_n))
    return " ".join(p for p in parts if p)


# Lexi manual-price pins (no selected_candidate / not in Title Word Review).
# Titles follow the same short-title policy; movies/expansions go in description.
MANUAL_PIN_OVERRIDES = {
    "img1_pin04.jpg": {
        "cleaned_title": "Animal Crossing Doggy",
        "ebay_title": "2020 Nintendo Animal Crossing Doggy Pin Brooch Jewelry N3",
        "description_only_words": None,
    },
    "img1_pin22.jpg": {
        "cleaned_title": "Mickey Face Plate Origami Owl",
        "ebay_title": "Origami Owl Disney Can’t Stop Won’t Stop Mickey Mouse Face Plate",
        "description_only_words": None,
    },
    "img5_pin06.jpg": {
        "cleaned_title": "Ariel DLP",
        "ebay_title": "Disneyland Paris Mermaid Ariel The Little Mermaid Enamel Pin Set New",
        "description_only_words": ["The", "Little", "Mermaid"],
    },
}

BUYNOW_HEADERS = [
    "Category",
    "Sub Category",
    "Title",
    "Description",
    "Quantity",
    "Type",
    "Price",
    "Shipping Profile",
    "Offerable",
    "Hazmat",
    "Condition",
    "Cost Per Item",
    "SKU",
    "Image URL 1",
]


def sort_key(row: dict) -> tuple:
    try:
        return (int(row.get("board_num") or 999), int(row.get("pin_n") or 999), row.get("crop_filename") or "")
    except (TypeError, ValueError):
        return (999, 999, row.get("crop_filename") or "")


def make_listing_row(
    *,
    base_title: str,
    ebay_title: str,
    desc_only_words,
    rules: dict,
    synonym_groups: list[dict],
    board_num,
    pin_n,
    crop: str,
    raw_price,
    reviewed_by: str,
) -> dict:
    title = with_photo_title_suffix(base_title)
    return {
        "board_num": board_num,
        "pin_n": pin_n,
        "crop_filename": crop,
        "Category": "Collectibles",
        "Sub Category": "Disney Pins",
        "Title": title,
        "Description": build_description(
            base_title,
            ebay_title,
            desc_only_words,
            rules,
            synonym_groups,
            board_num,
            pin_n,
        ),
        "Quantity": "1",
        "Type": "Auction",
        "Price": str(round_up_to_5(raw_price)),
        "Shipping Profile": "0-1 Oz",
        "Condition": "Used",
        "Image URL 1": CROP_PAGES_BASE + crop,
        "SKU": f"Board_{board_num}_Pin_{pin_n}",
        "raw_price": raw_price,
        "reviewed_by": reviewed_by,
    }


def build_rows(
    rules: dict,
    seed_by_crop: dict,
    labels: dict,
    pricing: dict,
    synonym_groups: list[dict],
) -> list[dict]:
    rows = []
    used_crops: set[str] = set()
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
        base_title = (label.get("cleaned_title") or "").strip()
        if not base_title:
            continue
        rows.append(
            make_listing_row(
                base_title=base_title,
                ebay_title=label.get("ebay_title") or seed.get("ebay_title") or "",
                desc_only_words=label.get("description_only_words"),
                rules=rules,
                synonym_groups=synonym_groups,
                board_num=seed.get("board_num"),
                pin_n=seed.get("pin_n"),
                crop=crop,
                raw_price=raw_price,
                reviewed_by=label.get("reviewed_by") or "",
            )
        )
        used_crops.add(crop)

    # Append Lexi manual-price pins that never entered Title Word Review.
    for _k, price_row in pricing.items():
        if not price_row or price_row.get("price_source") != "manual":
            continue
        crop = price_row.get("crop_filename") or ""
        if not crop or crop in used_crops:
            continue
        override = MANUAL_PIN_OVERRIDES.get(crop)
        if not override:
            continue
        raw_price = price_row.get("display_price")
        if raw_price is None:
            continue
        rows.append(
            make_listing_row(
                base_title=override["cleaned_title"],
                ebay_title=override.get("ebay_title") or price_row.get("listing_title") or "",
                desc_only_words=override.get("description_only_words"),
                rules=rules,
                synonym_groups=synonym_groups,
                board_num=price_row.get("board_num"),
                pin_n=price_row.get("pin_n"),
                crop=crop,
                raw_price=raw_price,
                reviewed_by=price_row.get("reviewed_by") or "Lexi",
            )
        )
        used_crops.add(crop)

    rows.sort(key=sort_key)
    return rows


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=HEADERS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({h: row.get(h, "") for h in HEADERS})


def write_buynow_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=BUYNOW_HEADERS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "Category": "Disneyana",
                    "Sub Category": "Disney Pins",
                    "Title": row["Title"],
                    "Description": row["Description"],
                    "Quantity": "1",
                    "Type": "Buy it Now",
                    "Price": row["Price"],
                    "Shipping Profile": "0-1 Oz",
                    "Offerable": "FALSE",
                    "Hazmat": "Not Hazmat",
                    "Condition": "Used",
                    "Cost Per Item": "",
                    "SKU": row["SKU"],
                    "Image URL 1": row["Image URL 1"],
                }
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Whatnot CSV from Title Word Review accepts")
    parser.add_argument(
        "--out",
        default="training_exports/whatnot_upload_PriceCollection_20260825_1328.csv",
        help="Output auction CSV path",
    )
    parser.add_argument(
        "--buynow-out",
        default="training_exports/whatnot_upload_PriceCollection_20260825_1328_buynow.csv",
        help="Output Buy It Now CSV path",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    rules = json.loads((root / "title_seed_rules.json").read_text(encoding="utf-8"))
    synonym_groups = parse_synonym_groups(root / SYNONYMS_FILENAME)
    seed_doc = json.loads((root / "seed.json").read_text(encoding="utf-8"))
    seed_by_crop = {p["crop_filename"]: p for p in seed_doc.get("pins") or []}

    labels = fetch_json(f"{DB}/title_word_review/{COLLECTION}/{BATCH_ID}/pins.json") or {}
    pricing = (
        fetch_json(f"{DB}/pin_pricing_tests/{PRICING_RUN}/{PRICING_APPROACH}/pins.json") or {}
    )

    rows = build_rows(rules, seed_by_crop, labels, pricing, synonym_groups)
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = root / out_path
    write_csv(out_path, rows)

    buynow_path = Path(args.buynow_out)
    if not buynow_path.is_absolute():
        buynow_path = root / buynow_path
    write_buynow_csv(buynow_path, rows)

    manual_count = sum(1 for r in rows if r.get("reviewed_by") == "Lexi" and r["crop_filename"] in MANUAL_PIN_OVERRIDES)
    meta_path = out_path.with_suffix(".json")
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(),
        "collection": COLLECTION,
        "batch_id": BATCH_ID,
        "pin_count": len(rows),
        "manual_lexi_pins": manual_count,
        "price_rounding": "round_up_to_nearest_5",
        "title_suffix": TITLE_PHOTO_SUFFIX,
        "synonym_groups": len(synonym_groups),
        "csv_path": str(out_path.name),
        "buynow_csv_path": str(buynow_path.name),
        "sample": rows[:3],
        "manual_sample": [r for r in rows if r["crop_filename"] in MANUAL_PIN_OVERRIDES],
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {len(rows)} listings to {out_path}")
    print(f"Wrote Buy It Now CSV to {buynow_path}")
    print(f"Manual Lexi pins added: {manual_count}")
    print(f"Meta: {meta_path}")


if __name__ == "__main__":
    main()
