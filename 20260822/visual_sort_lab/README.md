# Visual sort lab (20260822) — test only

Obscure CTR contact-sheet sorted by **visual similarity** (not price).  
Uses the **same Firebase `claims/20260822/…` path** and `fp_identity` / `fp_display_name` as the boards page so clicks sync both ways on a device.

## URL (GitHub Pages)

https://finsandpins.github.io/ClickToClaim/20260822/visual_sort_lab/

Not linked from Reports or the main show page.

## What’s here

| Path | Role |
|---|---|
| `index.html` | Grid UI + claim sync |
| `order.json` | Precomputed visual order |
| `thumbs/` | ~320px JPEGs from PreparingInventory full-res crops |
| `tools/build_thumbs_and_order.py` | **One-shot** generator — do **not** wire into Prepare / pricing |

## Safety

- Additive only under this folder.
- Does not modify `index.html`, `reports.html`, `boards/`, or recurring scripts.
- Crop source used once: `PriceCollection_20260821_1147/crops` (PreparingInventory).
