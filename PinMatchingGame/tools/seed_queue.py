#!/usr/bin/env python3
"""Seed Pin Matching Game queue from PriceCollection ui_data.json or Firebase history.

Priority lane (existing): open pricing pairs that may write harness on consensus.
Backlog lane (durable forever): historically decided CTM/CTP pairs with known answers.
Votes on backlog never remove the pair and never write the pricing harness.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB = "https://fins-and-pins-click-to-claim-default-rtdb.firebaseio.com"
ROOT = "pin_matching_game/v1"
RAW_CROP = (
    "https://raw.githubusercontent.com/FinsAndPins/PreparingInventory/main/"
    "{collection}/crops/{crop}"
)
BACKLOG_LOW_WATER = 5000
BACKLOG_HARD_FLOOR = 1000


def _fb_call(req: urllib.request.Request, attempts: int = 6) -> Any:
    last: Exception | None = None
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                return json.loads(resp.read().decode("utf-8") or "null")
        except Exception as exc:  # noqa: BLE001 - network retries
            last = exc
            wait = min(2 ** i, 30)
            print(f"WARN: Firebase retry {i + 1}/{attempts} after {exc}; sleep {wait}s", flush=True)
            import time

            time.sleep(wait)
    assert last is not None
    raise last


def fb_get(path: str, shallow: bool = False) -> Any:
    url = f"{DB}/{path.lstrip('/')}.json"
    if shallow:
        url += "?shallow=true"
    return _fb_call(urllib.request.Request(url, method="GET"))


def fb_put(path: str, data: Any) -> None:
    url = f"{DB}/{path.lstrip('/')}.json"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="PUT", headers={"Content-Type": "application/json"}
    )
    _fb_call(req)


def fb_patch(path: str, data: dict) -> None:
    url = f"{DB}/{path.lstrip('/')}.json"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="PATCH", headers={"Content-Type": "application/json"}
    )
    _fb_call(req)


def safe_key(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", s)[:180]


def make_item_id(collection: str, pin_key: str, slot: int) -> str:
    return safe_key(f"{collection}__{pin_key}__s{slot}")


def make_crop_url(collection: str, crop_filename: str) -> str:
    return RAW_CROP.format(collection=collection, crop=crop_filename)


def cand_fields(cands: list, slot: int) -> dict:
    empty = {
        "cand_slot": slot,
        "cand_title": "",
        "cand_url": "",
        "cand_thumb": "",
        "cand_price": 0,
        "cand_item_id": "",
    }
    if not cands or slot < 0 or slot >= len(cands):
        return empty
    c = cands[slot] or {}
    price = c.get("total_price")
    if price is None:
        price = c.get("price") or 0
    try:
        price = float(price)
    except (TypeError, ValueError):
        price = 0.0
    return {
        "cand_slot": slot,
        "cand_title": str(c.get("title") or ""),
        "cand_url": str(c.get("itemUrl") or c.get("url") or ""),
        "cand_thumb": str(c.get("thumbUrl") or c.get("thumb") or ""),
        "cand_price": round(price, 2),
        "cand_item_id": str(c.get("itemId") or c.get("item_id") or ""),
    }


def harness_resolved(test_run_id: str, approach_id: str, pin_key: str) -> bool:
    path = f"pin_pricing_tests/{test_run_id}/{approach_id}/pins/{safe_key(pin_key)}"
    try:
        row = fb_get(path)
    except urllib.error.HTTPError:
        return False
    if not isinstance(row, dict):
        return False
    ms = row.get("match_status") or row.get("ctm_match_status")
    return ms in {"match", "no_match", "not_a_pin", "auto_match", "priced"}


def build_pricing_item(
    collection: str, test_run_id: str, approach_id: str, pin: dict, slot: int = 0
) -> dict:
    pin_key = str(pin["pin_key"])
    cands = pin.get("candidates") or []
    return {
        "id": make_item_id(collection, pin_key, slot),
        "kind": "pricing",
        "lane": "priority",
        "batch_id": collection,
        "collection": collection,
        "pin_key": pin_key,
        "crop_filename": str(pin.get("crop_filename") or ""),
        "crop_url": make_crop_url(collection, str(pin.get("crop_filename") or "")),
        "board_num": str(pin.get("board_num") or ""),
        "pin_n": int(pin.get("pin_n") or 0),
        "candidate_count": len(cands),
        "all_candidates": [
            {
                "itemId": str(c.get("itemId") or ""),
                "title": str(c.get("title") or ""),
                "itemUrl": str(c.get("itemUrl") or ""),
                "thumbUrl": str(c.get("thumbUrl") or ""),
                "price": float(c.get("price") or 0),
                "total_price": float(c.get("total_price") or c.get("price") or 0),
                "rank": int(c.get("rank") or i + 1),
            }
            for i, c in enumerate(cands)
        ],
        "control_answer": None,
        "known_answer": None,
        "status": "open",
        "tallies": {"match": 0, "no_match": 0, "not_a_pin": 0},
        "participant_count": 0,
        "harness": {
            "test_run_id": test_run_id,
            "approach_id": approach_id,
            "pin_key": pin_key,
            "write": True,
        },
        **cand_fields(cands, slot),
    }


def guess_crop(pin_key: str, row: dict) -> str:
    crop = str(row.get("crop_filename") or "")
    if crop:
        return crop
    raw = str(row.get("pin_key") or pin_key)
    if "__" in raw:
        left = raw.split("__", 1)[0]
        if left.endswith(".jpg"):
            return left
        if left.endswith("_jpg"):
            return left[:-4] + ".jpg"
    return ""


def collection_from_run_id(test_run_id: str) -> str:
    m = re.match(r"test_(PriceCollection_\d{8}_\d+)", test_run_id)
    if m:
        return m.group(1)
    m = re.match(r"test_((?:PriceCollection|PC)_[A-Za-z0-9]+)", test_run_id)
    if m:
        return m.group(1)
    return ""


def cand_identity(cand: dict) -> str:
    return str(
        cand.get("itemId")
        or cand.get("item_id")
        or cand.get("itemUrl")
        or cand.get("url")
        or cand.get("thumbUrl")
        or cand.get("thumb")
        or cand.get("title")
        or ""
    )


def normalize_cand(cand: dict) -> dict:
    price = cand.get("total_price")
    if price is None:
        price = cand.get("price") or 0
    try:
        price = float(price)
    except (TypeError, ValueError):
        price = 0.0
    return {
        "itemId": str(cand.get("itemId") or cand.get("item_id") or ""),
        "title": str(cand.get("title") or ""),
        "itemUrl": str(cand.get("itemUrl") or cand.get("url") or ""),
        "thumbUrl": str(cand.get("thumbUrl") or cand.get("thumb") or ""),
        "price": price,
        "total_price": price,
        "rank": int(cand.get("rank") or 1),
    }


def known_answer_from_row(row: dict) -> str | None:
    """Eligible ground truth for durable backlog.

    Include CTM match/no_match and CTP/listing match.
    Exclude manual price overrides (not proof of visual match).
    """
    if str(row.get("price_source") or "") == "manual":
        return None
    ctm = row.get("ctm_match_status")
    if ctm in {"match", "no_match"}:
        return str(ctm)
    ms = row.get("match_status")
    if ms == "match":
        return "match"
    if ms == "no_match":
        # Legacy rows without ctm_match_status (almost always Lexi/Steve CTM).
        return "no_match"
    return None


def pick_backlog_candidate(row: dict, answer: str) -> dict | None:
    selected = row.get("selected_candidate") if isinstance(row.get("selected_candidate"), dict) else {}
    slot0 = row.get("pipeline_slot0") if isinstance(row.get("pipeline_slot0"), dict) else {}
    if answer == "match":
        cand = selected or slot0
    else:
        cand = slot0 or selected
    if not cand:
        return None
    norm = normalize_cand(cand)
    if not (norm["thumbUrl"] or norm["itemUrl"] or norm["title"]):
        return None
    return norm


def build_backlog_item(
    *,
    collection: str,
    test_run_id: str,
    approach_id: str,
    pin_key: str,
    row: dict,
    answer: str,
    cand: dict,
) -> dict:
    crop = guess_crop(pin_key, row)
    item_id = safe_key(f"backlog__{collection}__{pin_key}__{answer}__{cand_identity(cand)[:40]}")
    return {
        "id": item_id,
        "kind": "backlog",
        "lane": "backlog",
        "durable": True,
        "batch_id": "backlog",
        "collection": collection,
        "pin_key": pin_key,
        "crop_filename": crop,
        "crop_url": make_crop_url(collection, crop) if crop and collection else "",
        "board_num": str(row.get("board_num") or ""),
        "pin_n": int(row.get("pin_n") or 0),
        "candidate_count": 1,
        "control_answer": answer,
        "known_answer": answer,
        "answer_source": "ctm" if row.get("ctm_match_status") in {"match", "no_match"} else "ctp_or_legacy",
        "status": "open",
        "tallies": {"match": 0, "no_match": 0, "not_a_pin": 0},
        "participant_count": 0,
        "harness": {
            "test_run_id": test_run_id,
            "approach_id": approach_id,
            "pin_key": pin_key,
            "write": False,
        },
        "cand_slot": 0,
        "cand_title": cand["title"],
        "cand_url": cand["itemUrl"],
        "cand_thumb": cand["thumbUrl"],
        "cand_price": round(float(cand["total_price"] or 0), 2),
        "cand_item_id": cand["itemId"],
        "source_test_run_id": test_run_id,
        "source_approach_id": approach_id,
    }


def load_controls(
    test_run_id: str, approach_id: str, collection_for_crops: str, limit_each: int
) -> list[dict]:
    pins = fb_get(f"pin_pricing_tests/{test_run_id}/{approach_id}/pins") or {}
    matches, nomatches = [], []
    for pk, row in pins.items():
        if not isinstance(row, dict):
            continue
        if str(row.get("price_source") or "") == "manual":
            continue
        ms = row.get("ctm_match_status") or row.get("match_status")
        crop = guess_crop(pk, row)
        if not crop:
            continue
        curl = make_crop_url(collection_for_crops, crop)
        slot0 = row.get("pipeline_slot0") or {}
        selected = row.get("selected_candidate") or {}
        if ms == "match" and selected:
            matches.append((pk, curl, selected))
        elif ms == "no_match" and (slot0 or selected):
            nomatches.append((pk, curl, slot0 or selected))

    out: list[dict] = []
    for i, (pk, curl, cand) in enumerate(matches[:limit_each]):
        out.append(
            {
                "id": safe_key(f"control__{collection_for_crops}__{pk}__m{i}"),
                "kind": "control",
                "lane": "control",
                "batch_id": "controls",
                "collection": collection_for_crops,
                "pin_key": pk,
                "crop_filename": "",
                "crop_url": curl,
                "board_num": "",
                "pin_n": 0,
                "candidate_count": 1,
                "control_answer": "match",
                "known_answer": "match",
                "status": "open",
                "tallies": {"match": 0, "no_match": 0, "not_a_pin": 0},
                "participant_count": 0,
                "harness": {"write": False},
                "cand_slot": 0,
                "cand_title": str(cand.get("title") or ""),
                "cand_url": str(cand.get("itemUrl") or cand.get("url") or ""),
                "cand_thumb": str(cand.get("thumbUrl") or cand.get("thumb") or ""),
                "cand_price": float(cand.get("total_price") or cand.get("price") or 0),
                "cand_item_id": str(cand.get("itemId") or ""),
            }
        )
    for i, (pk, curl, cand) in enumerate(nomatches[:limit_each]):
        out.append(
            {
                "id": safe_key(f"control__{collection_for_crops}__{pk}__n{i}"),
                "kind": "control",
                "lane": "control",
                "batch_id": "controls",
                "collection": collection_for_crops,
                "pin_key": pk,
                "crop_filename": "",
                "crop_url": curl,
                "board_num": "",
                "pin_n": 0,
                "candidate_count": 1,
                "control_answer": "no_match",
                "known_answer": "no_match",
                "status": "open",
                "tallies": {"match": 0, "no_match": 0, "not_a_pin": 0},
                "participant_count": 0,
                "harness": {"write": False},
                "cand_slot": 0,
                "cand_title": str(cand.get("title") or ""),
                "cand_url": str(cand.get("itemUrl") or cand.get("url") or ""),
                "cand_thumb": str(cand.get("thumbUrl") or cand.get("thumb") or ""),
                "cand_price": float(cand.get("total_price") or cand.get("price") or 0),
                "cand_item_id": str(cand.get("itemId") or ""),
            }
        )
    return out


def ranked_run_ids(run_ids: list[str]) -> list[str]:
    """Prefer dated PriceCollection runs (newest first); keep others after."""

    def sort_key(rid: str) -> tuple:
        m = re.search(r"PriceCollection_(\d{8})_(\d+)", rid)
        if m:
            return (0, -int(m.group(1)), -int(m.group(2)), rid)
        return (1, 0, 0, rid)

    return sorted(run_ids, key=sort_key)


def flush_backlog_chunk(chunk: list[dict], open_ids: list[str]) -> None:
    if not chunk:
        return
    multi: dict[str, Any] = {}
    for it in chunk:
        multi[f"items/{it['id']}"] = it
        multi[f"open_backlog/{it['id']}"] = True
        open_ids.append(it["id"])
    fb_patch(ROOT, multi)


def seed_backlog(args: argparse.Namespace) -> int:
    """Stream-scan Firebase history and write durable backlog in small batches."""
    runs = fb_get("pin_pricing_tests", shallow=True) or {}
    run_ids = ranked_run_ids(list(runs.keys()))
    if args.run_limit:
        run_ids = run_ids[: args.run_limit]

    seen: set[str] = set()
    pending: list[dict] = []
    open_ids: list[str] = []
    batch_size = 40
    stats = {
        "runs_scanned": 0,
        "pins_seen": 0,
        "eligible": 0,
        "written": 0,
        "skipped_manual": 0,
        "skipped_no_answer": 0,
        "skipped_no_cand": 0,
        "skipped_no_collection": 0,
        "skipped_dup": 0,
        "match": 0,
        "no_match": 0,
    }

    already: set[str] = set()
    if not args.dry_run:
        if args.replace_open_index:
            fb_put(f"{ROOT}/open_backlog", {})
        else:
            existing = fb_get(f"{ROOT}/open_backlog", shallow=True) or {}
            if isinstance(existing, dict):
                already = set(existing.keys())
                print(f"Resuming with {len(already)} existing open_backlog ids", flush=True)

    for rid in run_ids:
        stats["runs_scanned"] += 1
        collection = collection_from_run_id(rid)
        if not collection:
            stats["skipped_no_collection"] += 1
            continue
        try:
            apps = fb_get(f"pin_pricing_tests/{rid}", shallow=True) or {}
        except Exception as exc:
            print(f"WARN: skip run {rid}: {exc}", file=sys.stderr)
            continue
        app = (
            args.controls_approach
            if args.controls_approach in apps
            else (next(iter(apps), "") if apps else "")
        )
        if not app:
            continue
        try:
            pins = fb_get(f"pin_pricing_tests/{rid}/{app}/pins") or {}
        except Exception as exc:
            print(f"WARN: skip pins {rid}/{app}: {exc}", file=sys.stderr)
            continue
        if not isinstance(pins, dict):
            continue

        for pk, row in pins.items():
            if not isinstance(row, dict):
                continue
            stats["pins_seen"] += 1
            if str(row.get("price_source") or "") == "manual":
                stats["skipped_manual"] += 1
                continue
            answer = known_answer_from_row(row)
            if not answer:
                stats["skipped_no_answer"] += 1
                continue
            cand = pick_backlog_candidate(row, answer)
            if not cand:
                stats["skipped_no_cand"] += 1
                continue
            crop = guess_crop(pk, row)
            dedupe = safe_key(f"{crop}|{cand_identity(cand)}|{answer}")
            if dedupe in seen:
                stats["skipped_dup"] += 1
                continue
            seen.add(dedupe)
            item = build_backlog_item(
                collection=collection,
                test_run_id=rid,
                approach_id=app,
                pin_key=str(row.get("pin_key") or pk),
                row=row,
                answer=answer,
                cand=cand,
            )
            if not item["crop_url"] or not item["cand_thumb"]:
                stats["skipped_no_cand"] += 1
                continue
            if item["id"] in already:
                stats["skipped_dup"] += 1
                continue
            stats["eligible"] += 1
            stats[answer] = int(stats.get(answer, 0)) + 1
            if args.dry_run:
                if args.limit and stats["eligible"] >= args.limit:
                    break
                continue
            pending.append(item)
            if len(pending) >= batch_size:
                flush_backlog_chunk(pending, open_ids)
                stats["written"] += len(pending)
                pending = []
                if stats["written"] % 200 == 0:
                    print(f"  backlog put {stats['written']}", flush=True)
            if args.limit and stats["eligible"] >= args.limit:
                break

        if stats["runs_scanned"] % 25 == 0:
            print(
                f"  scanned {stats['runs_scanned']}/{len(run_ids)} runs; "
                f"eligible={stats['eligible']} written={stats['written']}",
                flush=True,
            )
        if args.limit and stats["eligible"] >= args.limit:
            break

    if args.dry_run:
        print(json.dumps({"stats": stats, "to_write": stats["eligible"]}, indent=2))
        print("Dry run only; no Firebase writes.")
        return 0

    if pending:
        flush_backlog_chunk(pending, open_ids)
        stats["written"] += len(pending)
        pending = []

    open_now = fb_get(f"{ROOT}/open_backlog", shallow=True) or {}
    n = len(open_now) if isinstance(open_now, dict) else stats["written"]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    alert = None
    if n < BACKLOG_HARD_FLOOR:
        alert = "hard_floor"
    elif n < BACKLOG_LOW_WATER:
        alert = "low_water"

    fb_patch(
        f"{ROOT}/meta",
        {
            "backlog_count": n,
            "backlog_updated_at": now,
            "backlog_low_water": BACKLOG_LOW_WATER,
            "backlog_hard_floor": BACKLOG_HARD_FLOOR,
            "backlog_alert": alert,
            "backlog_durable": True,
            "updated_at": now,
        },
    )
    fb_patch(
        f"{ROOT}/batches/backlog",
        {
            "collection": "backlog",
            "lane": "backlog",
            "durable": True,
            "pricing_open": 0,
            "backlog_open": n,
            "match": stats.get("match", 0),
            "no_match": stats.get("no_match", 0),
            "active": True,
            "updated_at": now,
            "seed_stats": stats,
        },
    )
    print(json.dumps({"stats": stats, "open_backlog_count": n}, indent=2), flush=True)
    print(f"Seeded durable backlog open={n} wrote_this_run={stats['written']} alert={alert}", flush=True)
    return 0


def seed_priority(args: argparse.Namespace) -> int:
    ui = json.loads(args.ui_data.read_text(encoding="utf-8"))
    test_run_id = ui["test_run_id"]
    approach_id = ui["approach_id"]
    skip_resolved = not args.include_resolved

    pricing_items: list[dict] = []
    for board in ui.get("boards") or []:
        for pin in board.get("pins") or []:
            pin_key = str(pin.get("pin_key") or "")
            if not pin_key:
                continue
            if skip_resolved and harness_resolved(test_run_id, approach_id, pin_key):
                continue
            if not (pin.get("candidates") or []):
                continue
            pricing_items.append(
                build_pricing_item(args.collection, test_run_id, approach_id, pin, 0)
            )
            if args.limit and len(pricing_items) >= args.limit:
                break
        if args.limit and len(pricing_items) >= args.limit:
            break

    control_items: list[dict] = []
    if args.controls_from_firebase_run:
        try:
            control_items = load_controls(
                args.controls_from_firebase_run,
                args.controls_approach,
                args.controls_collection,
                args.controls_each,
            )
        except Exception as exc:
            print(f"WARN: controls load failed: {exc}", file=sys.stderr)

    open_pricing: dict[str, bool] = {}
    for i, it in enumerate(pricing_items):
        fb_put(f"{ROOT}/items/{it['id']}", it)
        open_pricing[it["id"]] = True
        if (i + 1) % 50 == 0:
            print(f"  pricing put {i + 1}/{len(pricing_items)}")
    if open_pricing:
        fb_put(f"{ROOT}/open_pricing/{args.collection}", open_pricing)

    for it in control_items:
        fb_put(f"{ROOT}/items/{it['id']}", it)
        fb_patch(f"{ROOT}/open_control", {it["id"]: True})

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    fb_patch(
        f"{ROOT}/batches/{args.collection}",
        {
            "collection": args.collection,
            "test_run_id": test_run_id,
            "approach_id": approach_id,
            "lane": "priority",
            "pricing_open": len(pricing_items),
            "controls_seeded": len(control_items),
            "active": True,
            "updated_at": now,
        },
    )
    fb_patch(f"{ROOT}/meta", {"active_batch": args.collection, "updated_at": now})

    print(
        f"Seeded pricing={len(pricing_items)} controls={len(control_items)} "
        f"batch={args.collection}"
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ui-data", type=Path, default=None)
    ap.add_argument("--collection", default="")
    ap.add_argument("--controls-from-firebase-run", default="")
    ap.add_argument("--controls-approach", default="visual_baseline")
    ap.add_argument("--controls-collection", default="PriceCollection_20260907_1903")
    ap.add_argument("--controls-each", type=int, default=40)
    ap.add_argument("--include-resolved", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--run-limit", type=int, default=0, help="Only scan the newest N pricing runs")
    ap.add_argument(
        "--seed-backlog-from-firebase",
        action="store_true",
        help="Seed durable backlog from all decided CTM/CTP pairs in Firebase",
    )
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--replace-open-index",
        action="store_true",
        help="Clear open_backlog before seeding (default resumes and skips existing ids)",
    )
    args = ap.parse_args()

    if args.seed_backlog_from_firebase:
        return seed_backlog(args)
    if not args.ui_data or not args.collection:
        ap.error("--ui-data and --collection are required unless --seed-backlog-from-firebase")
    return seed_priority(args)


if __name__ == "__main__":
    raise SystemExit(main())
