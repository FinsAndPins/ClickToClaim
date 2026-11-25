#!/usr/bin/env python3
"""LLM title-slot extract for EbayTitleSlotExtract_20261123 (new folder only).

Reads sample JSON, calls Gemini Flash or OpenAI mini, writes predictions.
Does not modify any existing ClickToClaim / pricing files.

Usage:
  GEMINI_API_KEY=... python3 scripts/run_extract.py --split dev
  OPENAI_API_KEY=... python3 scripts/run_extract.py --split holdout --model openai
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROMPT = (ROOT / "prompts" / "extract_v1.txt").read_text(encoding="utf-8")
# Never enter description: LE size, chaser, mystery, year, AP/PP back stamps.
_QUAR_WORD = re.compile(
    r"\b(LE\s*\d{2,5}|chaser|mystery|(?:19|20)\d{2}|AP|PP)\b",
    re.I,
)


def load_pins(split: str) -> list[dict]:
    path = ROOT / "data" / ("dev_50.json" if split == "dev" else "holdout_50.json")
    return json.loads(path.read_text(encoding="utf-8"))["pins"]


def call_gemini(title: str, model: str, api_key: str) -> dict:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": PROMPT
                        + "\n\nEbay title:\n"
                        + title
                        + "\n\nJSON:"
                    }
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    text = payload["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)


def call_openai(title: str, model: str, api_key: str) -> dict:
    body = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": f"Ebay title:\n{title}\n\nJSON:"},
        ],
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    text = payload["choices"][0]["message"]["content"]
    return json.loads(text)


def assemble_description(pred: dict) -> str:
    """Candidate description WITHOUT character/movie (Script A fills those later).

    Quarantine/exclude tokens (LE size, Chaser, Mystery, year, AP, PP) are
    stripped even if they appear inside a keep field.
    """
    keep = pred.get("keep") or {}
    parts = []
    seen = set()
    for key in ("set", "maker", "park_or_event"):
        val = keep.get(key)
        if not val:
            continue
        # Whole-field exclude: AP/PP must never be kept as maker.
        if re.fullmatch(r"(?i)AP|PP", str(val).strip()):
            continue
        cleaned = " ".join(_QUAR_WORD.sub(" ", str(val)).split())
        if not cleaned:
            continue
        key_l = cleaned.lower()
        if key_l in seen:
            continue
        seen.add(key_l)
        parts.append(cleaned)
    return " ".join(parts).strip()




def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["dev", "holdout"], default="dev")
    ap.add_argument("--model", choices=["gemini", "openai"], default="gemini")
    ap.add_argument("--limit", type=int, default=0, help="0 = all")
    ap.add_argument("--sleep", type=float, default=0.15)
    args = ap.parse_args()

    pins = load_pins(args.split)
    if args.limit:
        pins = pins[: args.limit]

    if args.model == "gemini":
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise SystemExit("Set GEMINI_API_KEY (or GOOGLE_API_KEY)")
        model_name = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
        caller = lambda title: call_gemini(title, model_name, api_key)
    else:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise SystemExit("Set OPENAI_API_KEY")
        model_name = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        caller = lambda title: call_openai(title, model_name, api_key)

    out_rows = []
    errors = []
    t0 = time.time()
    for i, pin in enumerate(pins, 1):
        title = pin["ebay_title"]
        try:
            pred = caller(title)
            out_rows.append(
                {
                    **{k: pin[k] for k in (
                        "sample_id", "split", "pin_key", "crop_filename",
                        "ebay_title", "strata", "match_status", "price_source",
                    ) if k in pin},
                    "prediction": pred,
                    "description_candidate": assemble_description(pred),
                    "model": args.model,
                    "model_name": model_name,
                }
            )
            print(f"[{i}/{len(pins)}] ok {pin.get('crop_filename')}")
        except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, KeyError, TimeoutError) as err:
            errors.append({"sample_id": pin.get("sample_id"), "error": str(err), "title": title})
            print(f"[{i}/{len(pins)}] FAIL {pin.get('crop_filename')}: {err}")
        time.sleep(args.sleep)

    elapsed = time.time() - t0
    report = {
        "split": args.split,
        "model": args.model,
        "model_name": model_name,
        "n_requested": len(pins),
        "n_ok": len(out_rows),
        "n_errors": len(errors),
        "elapsed_sec": round(elapsed, 2),
        "prompt": "prompts/extract_v1.txt",
        "errors": errors,
        "predictions": out_rows,
    }
    out_path = ROOT / "reports" / f"extract_{args.split}_{args.model}.json"
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} ({len(out_rows)} ok, {len(errors)} errors, {elapsed:.1f}s)")


if __name__ == "__main__":
    main()
