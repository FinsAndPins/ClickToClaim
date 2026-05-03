#!/usr/bin/env python3
"""
Regenerate shows_index.json for the GitHub Pages root (Click to request shows).

Scans top-level repo folders that look like shipped show bundles:
  index.html + boards/

Sort is newest-first by the last git commit that touched each folder
(`git log -1` on `folder/`). tie-break: folder name. Folders with no commit
time (e.g. not in git) sort last. Display labels still use YYYYMMDD in the
name when present.

Run from repo root:
  python3 update_shows_index.py

Or set CTR_REPO_ROOT to this repo's root path.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
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


def last_commit_ts(root: Path, folder: str) -> int:
    """Unix time of the most recent commit touching this top-level folder, or 0."""
    # Trailing / makes git treat it as a path prefix (works for names with spaces).
    spec = f"{folder}/"
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%ct", "--", spec],
            cwd=root,
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=15,
        ).strip()
        return int(out) if out else 0
    except (subprocess.CalledProcessError, ValueError, OSError, subprocess.TimeoutExpired):
        return 0


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
        ts = last_commit_ts(root, folder)
        sort_key = f"{ts}" if ts else f"0:{folder}"
        commit_iso = ""
        if ts:
            commit_iso = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(
                timespec="seconds"
            )
        rows.append(
            {
                "folder": folder,
                "label": label,
                "sort_key": sort_key,
                "last_commit_iso": commit_iso,
                "show_url": show_url,
                "_ts": ts,
            }
        )

    # Newest commit first; folders never committed (ts=0) last; then folder name Z→A for ties.
    rows.sort(key=lambda r: (r.get("_ts") or -1, r["folder"]), reverse=True)

    for r in rows:
        r.pop("_ts", None)

    payload = {
        "shows": rows,
        "updated_iso": datetime.now().astimezone().isoformat(timespec="seconds"),
        "base_url": BASE_URL,
        "ordered_by": "last_git_commit_desc",
    }
    out = root / "shows_index.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out} ({len(rows)} show folder(s) with index.html + boards/)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
