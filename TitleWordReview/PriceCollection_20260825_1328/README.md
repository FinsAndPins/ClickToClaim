# Title Word Review — PriceCollection_20260825_1328

One-off experiment for training better Whatnot **listing titles** from eBay titles.

**Does not** touch the pricing harness, CTR watchers, or `pin_pricing_tests` Firebase data.

## Live page

https://finsandpins.github.io/ClickToClaim/TitleWordReview/PriceCollection_20260825_1328/

## What it does

- Shows 15 diverse pins (our crop + eBay thumb/price/title).
- Suggests a cleaned title (Character · Manufacturer · Set bias).
- Word chips: tap to include (green) / exclude; third tap = never-use (red).
- Reorder included words with ↑ ↓.
- Saves labels to Firebase under `title_word_review/…` (separate from pricing) and to `localStorage`.
- **Export training JSON** for the next title-generator pass (Roboflow-style iteration).

## eBay title vs description

Harness Firebase only stores eBay **title** (+ thumb/price/url), not item description. This pilot uses title words only. Whatnot **Title** vs **Description** fields can diverge later; this tool trains the short title first.

## Repeat / expand the batch

```bash
python3 build_seed_from_firebase.py --out seed.json --count 15
# then refresh index.html SEED or re-copy seed.json and reload
```

Crops are copied into `crops/` so GitHub Pages stays self-contained (PreparingInventory Pages does not publish `crops/`).

## Safety

- New folder only under `TitleWordReview/`.
- No edits to existing PriceCollection / CTR / pricing scripts.
- Firebase writes only under `title_word_review/PriceCollection_20260825_1328/…`.
