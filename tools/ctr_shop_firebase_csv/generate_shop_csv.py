#!/usr/bin/env python3
"""
Build a Whatnot bulk-upload CSV (and optional harness JSON) from a Firebase RTDB
export of Click To Request `claims/{showSlug}`.

Typical morning-of-show workflow:
  1. Export RTDB JSON from Firebase console (or REST) and save as e.g.
     `firebase-rtdb-backup-20260406.json` next to this repo (ignored by git).
  2. Run this script with --input, --show, --max-clicks 3.
  3. Open `pricing_harness.html`, load the generated `*_shop_queue.json`,
     adjust prices, export final CSV.

Whatnot column order matches existing Fins & Pins templates (e.g. ClickToDescribe
reports): Category, Sub Category, Title, Description, Quantity, Type, Price, ...
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PIN_KEY_RE = re.compile(r"^IMG_(\d+)-(\d+)$")

WHATNOT_HEADERS = [
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
    "Image URL 2",
    "Image URL 3",
    "Image URL 4",
    "Image URL 5",
    "Image URL 6",
    "Image URL 7",
    "Image URL 8",
]


def adjust_price_default_model(raw: Optional[float]) -> int:
    """Same floor / $5 step as ClickToPrice20260402 (no eBay → floor)."""
    if raw is None or (isinstance(raw, float) and raw != raw):  # NaN
        return 10
    p = max(10.0, float(raw))
    return int(round(p / 5.0) * 5)


def _is_pin_keyed_claims_map(d: Dict[str, Any]) -> bool:
    """True when JSON is a single-show slice: top-level keys are all `IMG_####-#`."""
    if not d:
        return False
    for k in d:
        if not PIN_KEY_RE.match(str(k)):
            return False
    return True


def get_show_claims(data: Any, show_slug: str) -> Dict[str, Any]:
    """
    Resolve pinKey → users map for one show.

    Accepts:
    - Firebase console **slice** export: root is `{ "IMG_3063-0": { users... }, ... }`
    - Full RTDB JSON: `claims.{showSlug}` is that map
    """
    if not isinstance(data, dict):
        raise SystemExit("JSON root must be an object")
    if _is_pin_keyed_claims_map(data):
        return data
    claims = data.get("claims")
    if isinstance(claims, dict) and show_slug in claims:
        raw = claims[show_slug]
        if not isinstance(raw, dict):
            raise SystemExit(f"claims/{show_slug} is not an object")
        return raw
    if isinstance(claims, dict):
        keys = sorted(claims.keys())
        raise SystemExit(
            f"No claims/{show_slug} in export. Available slugs (sample): {keys[:25]} …"
        )
    raise SystemExit(
        "Could not find claims. Expected pin-keyed slice at root, or full export with claims/{show}."
    )


def display_names_for_users(users: Any) -> List[str]:
    if not isinstance(users, dict):
        return []
    names: List[str] = []
    for user_key, payload in users.items():
        if payload is None:
            continue
        uk = str(user_key).strip()
        if isinstance(payload, dict):
            lab = payload.get("label")
            if lab is not None and str(lab).strip():
                names.append(str(lab).strip())
            elif uk.startswith("@"):
                names.append(uk)
        elif payload is True:
            if uk.startswith("@"):
                names.append(uk)
            else:
                names.append(uk)
    return sorted(set(names), key=lambda s: s.lower())


def click_count(users: Any) -> int:
    if not isinstance(users, dict):
        return 0
    n = 0
    for _k, payload in users.items():
        if payload is None:
            continue
        if isinstance(payload, dict):
            n += 1
        elif payload is True:
            n += 1
    return n


def parse_pin_key(pin_key: str) -> Optional[Tuple[int, int, str]]:
    """
    Return (img_num, pin_index_0based, sku_display) where sku_display is '3076-01'.
    """
    m = PIN_KEY_RE.match(pin_key.strip())
    if not m:
        return None
    img = int(m.group(1))
    idx0 = int(m.group(2))
    pin_display = idx0 + 1
    sku = f"{img}-{pin_display:02d}"
    return img, idx0, sku


def build_image_url(template: Optional[str], img: int, pin_display: int) -> str:
    if not template:
        return ""
    return template.replace("{img}", str(img)).replace("{pin02}", f"{pin_display:02d}")


def write_whatnot_csv_rows(
    rows_out: List[dict],
    price_key: str = "price",
) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(WHATNOT_HEADERS)
    for r in rows_out:
        price_val = r.get(price_key, "")
        if price_val is None or price_val == "":
            pstr = ""
        else:
            pstr = str(int(price_val)) if float(price_val) == int(float(price_val)) else str(price_val)
        w.writerow(
            [
                "Disneyana",
                "Disney Pins",
                r["title"],
                r["description"],
                "1",
                "Buy it Now",
                pstr,
                "0-1 oz",
                "TRUE",
                "Not Hazmat",
                "Used",
                "",
                r["sku"],
                r.get("image_url_1", ""),
                "",
                "",
                "",
                "",
                "",
                "",
                "",
            ]
        )
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", "-i", required=True, type=Path, help="Firebase JSON export path")
    ap.add_argument("--show", "-s", required=True, help="Show slug folder, e.g. 20260406")
    ap.add_argument(
        "--max-clicks",
        type=int,
        default=3,
        help="Include pins whose click count is <= this value (default: 3 shop tier)",
    )
    ap.add_argument(
        "--min-clicks",
        type=int,
        default=1,
        help="Require at least this many clicks (default: 1)",
    )
    ap.add_argument(
        "--output-csv",
        "-o",
        type=Path,
        help="Write Whatnot bulk CSV here",
    )
    ap.add_argument(
        "--harness-json",
        type=Path,
        help="Write pricing_harness.json (queue + metadata)",
    )
    ap.add_argument(
        "--image-url-template",
        default="",
        help="Optional URL template with {img} and {pin02}, e.g. "
        "https://…/pins/img{img}_pin{pin02}.jpg",
    )
    ap.add_argument(
        "--empty-price",
        action="store_true",
        help="Leave Price blank in CSV (Whatnot may still want a value in UI harness)",
    )
    args = ap.parse_args()

    data = json.loads(args.input.read_text(encoding="utf-8"))
    show_claims = get_show_claims(data, args.show)

    tier_rows: List[dict] = []
    skipped_bad_key = 0
    for pin_key, users in show_claims.items():
        parsed = parse_pin_key(pin_key)
        if not parsed:
            skipped_bad_key += 1
            continue
        img, _idx0, sku = parsed
        n = click_count(users)
        if n < args.min_clicks or n > args.max_clicks:
            continue
        names = display_names_for_users(users)
        pin_display = int(sku.split("-")[1])
        title = f"Click to Request {args.show} {sku}"
        desc = "Requested by " + ", ".join(names) if names else "Requested by (no labels)"
        img_url = build_image_url(args.image_url_template or None, img, pin_display)
        suggested = adjust_price_default_model(None)
        price_out = "" if args.empty_price else suggested
        tier_rows.append(
            {
                "pinKey": pin_key,
                "sku": sku,
                "title": title,
                "description": desc,
                "image_url_1": img_url,
                "click_count": n,
                "requesters": names,
                "price": price_out,
                "suggestedPrice": suggested,
            }
        )

    tier_rows.sort(key=lambda r: (int(r["sku"].split("-")[0]), int(r["sku"].split("-")[1])))

    ge4 = sum(
        1
        for pk, u in show_claims.items()
        if PIN_KEY_RE.match(pk) and args.min_clicks <= click_count(u) and click_count(u) >= 4
    )
    total_matched_keys = sum(1 for pk in show_claims if PIN_KEY_RE.match(pk))

    print(
        f"Show {args.show}: matched pin keys={total_matched_keys}, "
        f"tier <={args.max_clicks} (and >={args.min_clicks})={len(tier_rows)}, "
        f"pins with >=4 clicks={ge4}, skipped non-standard keys={skipped_bad_key}",
        file=sys.stderr,
    )

    if args.output_csv:
        args.output_csv.parent.mkdir(parents=True, exist_ok=True)
        csv_text = write_whatnot_csv_rows(tier_rows, price_key="price")
        args.output_csv.write_text(csv_text, encoding="utf-8")
        print(f"Wrote {args.output_csv}", file=sys.stderr)

    if args.harness_json:
        payload = {
            "meta": {
                "show": args.show,
                "maxClicks": args.max_clicks,
                "minClicks": args.min_clicks,
                "generated": datetime.now(timezone.utc).isoformat(),
                "input": str(args.input.resolve()),
            },
            "whatnotHeaders": WHATNOT_HEADERS,
            "pins": tier_rows,
        }
        args.harness_json.parent.mkdir(parents=True, exist_ok=True)
        args.harness_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"Wrote {args.harness_json}", file=sys.stderr)

    if not args.output_csv and not args.harness_json:
        raise SystemExit("Specify --output-csv and/or --harness-json")


if __name__ == "__main__":
    main()
