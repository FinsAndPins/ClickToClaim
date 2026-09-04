# CostMatch 20260822 (one-off)

**Not a CTR template.** Not used by PrepareClickToClaim, the pricing watcher, or future shows.

Match **sold CTR pins** (20260822) to **D23 inventory** so Report 6 can later show **Paid = catalog / flyer retail**. Fully loaded cost stays in Steve’s spreadsheet.

## Open (any device)

- **Pick from catalog (CTP-style scroll):** https://finsandpins.github.io/ClickToClaim/CostMatch_20260822/pick.html
- Browse exports: https://finsandpins.github.io/ClickToClaim/CostMatch_20260822/
- **Review v2 (masked CLIP + pHash):** https://finsandpins.github.io/ClickToClaim/CostMatch_20260822/review_v2.html
- **Mask QC preview:** https://finsandpins.github.io/ClickToClaim/CostMatch_20260822/mask_preview.html
- **Review v1 (ResNet18):** https://finsandpins.github.io/ClickToClaim/CostMatch_20260822/review.html

## How review works

**Recommended:** [pick.html](pick.html) — sold pin on top, scroll ranked catalog below (ClickToPrice-style). Matched catalog units are **claimed** and hidden on all later pins.

1. **pick.html** — scroll ranked D23 inventory, tap, Match / No Match / Skip. One catalog unit per show.
2. **review.html** — original ClickToMatch + Find alts (still available; also hides claimed catalog units).

Decisions sync in Firebase (`costMatch/20260822/decisions`) so Steve and Lexi share progress.

## Data

| Path | What |
|------|------|
| `exports/sold_ctr_pins.*` | 133 sold CTR pins |
| `exports/inventory_units.*` | 238 D23 inventory units |
| `exports/proposals.json` | Top‑12 visual candidates per sold pin (ResNet18 v1) |
| `exports/catalog_rankings.json` | Full ranked catalog per sold pin (for pick.html) |
| `thumbs/` | Thumbnails for Pages |
| `previews/mask_qc/` | Before/after mask previews (run script 03) |
| `scripts/01_export_sides.py` | Re-export sides |
| `scripts/02_build_proposals.py` | Rebuild v1 proposals (App Support torch venv) |
| `scripts/02_build_proposals_v2.py` | Rebuild v2 masked proposals |
| `scripts/04_build_catalog_rankings.py` | Rebuild catalog_rankings.json |
| `scripts/image_prep.py` | Mask/crop tuning (sold vs catalog presets) |

## Safety

- Does not modify CTR show files, pricing harness, Sale Mode, or inventory counts
- Do not copy into PrepareClickToClaim / show bootstrap templates
