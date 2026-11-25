#!/usr/bin/env python3
"""Deterministic Round-0 baseline (regex/acronym). Not the LLM under test.

Useful as a comparison floor and to exercise the review/score harness
without an API key. Quarantine fields are never put into description_candidate.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MAKERS = [
    ("WDI", r"\bWDI\b"),
    ("MOG", r"\bMOG\b"),
    ("DSSH", r"\bDSSH\b"),
    ("DSF", r"\bDSF\b"),
    ("DEC", r"\bDEC\b"),
    ("D23", r"\bD23\b"),
    ("Loungefly", r"\bLoungefly\b"),
    ("PALM", r"\b(?:PALM|Pink a la Mode)\b"),
    ("Monogram", r"\bMonogram\b"),
    ("Disney Parks", r"\bDisney Parks\b"),
    ("AP", r"\bAP\b"),
]
PARKS = [
    ("WDW", r"\b(?:WDW|Walt Disney World)\b"),
    ("DLR", r"\b(?:DLR|Disneyland Resort)\b"),
    ("HKDL", r"\bHKDL\b"),
    ("DLP", r"\b(?:DLP|Disneyland Paris)\b"),
    ("D23", r"\bD23\b"),
]
SET_HINTS = [
    (r"\bParking Pass\b", "Parking Pass"),
    (r"\bBlind Box\b", "Blind Box"),
    (r"\baDorbs!?\b", "Adorbs"),
    (r"\bAdorbs\b", "Adorbs"),
    (r"\bStamps?\b", "Stamps"),
    (r"\bAdvent Calendar\b", "Advent Calendar"),
    (r"\bFloral Blind Box\b", "Floral Blind Box"),
    (r"\bCookie Sheet\b", "Cookie Sheet"),
    (r"\bCross Stitch\b", "Cross Stitch"),
    (r"\bRubber Duck\b", "Rubber Duck"),
    (r"\bReflections\b", "Reflections"),
    (r"\bVanity\b", "Vanity"),
]
DROP = re.compile(
    r"\b(free shipping|rare|htf|nib|nwt|you choose|pick|unique|wow|wholesale|lot)\b",
    re.I,
)
LE = re.compile(r"\bLE\s*(\d{2,5})\b", re.I)
YEAR = re.compile(r"\b((?:19|20)\d{2})\b")


def extract(title: str) -> dict:
    maker = None
    for name, pat in MAKERS:
        if re.search(pat, title, re.I):
            maker = name
            break
    park = None
    for name, pat in PARKS:
        if re.search(pat, title, re.I):
            park = name
            break
    set_name = None
    for pat, name in SET_HINTS:
        if re.search(pat, title, re.I):
            set_name = name
            break
    le_m = LE.search(title)
    year_m = YEAR.search(title)
    drops = sorted({m.group(0).lower() for m in DROP.finditer(title)})
    return {
        "keep": {"set": set_name, "maker": maker, "park_or_event": park},
        "quarantine": {
            "le_size": le_m.group(1) if le_m else None,
            "is_chaser": bool(re.search(r"\bchaser\b", title, re.I)),
            "is_mystery": bool(re.search(r"\bmystery\b", title, re.I)),
            "year": year_m.group(1) if year_m else None,
        },
        "drop_tokens": drops,
    }


import re as _re
_QUAR_WORD = _re.compile(r"\b(LE\s*\d{2,5}|chaser|mystery|(?:19|20)\d{2})\b", _re.I)

def assemble(pred: dict) -> str:
    keep = pred.get("keep") or {}
    parts = []
    seen = set()
    for k in ("set", "maker", "park_or_event"):
        if not keep.get(k):
            continue
        cleaned = " ".join(_QUAR_WORD.sub(" ", str(keep[k])).split())
        if not cleaned or cleaned.lower() in seen:
            continue
        seen.add(cleaned.lower())
        parts.append(cleaned)
    return " ".join(parts).strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["dev", "holdout"], default="dev")
    args = ap.parse_args()
    pins = json.loads((ROOT / "data" / f"{args.split}_50.json").read_text())["pins"]
    rows = []
    for pin in pins:
        pred = extract(pin["ebay_title"])
        rows.append({
            **{k: pin[k] for k in (
                "sample_id", "split", "pin_key", "crop_filename",
                "ebay_title", "strata", "match_status", "price_source",
            ) if k in pin},
            "prediction": pred,
            "description_candidate": assemble(pred),
            "model": "heuristic",
            "model_name": "regex_v0",
        })
    report = {
        "split": args.split,
        "model": "heuristic",
        "model_name": "regex_v0",
        "n_requested": len(pins),
        "n_ok": len(rows),
        "n_errors": 0,
        "predictions": rows,
        "note": "Round-0 deterministic baseline only; LLM predictions live in extract_*_gemini/openai.json",
    }
    out = ROOT / "reports" / f"extract_{args.split}_heuristic.json"
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {out} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
