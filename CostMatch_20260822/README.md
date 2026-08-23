# CostMatch 20260822 (one-off)

**Not a CTR template.** Not used by PrepareClickToClaim, the pricing watcher, or future shows.

Match **sold CTR pins** (20260822) to **D23 inventory** so Report 6 can later show **Paid = catalog / flyer retail**. Fully loaded cost stays in Steve’s spreadsheet.

## Open (any device)

- Browse exports: https://finsandpins.github.io/ClickToClaim/CostMatch_20260822/
- **Review v2 (masked CLIP + pHash):** https://finsandpins.github.io/ClickToClaim/CostMatch_20260822/review_v2.html
- **Mask QC preview:** https://finsandpins.github.io/ClickToClaim/CostMatch_20260822/mask_preview.html
- **Review v1 (ResNet18):** https://finsandpins.github.io/ClickToClaim/CostMatch_20260822/review.html

## How review works

1. **ClickToMatch** — sold pin left, top inventory candidate right → **Match** / **No Match** / **Skip**. Tap the right image to cycle other top‑K candidates. **Back** undoes.
2. **Find alts** — same idea as ClickToPrice: pick from Top‑K grid, or **All** inventory + search, then Confirm.
3. Decisions sync in Firebase (`costMatch/20260822/decisions`) so Steve and Lexi share progress.

CTP-style picking is **in this same flow** (Find alts), not a separate later app — use it when top Match is wrong or No Match needs a manual pick.

## Data

| Path | What |
|------|------|
| `exports/sold_ctr_pins.*` | 133 sold CTR pins |
| `exports/inventory_units.*` | 238 D23 inventory units |
| `exports/proposals.json` | Top‑12 visual candidates per sold pin (ResNet18 v1) |
| `exports/proposals_v2.json` | Top‑12 masked CLIP + pHash candidates (v2) |
| `thumbs/` | Thumbnails for Pages |
| `previews/mask_qc/` | Before/after mask previews (run script 03) |
| `scripts/01_export_sides.py` | Re-export sides |
| `scripts/02_build_proposals.py` | Rebuild v1 proposals (App Support torch venv) |
| `scripts/02_build_proposals_v2.py` | Rebuild v2 masked proposals |
| `scripts/03_mask_preview.py` | Regenerate mask QC images |
| `scripts/image_prep.py` | Mask/crop tuning (sold vs catalog presets) |

## Safety

- Does not modify CTR show files, pricing harness, Sale Mode, or inventory counts
- Do not copy into PrepareClickToClaim / show bootstrap templates
