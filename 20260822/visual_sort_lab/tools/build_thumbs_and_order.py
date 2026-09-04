#!/usr/bin/env python3
"""ONE-SHOT helper for 20260822 visual_sort_lab — NOT wired into Prepare/pricing.

Downloads full-res CTR crops from PreparingInventory PriceCollection_20260821_1147,
writes ~320px thumbs under ../thumbs/, and a greedy visual order into ../order.json.

Re-run manually only. Do not add to recurring CTR / pricing scripts.
"""
from __future__ import annotations

import json
import math
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import imagehash
import numpy as np
from PIL import Image

SHOW = "20260822"
BOARDS = Path(__file__).resolve().parents[2] / "boards"
OUT_DIR = Path(__file__).resolve().parents[1]
THUMBS = OUT_DIR / "thumbs"
ORDER_JSON = OUT_DIR / "order.json"
CROP_BASE = (
    "https://raw.githubusercontent.com/FinsAndPins/PreparingInventory/main/"
    "PriceCollection_20260821_1147/crops/"
)
THUMB_MAX = 320
THUMB_QUALITY = 85


def load_pins() -> list[dict]:
    pins = []
    for jp in sorted(BOARDS.glob("IMG_*.json")):
        if jp.name == "manifest.json":
            continue
        board = jp.stem  # IMG_3933
        data = json.loads(jp.read_text())
        for idx, pred in enumerate(data.get("predictions") or []):
            stem = pred.get("crop_stem")
            if not stem:
                continue
            pins.append(
                {
                    "stem": stem,
                    "board": board,
                    "idx": idx,
                    "pinKey": f"{board}-{idx}",
                }
            )
    return pins


def fetch_crop(stem: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    url = CROP_BASE + stem + ".jpg"
    req = urllib.request.Request(url, headers={"User-Agent": "visual-sort-lab/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(dest, "wb") as f:
        f.write(resp.read())
    return dest


def make_thumb(src: Path, dest: Path) -> None:
    im = Image.open(src).convert("RGB")
    im.thumbnail((THUMB_MAX, THUMB_MAX), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=THUMB_QUALITY, optimize=True)


def feature_vector(thumb: Path) -> np.ndarray:
    im = Image.open(thumb).convert("RGB")
    ph = imagehash.phash(im, hash_size=16)  # 256 bits — stronger than default 64
    bits = np.array(ph.hash, dtype=np.float32).ravel()
    # Small HSV hist for color/theme affinity (CLIP-ish “look” without torch).
    small = im.resize((64, 64), Image.Resampling.BILINEAR)
    hsv = np.asarray(small.convert("HSV"), dtype=np.float32)
    h_hist, _ = np.histogram(hsv[:, :, 0], bins=16, range=(0, 256), density=True)
    s_hist, _ = np.histogram(hsv[:, :, 1], bins=8, range=(0, 256), density=True)
    v_hist, _ = np.histogram(hsv[:, :, 2], bins=8, range=(0, 256), density=True)
    feat = np.concatenate([bits * 1.0, h_hist.astype(np.float32) * 4.0, s_hist * 2.0, v_hist * 2.0])
    n = np.linalg.norm(feat) + 1e-8
    return feat / n


def greedy_nn_order(feats: np.ndarray) -> list[int]:
    n = feats.shape[0]
    if n == 0:
        return []
    # Start at medoid (min sum distance) for a more central tour start.
    # Distance ≈ 1 - cosine (feats are L2-normalized).
    sims = feats @ feats.T
    dists = 1.0 - sims
    np.fill_diagonal(dists, 0.0)
    start = int(np.argmin(dists.sum(axis=1)))
    used = np.zeros(n, dtype=bool)
    order = [start]
    used[start] = True
    for _ in range(n - 1):
        last = order[-1]
        row = dists[last].copy()
        row[used] = np.inf
        nxt = int(np.argmin(row))
        order.append(nxt)
        used[nxt] = True
    return order


def two_opt(order: list[int], dists: np.ndarray, passes: int = 3) -> list[int]:
    """Light 2-opt polish on the tour (open path: don't wrap)."""
    n = len(order)
    if n < 4:
        return order
    path = order[:]
    for _ in range(passes):
        improved = False
        for i in range(n - 1):
            for k in range(i + 2, n - (0 if i > 0 else 1)):
                # reverse path[i+1 .. k]
                a, b = path[i], path[i + 1]
                c, d = path[k], path[k + 1] if k + 1 < n else None
                before = dists[a, b] + (dists[c, d] if d is not None else 0.0)
                after = dists[a, c] + (dists[b, d] if d is not None else 0.0)
                if after + 1e-9 < before:
                    path[i + 1 : k + 1] = reversed(path[i + 1 : k + 1])
                    improved = True
        if not improved:
            break
    return path


def main() -> int:
    pins = load_pins()
    print(f"pins={len(pins)} out={OUT_DIR}")
    raw_dir = Path("/tmp/vs_crops_20260822")
    raw_dir.mkdir(parents=True, exist_ok=True)
    THUMBS.mkdir(parents=True, exist_ok=True)

    def one(p: dict) -> tuple[str, Path]:
        stem = p["stem"]
        raw = fetch_crop(stem, raw_dir / f"{stem}.jpg")
        thumb = THUMBS / f"{stem}.jpg"
        make_thumb(raw, thumb)
        return stem, thumb

    ok = 0
    failed = []
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = {ex.submit(one, p): p for p in pins}
        for fut in as_completed(futs):
            p = futs[fut]
            try:
                fut.result()
                ok += 1
                if ok % 40 == 0:
                    print(f"  thumbs {ok}/{len(pins)}")
            except Exception as e:
                failed.append((p["stem"], str(e)))
                print(f"FAIL {p['stem']}: {e}", file=sys.stderr)

    if failed:
        print(f"failed={len(failed)} (continuing with successes)", file=sys.stderr)

    ready = []
    feats = []
    for p in pins:
        thumb = THUMBS / f"{p['stem']}.jpg"
        if not thumb.exists():
            continue
        ready.append(p)
        feats.append(feature_vector(thumb))
    feats_a = np.stack(feats, axis=0)
    sims = feats_a @ feats_a.T
    dists = 1.0 - sims
    np.fill_diagonal(dists, 0.0)
    order_idx = greedy_nn_order(feats_a)
    order_idx = two_opt(order_idx, dists, passes=4)

    ordered = []
    for rank, i in enumerate(order_idx):
        p = ready[i]
        ordered.append(
            {
                "stem": p["stem"],
                "board": p["board"],
                "idx": p["idx"],
                "pinKey": p["pinKey"],
                "thumb": f"thumbs/{p['stem']}.jpg",
                "rank": rank,
            }
        )

    payload = {
        "show": SHOW,
        "method": "phash16_hsv_hist_greedy_nn_2opt",
        "thumbMaxSide": THUMB_MAX,
        "cropSource": CROP_BASE,
        "note": "One-shot lab assets. Not produced by PrepareClickToClaim.",
        "count": len(ordered),
        "failed": [{"stem": s, "error": e} for s, e in failed],
        "pins": ordered,
    }
    ORDER_JSON.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {ORDER_JSON} count={len(ordered)} failed={len(failed)}")
    # rough size
    total = sum(f.stat().st_size for f in THUMBS.glob("*.jpg"))
    print(f"thumbs_bytes={total} (~{total/1024/1024:.1f} MB)")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
