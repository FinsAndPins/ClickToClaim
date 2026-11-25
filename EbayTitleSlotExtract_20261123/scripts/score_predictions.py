#!/usr/bin/env python3
"""Score LLM predictions against gold_*.json for EbayTitleSlotExtract_20261123.

Gates (must pass before declaring a winner):
  - quarantine_leak_rate == 0  (LE size / Chaser / Mystery / year never in description_candidate)
  - holdout scored only after gold_holdout_50.json is filled and scorer frozen

Usage:
  python3 scripts/score_predictions.py --split dev --pred reports/extract_dev_gemini.json
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

QUARANTINE_PATTERNS = [
    re.compile(r"\bLE\s*\d{2,5}\b", re.I),
    re.compile(r"\b\d{2,5}\s*/\s*\d{2,5}\b"),
    re.compile(r"\bchaser\b", re.I),
    re.compile(r"\bmystery\b", re.I),
    re.compile(r"\b(19|20)\d{2}\b"),
]


def norm(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", str(s).strip().lower())


def field_match(pred_val, gold_val) -> str:
    """Return exact | partial | miss | both_empty | gold_empty_pred | pred_empty_gold."""
    p, g = norm(pred_val if not isinstance(pred_val, bool) else str(pred_val)), norm(
        gold_val if not isinstance(gold_val, bool) else str(gold_val)
    )
    if not p and not g:
        return "both_empty"
    if not g and p:
        return "gold_empty_pred"
    if g and not p:
        return "pred_empty_gold"
    if p == g:
        return "exact"
    if p in g or g in p:
        return "partial"
    return "miss"


def quarantine_leak(description: str, pred: dict) -> list[str]:
    leaks = []
    desc = description or ""
    for pat in QUARANTINE_PATTERNS:
        if pat.search(desc):
            leaks.append(f"pattern:{pat.pattern}")
    q = pred.get("quarantine") or {}
    for key in ("le_size", "year"):
        val = q.get(key)
        if val and norm(str(val)) and norm(str(val)) in norm(desc):
            leaks.append(f"field:{key}")
    if q.get("is_chaser") and re.search(r"\bchaser\b", desc, re.I):
        leaks.append("field:is_chaser")
    if q.get("is_mystery") and re.search(r"\bmystery\b", desc, re.I):
        leaks.append("field:is_mystery")
    return leaks


def gold_filled(gold_row: dict) -> bool:
    keep = gold_row.get("keep") or {}
    # Consider filled if any keep field is non-null OR notes present OR explicit empty marked
    if gold_row.get("notes"):
        return True
    if any(keep.get(k) is not None for k in ("set", "maker", "park_or_event")):
        return True
    # Explicit empty gold: set all keep to "" string
    if all(keep.get(k) == "" for k in ("set", "maker", "park_or_event")):
        return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["dev", "holdout"], required=True)
    ap.add_argument("--pred", required=True, help="extract_*.json from run_extract.py")
    args = ap.parse_args()

    pred_doc = json.loads(Path(args.pred).read_text(encoding="utf-8"))
    # Accept gold_dev_50.json or gold_dev_template.json (list or {pins:[...]})
    candidates = [
        ROOT / "data" / f"gold_{args.split}_50.json",
        ROOT / "data" / f"gold_{args.split}_template.json",
    ]
    gold_path = next((p for p in candidates if p.exists()), None)
    if not gold_path:
        raise SystemExit(f"No gold file found for split={args.split}")
    gold_raw = json.loads(gold_path.read_text(encoding="utf-8"))
    gold_list = gold_raw["pins"] if isinstance(gold_raw, dict) else gold_raw
    gold_by_id = {g["sample_id"]: g for g in gold_list}

    field_stats = {
        k: {"exact": 0, "partial": 0, "miss": 0, "both_empty": 0,
            "gold_empty_pred": 0, "pred_empty_gold": 0, "n": 0}
        for k in ("set", "maker", "park_or_event", "le_size", "is_chaser", "is_mystery", "year")
    }
    rows = []
    n_labeled = 0
    n_unlabeled = 0
    leak_rows = []

    for row in pred_doc.get("predictions", []):
        sid = row["sample_id"]
        gold_row = gold_by_id.get(sid) or {}
        # templates nest fields under gold; filled files may be flat
        gold = gold_row.get("gold") if isinstance(gold_row.get("gold"), dict) else gold_row
        if not gold or not gold_filled(gold):
            n_unlabeled += 1
            continue
        n_labeled += 1
        pred = row.get("prediction") or {}
        p_keep = pred.get("keep") or {}
        p_q = pred.get("quarantine") or {}
        g_keep = gold.get("keep") or {}
        g_q = gold.get("quarantine") or {}

        for k in ("set", "maker", "park_or_event"):
            m = field_match(p_keep.get(k), g_keep.get(k))
            field_stats[k][m] += 1
            field_stats[k]["n"] += 1
        for k in ("le_size", "year"):
            m = field_match(p_q.get(k), g_q.get(k))
            field_stats[k][m] += 1
            field_stats[k]["n"] += 1
        for k in ("is_chaser", "is_mystery"):
            m = field_match(bool(p_q.get(k)), bool(g_q.get(k)))
            field_stats[k][m] += 1
            field_stats[k]["n"] += 1

        desc = row.get("description_candidate") or ""
        leaks = quarantine_leak(desc, pred)
        if leaks:
            leak_rows.append({"sample_id": sid, "description": desc, "leaks": leaks})

        rows.append({
            "sample_id": sid,
            "crop_filename": row.get("crop_filename"),
            "ebay_title": row.get("ebay_title"),
            "description_candidate": desc,
            "keep_pred": p_keep,
            "keep_gold": g_keep,
            "quarantine_pred": p_q,
            "quarantine_gold": g_q,
            "leaks": leaks,
        })

    leak_rate = (len(leak_rows) / n_labeled) if n_labeled else None
    summary = {
        "split": args.split,
        "pred_file": str(args.pred),
        "n_predictions": len(pred_doc.get("predictions", [])),
        "n_labeled": n_labeled,
        "n_unlabeled": n_unlabeled,
        "quarantine_leak_count": len(leak_rows),
        "quarantine_leak_rate": leak_rate,
        "gate_quarantine_leak_zero": leak_rate == 0.0 if leak_rate is not None else False,
        "field_stats": field_stats,
        "note": (
            "Fill data/gold_{split}_50.json before trusting field_stats. "
            "Holdout must stay sealed until scorer + prompt are frozen."
        ),
    }
    out = {
        "summary": summary,
        "leak_rows": leak_rows,
        "rows": rows,
    }
    out_path = ROOT / "reports" / f"score_{args.split}.json"
    out_path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
