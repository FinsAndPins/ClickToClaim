#!/usr/bin/env python3
"""
Regenerate shows_index.json for the GitHub Pages root (Click to request shows).

Scans top-level repo folders that look like shipped show bundles:
  index.html + boards/

Sort is newest-first using the first YYYYMMDD found in the folder name (pure-date
folders sort by that date; names like 20260416_lite_test use 20260416).

Run from repo root:
  python3 update_shows_index.py

Or set CTR_REPO_ROOT to this repo's root path.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

BASE_URL = "https://finsandpins.github.io/ClickToClaim"
DIGITS8 = re.compile(r"\d{8}")
# Ignore typo years (e.g. 2072…) when sorting / labeling; still list the folder.
MIN_YEAR = 2019
MAX_YEAR = 2038


def parse_folder_date(folder: str) -> str | None:
    m = DIGITS8.search(folder)
    if not m:
        return None
    ds = m.group(0)
    try:
        dt = datetime.strptime(ds, "%Y%m%d")
    except ValueError:
        return None
    if not (MIN_YEAR <= dt.year <= MAX_YEAR):
        return None
    return ds


def sort_tuple(folder: str) -> tuple[str, str]:
    ds = parse_folder_date(folder)
    if ds:
        return (ds, folder)
    return ("00000000", folder)


def format_label(folder: str, date_yyyymmdd: str | None) -> str:
    if date_yyyymmdd:
        day = datetime.strptime(date_yyyymmdd, "%Y%m%d")
        pretty = day.strftime("%b %d, %Y").replace(" 0", " ")
        rest = folder
        rest = rest.replace(date_yyyymmdd, "", 1).strip("_").strip()
        if rest:
            return f"{pretty} · {rest.replace('_', ' ')}"
        return pretty
    return folder


def should_skip_dir(name: str) -> bool:
    if name.startswith("."):
        return True
    low = name.lower()
    if low.startswith("template"):
        return True
    return False


def main() -> int:
    root = Path(os.environ.get("CTR_REPO_ROOT", Path(__file__).resolve().parent))
    rows: list[dict[str, str]] = []

    for p in sorted(root.iterdir(), key=lambda x: x.name.lower()):
        if not p.is_dir():
            continue
        if should_skip_dir(p.name):
            continue
        if not (p / "index.html").is_file():
            continue
        if not (p / "boards").is_dir():
            continue

        folder = p.name
        date_str = parse_folder_date(folder)
        label = format_label(folder, date_str)
        seg = quote(folder, safe="")
        show_url = f"{BASE_URL}/{seg}/index.html"
        rows.append(
            {
                "folder": folder,
                "label": label,
                "sort_key": date_str or folder,
                "show_url": show_url,
            }
        )

    rows.sort(key=lambda r: sort_tuple(r["folder"]), reverse=True)

    payload = {
        "shows": rows,
        "updated_iso": datetime.now().astimezone().isoformat(timespec="seconds"),
        "base_url": BASE_URL,
    }
    out = root / "shows_index.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out} ({len(rows)} show folder(s) with index.html + boards/)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
