#!/usr/bin/env python3
"""Build top-K inventory proposals for each sold CTR pin (ResNet18 cosine).

One-off CostMatch helper. Read-only on thumbs/exports; writes exports/proposals.json.
Uses Application Support PinPricingStudyMVP venv (torch + torchvision).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms

ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / "exports"
THUMBS_SOLD = ROOT / "thumbs" / "sold_ctr"
THUMBS_INV = ROOT / "thumbs" / "inventory"
TOP_K = 12
BATCH = 32


def device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def load_encoder(dev: torch.device) -> tuple[nn.Module, transforms.Compose]:
    weights = models.ResNet18_Weights.IMAGENET1K_V1
    model = models.resnet18(weights=weights)
    model.fc = nn.Identity()
    model.eval().to(dev)
    tfm = weights.transforms()
    return model, tfm


@torch.inference_mode()
def embed_paths(
    paths: list[Path], model: nn.Module, tfm, dev: torch.device
) -> np.ndarray:
    feats: list[np.ndarray] = []
    batch: list[torch.Tensor] = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        batch.append(tfm(im))
        if len(batch) >= BATCH:
            x = torch.stack(batch).to(dev)
            f = model(x)
            f = f / f.norm(dim=-1, keepdim=True).clamp_min(1e-8)
            feats.append(f.cpu().numpy().astype(np.float32))
            batch = []
    if batch:
        x = torch.stack(batch).to(dev)
        f = model(x)
        f = f / f.norm(dim=-1, keepdim=True).clamp_min(1e-8)
        feats.append(f.cpu().numpy().astype(np.float32))
    return np.concatenate(feats, axis=0) if feats else np.zeros((0, 512), np.float32)


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

    print(f"Embedding {len(sold_paths)} sold + {len(inv_paths)} inventory…")
    dev = device()
    model, tfm = load_encoder(dev)
    sold_emb = embed_paths(sold_paths, model, tfm, dev)
    inv_emb = embed_paths(inv_paths, model, tfm, dev)
    print(f"  shapes sold={sold_emb.shape} inv={inv_emb.shape} device={dev}")

    # cosine: sold @ inv.T
    sims = sold_emb @ inv_emb.T
    proposals: list[dict] = []
    for i, srow in enumerate(sold_rows):
        order = np.argsort(-sims[i])[:TOP_K]
        cands = []
        for j in order:
            ir = inv_rows[int(j)]
            cands.append(
                {
                    "inventory_key": ir["inventory_key"],
                    "thumb": ir.get("thumb") or "",
                    "catalog_cost": ir.get("catalog_cost"),
                    "crop_stem": ir.get("crop_stem") or "",
                    "board_id": ir.get("board_id") or "",
                    "board_num": ir.get("board_num"),
                    "board_label": ir.get("board_label") or "",
                    "pin_n": ir.get("pin_n"),
                    "display_label": ir.get("display_label") or "",
                    "score": round(float(sims[i, int(j)]), 4),
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
                "listing_title": srow.get("listing_title") or "",
                "candidates": cands,
            }
        )

    out = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "method": "torchvision_resnet18_imagenet_cosine",
        "top_k": TOP_K,
        "sold_count": len(proposals),
        "inventory_count": len(inv_rows),
        "proposals": proposals,
    }
    path = EXPORTS / "proposals.json"
    path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    top1 = [p["candidates"][0]["score"] for p in proposals if p["candidates"]]
    print(
        f"Wrote {path}  top1 score min/med/max="
        f"{min(top1):.3f}/{float(np.median(top1)):.3f}/{max(top1):.3f}"
    )


if __name__ == "__main__":
    main()
