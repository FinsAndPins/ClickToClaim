#!/usr/bin/env python3
"""Build a CSV review sheet for Steve gold-labeling (dev first).

If predictions exist, include them as suggestions; otherwise titles only.
Does not write into gold_*.json (Steve / a later pass fills gold).
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["dev", "holdout"], default="dev")
    ap.add_argument("--pred", default="", help="optional extract_*.json")
    args = ap.parse_args()

    pins = json.loads((ROOT / "data" / f"{args.split}_50.json").read_text(encoding="utf-8"))["pins"]
    pred_by_id = {}
    if args.pred:
        doc = json.loads(Path(args.pred).read_text(encoding="utf-8"))
        pred_by_id = {r["sample_id"]: r for r in doc.get("predictions", [])}

    out_path = ROOT / "reports" / f"review_{args.split}.csv"
    fields = [
        "sample_id", "crop_filename", "strata", "ebay_title",
        "pred_set", "pred_maker", "pred_park_or_event",
        "pred_le_size", "pred_is_chaser", "pred_is_mystery", "pred_year",
        "pred_drop_tokens", "description_candidate",
        "gold_set", "gold_maker", "gold_park_or_event",
        "gold_le_size", "gold_is_chaser", "gold_is_mystery", "gold_year",
        "notes",
    ]
    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for pin in pins:
            pred_row = pred_by_id.get(pin["sample_id"], {})
            pred = pred_row.get("prediction") or {}
            keep = pred.get("keep") or {}
            q = pred.get("quarantine") or {}
            w.writerow({
                "sample_id": pin["sample_id"],
                "crop_filename": pin.get("crop_filename"),
                "strata": pin.get("strata"),
                "ebay_title": pin.get("ebay_title"),
                "pred_set": keep.get("set"),
                "pred_maker": keep.get("maker"),
                "pred_park_or_event": keep.get("park_or_event"),
                "pred_le_size": q.get("le_size"),
                "pred_is_chaser": q.get("is_chaser"),
                "pred_is_mystery": q.get("is_mystery"),
                "pred_year": q.get("year"),
                "pred_drop_tokens": "|".join(pred.get("drop_tokens") or []),
                "description_candidate": pred_row.get("description_candidate", ""),
                "gold_set": "",
                "gold_maker": "",
                "gold_park_or_event": "",
                "gold_le_size": "",
                "gold_is_chaser": "",
                "gold_is_mystery": "",
                "gold_year": "",
                "notes": "",
            })
    print(f"Wrote {out_path} ({len(pins)} rows)")


if __name__ == "__main__":
    main()
