#!/usr/bin/env python3
import base64
import io
import json
import time
from pathlib import Path

import requests
from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent
PENDING_PATH = ROOT / "pending_items.json"
BACKUP_PATH = ROOT / "pending_items_pre_vlm_backfill.json"
CACHE_PATH = ROOT / "vlm_character_cache.json"
KEY_PATH = Path("/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/Minimal folder for Claude/Gemini API Key.txt")

MODEL = "gemini-2.0-flash"
DELAY = 0.8
MAX_RETRIES = 3

PROMPT = """Identify the primary Disney character shown in this single pin crop image.
Return ONLY JSON:
{"character":"...","confidence":0.0}
Rules:
- Use most specific known character name.
- If multiple, return the most prominent.
- If unknown or non-character object, return "unknown".
- No markdown or extra text."""


def load_key():
    key = KEY_PATH.read_text(encoding="utf-8").strip()
    if not key:
        raise RuntimeError("Gemini API key file is empty.")
    return key


def image_to_b64(path: Path):
    img = Image.open(path)
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((512, 512), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def call_gemini(api_key: str, b64: str):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={api_key}"
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": PROMPT},
                    {"inline_data": {"mime_type": "image/jpeg", "data": b64}},
                ]
            }
        ],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 120},
    }
    last_error = None
    for _ in range(MAX_RETRIES):
        try:
            r = requests.post(url, json=payload, timeout=40)
            if r.status_code == 429:
                time.sleep(3)
                continue
            r.raise_for_status()
            data = r.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            text = text.replace("```json", "").replace("```", "").strip()
            parsed = json.loads(text)
            return str(parsed.get("character", "unknown")).strip()
        except Exception as e:
            last_error = e
            time.sleep(2)
    print(f"Gemini error: {last_error}")
    return "unknown"


def main():
    api_key = load_key()
    pending = json.loads(PENDING_PATH.read_text(encoding="utf-8"))
    if not BACKUP_PATH.exists():
        BACKUP_PATH.write_text(PENDING_PATH.read_text(encoding="utf-8"), encoding="utf-8")

    cache = {}
    if CACHE_PATH.exists():
        cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))

    filenames = sorted(pending.keys())
    total = len(filenames)
    updated = 0
    from_cache = 0

    for i, fn in enumerate(filenames, start=1):
        row = pending[fn]
        existing = (row.get("vlm_character") or "").strip()
        if existing and existing.lower() not in {"unknown", "error", "parse_error", "load_error"}:
            continue

        img_path = ROOT / "pins" / fn
        if not img_path.exists():
            continue

        if fn in cache:
            char = cache[fn]
            from_cache += 1
        else:
            b64 = image_to_b64(img_path)
            char = call_gemini(api_key, b64)
            cache[fn] = char
            CACHE_PATH.write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding="utf-8")
            time.sleep(DELAY)

        row["vlm_character"] = char
        if not (row.get("final_character") or "").strip() or row.get("final_character", "").strip().lower() == "unknown":
            row["final_character"] = char
        updated += 1
        if i % 25 == 0:
            PENDING_PATH.write_text(json.dumps(pending, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"[{i}/{total}] updated={updated} cache_hits={from_cache}")

    PENDING_PATH.write_text(json.dumps(pending, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Done. updated={updated} cache_hits={from_cache} total={total}")


if __name__ == "__main__":
    main()
