# Title Word Review — PriceCollection_20260825_1328

One-off experiment for training better Whatnot **listing titles** from chosen eBay listing titles.

**Live (98 pins):** https://finsandpins.github.io/ClickToClaim/TitleWordReview/PriceCollection_20260825_1328/

Share with Lexi — enter name, Accept each pin. Progress syncs via Firebase.

## Listing source

Uses Firebase `selected_candidate` only (ClickToMatch match or ClickToPrice pick). Never the original rank‑1 suggestion.

## Title vs description policy

- **Title:** Character · Manufacturer · Set · LE (short)
- **Red chips:** movie/show phrases off title by default (`title_seed_rules.json`) — for Whatnot **description** search later
- **Description builder** (future): append red/movie words + “Please rely on the photo…”

## Files

| File | Purpose |
|---|---|
| `index.html` | Review UI |
| `seed.json` | All 98 pins (generated) |
| `title_seed_rules.json` | Never words + movie phrase denylist |
| `title_seed.js` | Tokenize + seed suggestion |
| `build_seed_from_firebase.py` | Regenerate seed (read-only Firebase) |
| `crops/` | Self-contained crop JPEGs for Pages |

## Regenerate

```bash
python3 build_seed_from_firebase.py --all --out seed.json --download-crops
```

## Firebase paths (separate from pricing)

- Labels: `title_word_review/PriceCollection_20260825_1328/batch_full_98_v1/`
- Prior pilot (15): `…/batch_15_v2_chosen_listing/` — auto-imported on first load if not already in full batch

## Safety

New folder only. No harness / watcher / `pin_pricing_tests` writes.
