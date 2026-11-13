#!/usr/bin/env python3
"""Repair PMG crop URLs to PreparingInventory folders that still exist on GitHub.

Most historical PriceCollection folders were pruned from the public repo, so
raw.githubusercontent.com crop links 404 and the left pin goes blank. This
script:
  1) Lists live PriceCollection dirs on PreparingInventory main
  2) Rewrites crop_url for backlog/control items that can map to a live folder
  3) Rebuilds open_backlog / open_control around only those working items
  4) Clears priority open_pricing for batches whose crops are no longer public
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timezone
from typing import Any

DB = "https://fins-and-pins-click-to-claim-default-rtdb.firebaseio.com"
ROOT = "pin_matching_game/v1"
GH_CONTENTS = "https://api.github.com/repos/FinsAndPins/PreparingInventory/contents/"
RAW = (
    "https://raw.githubusercontent.com/FinsAndPins/PreparingInventory/main/"
    "{collection}/crops/{crop}"
)


def fb_get(path: str, shallow: bool = False) -> Any:
    url = f"{DB}/{path.lstrip('/')}.json"
    if shallow:
        url += "?shallow=true"
    with urllib.request.urlopen(url, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8") or "null")


def fb_put(path: str, data: Any) -> None:
    url = f"{DB}/{path.lstrip('/')}.json"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="PUT", headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        resp.read()


def fb_patch(path: str, data: dict) -> None:
    url = f"{DB}/{path.lstrip('/')}.json"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="PATCH", headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        resp.read()


def github_price_collections() -> list[str]:
    req = urllib.request.Request(
        GH_CONTENTS,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "pmg-repair"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        root = json.loads(resp.read().decode())
    return sorted(
        x["name"]
        for x in root
        if x.get("type") == "dir" and str(x.get("name") or "").startswith("PriceCollection_")
    )


def resolve_collection(coll: str, live: list[str]) -> str | None:
    if not coll:
        return None
    if coll in live:
        return coll
    matches = [c for c in live if c == coll or c.startswith(coll + "__") or c.startswith(coll + "_")]
    # Prefer exact-date folder before named suffixes when multiple?
    if not matches:
        return None
    # Prefer shortest (unsuffixed) when present, else first sorted
    matches.sort(key=lambda s: (0 if s == coll else 1, len(s), s))
    return matches[0]


def crop_filename_from_item(item: dict) -> str:
    crop = str(item.get("crop_filename") or "")
    if crop:
        return crop
    pk = str(item.get("pin_key") or "")
    if "__" in pk:
        left = pk.split("__", 1)[0]
        if left.endswith(".jpg"):
            return left
        if left.endswith("_jpg"):
            return left[:-4] + ".jpg"
    return ""


def head_ok(url: str) -> bool:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "pmg-repair"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return 200 <= int(resp.status) < 300
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verify-head", action="store_true", help="HEAD-check each rewritten crop (slower)")
    args = ap.parse_args()

    live = github_price_collections()
    print(f"Live PreparingInventory collections: {len(live)}")
    for c in live:
        print(f"  {c}")

    open_backlog = fb_get(f"{ROOT}/open_backlog", shallow=True) or {}
    ids = list(open_backlog.keys()) if isinstance(open_backlog, dict) else []
    print(f"Scanning open_backlog={len(ids)}")

    keep: dict[str, bool] = {}
    fixed = 0
    skipped = 0
    verified = 0
    batch: dict[str, Any] = {}

    def flush() -> None:
        nonlocal batch
        if args.dry_run or not batch:
            batch = {}
            return
        fb_patch(ROOT, batch)
        batch = {}

    for i, item_id in enumerate(ids):
        item = fb_get(f"{ROOT}/items/{item_id}")
        if not isinstance(item, dict):
            skipped += 1
            continue
        coll = str(item.get("collection") or "")
        resolved = resolve_collection(coll, live)
        crop = crop_filename_from_item(item)
        if not resolved or not crop:
            skipped += 1
            continue
        new_url = RAW.format(collection=resolved, crop=crop)
        if args.verify_head and not head_ok(new_url):
            skipped += 1
            continue
        if args.verify_head:
            verified += 1
        keep[item_id] = True
        patch = {
            f"items/{item_id}/crop_url": new_url,
            f"items/{item_id}/collection": resolved,
            f"items/{item_id}/crop_filename": crop,
            f"open_backlog/{item_id}": True,
        }
        if new_url != (item.get("crop_url") or "") or resolved != coll:
            fixed += 1
        batch.update(patch)
        if len(batch) >= 80:
            flush()
            print(f"  progress {i + 1}/{len(ids)} keep={len(keep)} fixed={fixed}", flush=True)

    flush()

    # Rebuild open_backlog index to only keepable ids.
    if not args.dry_run:
        fb_put(f"{ROOT}/open_backlog", keep)

    # Clear dead priority open indexes.
    meta = fb_get(f"{ROOT}/meta") or {}
    active = str((meta or {}).get("active_batch") or "")
    priority_cleared = False
    if active and resolve_collection(active, live) is None:
        if not args.dry_run:
            fb_put(f"{ROOT}/open_pricing/{active}", {})
            fb_patch(f"{ROOT}/meta", {"active_batch": None})
        priority_cleared = True

    # Rebuild a small control set from the newest live collection with crops.
    control_source = live[-1] if live else ""
    controls_seeded = 0
    if control_source and not args.dry_run:
        # Prefer a large recent unsuffixed collection if present.
        for pref in (
            "PriceCollection_20261107_2018",
            "PriceCollection_20261110_2046",
            "PriceCollection_20261103_1408",
        ):
            if pref in live:
                control_source = pref
                break
        # Soft-clear open_control; keep old control items but stop serving dead ones.
        fb_put(f"{ROOT}/open_control", {})
        # Pull a few decided pins from Firebase for this collection's latest run if possible.
        # Fallback: promote backlog known answers from this collection into controls.
        for item_id in list(keep.keys()):
            if controls_seeded >= 80:
                break
            item = fb_get(f"{ROOT}/items/{item_id}")
            if not isinstance(item, dict):
                continue
            if item.get("collection") != control_source:
                continue
            answer = item.get("known_answer") or item.get("control_answer")
            if answer not in {"match", "no_match"}:
                continue
            if not item.get("crop_url") or not item.get("cand_thumb"):
                continue
            # Reuse backlog item as control-capable by also indexing in open_control
            # only for a capped subset; durable backlog entry remains.
            if controls_seeded < 40 or answer == "no_match":
                fb_patch(
                    f"{ROOT}/items/{item_id}",
                    {
                        "control_answer": answer,
                        "known_answer": answer,
                    },
                )
                fb_patch(f"{ROOT}/open_control", {item_id: True})
                controls_seeded += 1

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta_patch = {
        "available_crop_collections": live,
        "backlog_count": len(keep),
        "backlog_updated_at": now,
        "backlog_alert": None if len(keep) >= 1000 else ("hard_floor" if len(keep) < 1000 else "low_water"),
        "crop_repair_at": now,
        "updated_at": now,
    }
    if not args.dry_run:
        if len(keep) < 1000:
            meta_patch["backlog_alert"] = "hard_floor"
        elif len(keep) < 5000:
            meta_patch["backlog_alert"] = "low_water"
        else:
            meta_patch["backlog_alert"] = None
        fb_patch(f"{ROOT}/meta", meta_patch)

    print(
        json.dumps(
            {
                "live_collections": len(live),
                "scanned": len(ids),
                "kept": len(keep),
                "fixed": fixed,
                "skipped": skipped,
                "verified": verified,
                "priority_cleared": priority_cleared,
                "active_batch": active,
                "controls_seeded": controls_seeded,
                "control_source": control_source,
                "dry_run": args.dry_run,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
