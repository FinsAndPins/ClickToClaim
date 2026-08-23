"""CostMatch image prep — mask/crop sold CTR vs catalog flyer art for embedding.

One-off helper under CostMatch_20260822/. Does not modify production pricing/CTR.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Preset = Literal["sold_ctr", "catalog_flyer", "none"]

NEUTRAL_BG = (128, 128, 128)


@dataclass(frozen=True)
class PrepSpec:
    """Relative fractions of original width/height before masking."""
    crop_left: float
    crop_top: float
    crop_right: float
    crop_bottom: float
    ellipse_cx: float  # center within cropped image, 0..1
    ellipse_cy: float
    ellipse_rx: float  # radii as fraction of cropped w/h
    ellipse_ry: float
    corner_masks: tuple[tuple[float, float, float, float], ...] = ()


SOLD_CTR = PrepSpec(
    crop_left=0.10,
    crop_top=0.04,
    crop_right=0.90,
    crop_bottom=0.78,
    ellipse_cx=0.50,
    ellipse_cy=0.44,
    ellipse_rx=0.46,
    ellipse_ry=0.40,
)

# Flyer/catalog: drop corner badges + bottom caption strip.
CATALOG_FLYER = PrepSpec(
    crop_left=0.08,
    crop_top=0.10,
    crop_right=0.92,
    crop_bottom=0.88,
    ellipse_cx=0.50,
    ellipse_cy=0.48,
    ellipse_rx=0.44,
    ellipse_ry=0.42,
    corner_masks=(
        (0.0, 0.0, 0.22, 0.20),   # orange number badge (top-left)
        (0.0, 0.78, 0.28, 1.0),   # mickey cube + pin-on-pin label (bottom-left)
        (0.72, 0.0, 1.0, 0.18),   # occasional top-right flyer chrome
    ),
)


def _crop_rel(im: Image.Image, spec: PrepSpec) -> Image.Image:
    w, h = im.size
    left = int(round(spec.crop_left * w))
    top = int(round(spec.crop_top * h))
    right = int(round(spec.crop_right * w))
    bottom = int(round(spec.crop_bottom * h))
    left = max(0, min(left, w - 2))
    top = max(0, min(top, h - 2))
    right = max(left + 2, min(right, w))
    bottom = max(top + 2, min(bottom, h))
    return im.crop((left, top, right, bottom))


def _ellipse_mask(size: tuple[int, int], spec: PrepSpec) -> Image.Image:
    w, h = size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    cx = int(round(spec.ellipse_cx * w))
    cy = int(round(spec.ellipse_cy * h))
    rx = max(2, int(round(spec.ellipse_rx * w)))
    ry = max(2, int(round(spec.ellipse_ry * h)))
    draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(radius=max(2, min(w, h) // 32)))


def _apply_corner_cutouts(mask: Image.Image, spec: PrepSpec) -> Image.Image:
    if not spec.corner_masks:
        return mask
    w, h = mask.size
    draw = ImageDraw.Draw(mask)
    for x0, y0, x1, y1 in spec.corner_masks:
        draw.rectangle(
            (int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)),
            fill=0,
        )
    return mask


def prepare_image(im: Image.Image, preset: Preset) -> Image.Image:
    """Mask pin artwork; neutral gray outside focus region."""
    if preset == "none":
        return im.convert("RGB")

    spec = SOLD_CTR if preset == "sold_ctr" else CATALOG_FLYER
    base = im.convert("RGB")
    cropped = _crop_rel(base, spec)
    mask = _ellipse_mask(cropped.size, spec)
    mask = _apply_corner_cutouts(mask, spec)

    bg = Image.new("RGB", cropped.size, NEUTRAL_BG)
    out = Image.composite(cropped, bg, mask)
    return out


def prepare_for_display_pair(im: Image.Image, preset: Preset) -> tuple[Image.Image, Image.Image]:
    """Return (original RGB, masked) for QC previews."""
    rgb = im.convert("RGB")
    return rgb, prepare_image(rgb, preset)


def phash_bits(im: Image.Image) -> np.ndarray:
    """64-bit pHash as float vector for Hamming distance."""
    import imagehash

    h = imagehash.phash(im.convert("RGB"))
    return h.hash.flatten().astype(np.float32)
