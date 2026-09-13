#!/usr/bin/env python3
"""Seed Pin Matching Game queue from PriceCollection ui_data.json."""

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


def fb_get(path: str) -> Any:
    url = f"{DB}/{path.lstrip('/')}.json"
    with urllib.request.urlopen(url, timeout=180) as resp:
        return json.loads(resp.read().decode("utf-8") or "null")


def fb_put(path: str, data: Any) -> None:
    url = f"{DB}/{path.lstrip('/')}.json"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="PUT", headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        resp.read()


def fb_patch(path: str, data: dict) -> None:
    url = f"{DB}/{path.lstrip('/')}.json"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="PATCH", headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        resp.read()


def safe_key(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", s)


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


def load_controls(
    test_run_id: str, approach_id: str, collection_for_crops: str, limit_each: int
) -> list[dict]:
    pins = fb_get(f"pin_pricing_tests/{test_run_id}/{approach_id}/pins") or {}
    matches, nomatches = [], []
    for pk, row in pins.items():
        if not isinstance(row, dict):
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
                "batch_id": "controls",
                "collection": collection_for_crops,
                "pin_key": pk,
                "crop_filename": "",
                "crop_url": curl,
                "board_num": "",
                "pin_n": 0,
                "candidate_count": 1,
                "control_answer": "match",
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
                "batch_id": "controls",
                "collection": collection_for_crops,
                "pin_key": pk,
                "crop_filename": "",
                "crop_url": curl,
                "board_num": "",
                "pin_n": 0,
                "candidate_count": 1,
                "control_answer": "no_match",
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ui-data", required=True, type=Path)
    ap.add_argument("--collection", required=True)
    ap.add_argument("--controls-from-firebase-run", default="")
    ap.add_argument("--controls-approach", default="visual_baseline")
    ap.add_argument("--controls-collection", default="PriceCollection_20260907_1903")
    ap.add_argument("--controls-each", type=int, default=40)
    ap.add_argument("--include-resolved", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

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


if __name__ == "__main__":
    raise SystemExit(main())
