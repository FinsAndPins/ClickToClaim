#!/usr/bin/env python3
"""CostMatch v2 proposals: masked CLIP + pHash rerank (sold CTR vs catalog flyer).

Writes exports/proposals_v2.json only — does not overwrite proposals.json.
Uses Application Support PinPricingStudyMVP venv (torch, open_clip, imagehash).
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import open_clip
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from image_prep import phash_bits, prepare_image  # noqa: E402

EXPORTS = ROOT / "exports"
THUMBS_SOLD = ROOT / "thumbs" / "sold_ctr"
THUMBS_INV = ROOT / "thumbs" / "inventory"
TOP_K = 12
CLIP_POOL = 36  # rerank top-N by pHash
BATCH = 24
CLIP_WEIGHT = 0.72
PHASH_WEIGHT = 0.28


def device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def load_clip(dev: torch.device):
    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="openai"
    )
    model.eval().to(dev)
    return model, preprocess


@torch.inference_mode()
def clip_embed_paths(
    paths: list[Path],
    presets: list[str],
    model,
    preprocess,
    dev: torch.device,
) -> np.ndarray:
    feats: list[np.ndarray] = []
    batch_imgs: list = []
    for path, preset in zip(paths, presets):
        im = prepare_image(Image.open(path), preset)  # type: ignore[arg-type]
        batch_imgs.append(preprocess(im))
        if len(batch_imgs) >= BATCH:
            x = torch.stack(batch_imgs).to(dev)
            f = model.encode_image(x)
            f = f / f.norm(dim=-1, keepdim=True).clamp_min(1e-8)
            feats.append(f.cpu().numpy().astype(np.float32))
            batch_imgs = []
    if batch_imgs:
        x = torch.stack(batch_imgs).to(dev)
        f = model.encode_image(x)
        f = f / f.norm(dim=-1, keepdim=True).clamp_min(1e-8)
        feats.append(f.cpu().numpy().astype(np.float32))
    return np.concatenate(feats, axis=0) if feats else np.zeros((0, 512), np.float32)


def phash_embed_paths(paths: list[Path], presets: list[str]) -> np.ndarray:
    rows: list[np.ndarray] = []
    for path, preset in zip(paths, presets):
        im = prepare_image(Image.open(path), preset)  # type: ignore[arg-type]
        rows.append(phash_bits(im))
    return np.stack(rows, axis=0) if rows else np.zeros((0, 64), np.float32)


def hamming_sim(a: np.ndarray, b: np.ndarray) -> float:
    d = float(np.sum(a != b))
    return max(0.0, 1.0 - d / 64.0)


def main() -> None:
    sold = json.loads((EXPORTS / "sold_ctr_pins.json").read_text(encoding="utf-8"))
    inv = json.loads((EXPORTS / "inventory_units.json").read_text(encoding="utf-8"))

    sold_paths: list[Path] = []
    sold_rows: list[dict] = []
    for r in sold:
        stem = r.get("crop_stem") or ""
        p = THUMBS_SOLD / f"{stem}.jpg"
        if not p.is_file():
            print(f"WARN missing sold thumb: {stem}")
            continue
        sold_paths.append(p)
        sold_rows.append(r)

    inv_paths: list[Path] = []
    inv_rows: list[dict] = []
    for r in inv:
        key = r.get("inventory_key") or ""
        p = THUMBS_INV / f"{key}.jpg"
        if not p.is_file():
            print(f"WARN missing inv thumb: {key}")
            continue
        inv_paths.append(p)
        inv_rows.append(r)

    print(f"v2: masking + CLIP + pHash on {len(sold_paths)} sold + {len(inv_paths)} inventory…")
    dev = device()
    model, preprocess = load_clip(dev)

    sold_presets = ["sold_ctr"] * len(sold_paths)
    inv_presets = ["catalog_flyer"] * len(inv_paths)

    sold_clip = clip_embed_paths(sold_paths, sold_presets, model, preprocess, dev)
    inv_clip = clip_embed_paths(inv_paths, inv_presets, model, preprocess, dev)
    sold_phash = phash_embed_paths(sold_paths, sold_presets)
    inv_phash = phash_embed_paths(inv_paths, inv_presets)
    print(f"  clip shapes sold={sold_clip.shape} inv={inv_clip.shape} device={dev}")

    clip_sims = sold_clip @ inv_clip.T
    proposals: list[dict] = []
    gaps: list[float] = []

    for i, srow in enumerate(sold_rows):
        clip_row = clip_sims[i]
        clip_order = np.argsort(-clip_row)[:CLIP_POOL]
        scored: list[tuple[float, float, float, int]] = []
        for j in clip_order:
            j = int(j)
            csim = float(clip_row[j])
            psim = hamming_sim(sold_phash[i], inv_phash[j])
            hybrid = CLIP_WEIGHT * csim + PHASH_WEIGHT * psim
            scored.append((hybrid, csim, psim, j))
        scored.sort(key=lambda t: -t[0])
        top = scored[:TOP_K]
        if len(top) >= 2:
            gaps.append(top[0][0] - top[1][0])

        cands = []
        for hybrid, csim, psim, j in top:
            ir = inv_rows[j]
            cands.append(
                {
                    "inventory_key": ir["inventory_key"],
                    "thumb": ir.get("thumb") or "",
                    "catalog_cost": ir.get("catalog_cost"),
                    "crop_stem": ir.get("crop_stem") or "",
                    "board_id": ir.get("board_id") or "",
                    "score": round(hybrid, 4),
                    "clip_score": round(csim, 4),
                    "phash_score": round(psim, 4),
                }
            )
        proposals.append(
            {
                "crop_stem": srow.get("crop_stem") or "",
                "fb_key": srow.get("fb_key") or "",
                "thumb": srow.get("thumb") or "",
                "list_price": srow.get("list_price"),
                "sold_price": srow.get("sold_price"),
                "sale_recorded_by": srow.get("sale_recorded_by") or "",
                "board_num": srow.get("board_num"),
                "pin_n": srow.get("pin_n"),
                "candidates": cands,
            }
        )

    out = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "method": "masked_clip_vit_b32_plus_phash_hybrid",
        "masking": {
            "sold": "sold_ctr — upper-center ellipse, trim card footer",
            "inventory": "catalog_flyer — center ellipse, corner badge cutouts",
        },
        "weights": {"clip": CLIP_WEIGHT, "phash": PHASH_WEIGHT},
        "top_k": TOP_K,
        "clip_pool": CLIP_POOL,
        "sold_count": len(proposals),
        "inventory_count": len(inv_rows),
        "proposals": proposals,
    }
    path = EXPORTS / "proposals_v2.json"
    path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")

    top1 = [p["candidates"][0]["score"] for p in proposals if p.get("candidates")]
    print(
        f"Wrote {path}  hybrid top1 min/med/max="
        f"{min(top1):.3f}/{float(np.median(top1)):.3f}/{max(top1):.3f}"
    )
    if gaps:
        print(
            f"  top1-top2 gap med={float(np.median(gaps)):.4f} "
            f"mean={float(np.mean(gaps)):.4f} (higher = more separable)"
        )


if __name__ == "__main__":
    main()
