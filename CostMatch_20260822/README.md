# CostMatch 20260822 (one-off)

**Not a CTR template.** Not used by PrepareClickToClaim, the pricing watcher, or future shows.

Goal: match **sold CTR pins** (20260822) to **D23 inventory** so Report 6 can show **Paid = catalog / flyer retail** (fully loaded cost stays in Steve’s spreadsheet).

## Open on any device (after merge to `main`)

https://finsandpins.github.io/ClickToClaim/CostMatch_20260822/

Until then, open `index.html` from this folder on GitHub (`cursor/cost-match-20260822-c8d5` branch) or locally.

## What’s here

| Path | What |
|------|------|
| `exports/sold_ctr_pins.json` / `.csv` | 133 sold CTR pins (list $, sold $, thumbs) |
| `exports/inventory_units.json` / `.csv` | 238 D23 inventory units + catalog cost when known |
| `exports/summary.json` | Counts / totals |
| `thumbs/sold_ctr/` | Sold pin thumbnails |
| `thumbs/inventory/` | Inventory crop thumbnails |
| `scripts/01_export_sides.py` | Re-run exports (read-only sources) |

## Sources (read-only)

- CTR sold: Firebase `pin_pricing_tests/…/visual_baseline/pins` where `sale_price` > 0 (run id in `summary.json`)
- CTR crops: Mac Application Support `PriceCollection_20260821_1147/crops` (used only when regenerating exports)
- Inventory boards: `2026A2Z/boards` + `D23Inventory2026/extra-boards`
- Cost: `D23Inventory2026/catalog-prices.json` (flyer retail)

## Note on catalog coverage

Only **98 / 238** inventory units currently have a catalog cost. Several `PAGE_*` boards on disk have no entry in `catalog-prices.json` yet. Matching can still proceed; Paid stays blank until those prices exist.

## Next (not done yet)

1. Offline visual proposals (sold → top‑K inventory)
2. Simple review UI (Match / Next / Skip)
3. Approved map → optional Paid column on CTR Report 6 (only when you ask)

## Safety

- Does not modify CTR show files, pricing harness, Sale Mode, or inventory counts
- Do not copy this folder into PrepareClickToClaim or show bootstrap templates
