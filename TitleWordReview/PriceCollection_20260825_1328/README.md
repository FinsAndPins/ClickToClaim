# Title Word Review — PriceCollection_20260825_1328

One-off experiment for training better Whatnot **listing titles** from chosen eBay listing titles.

**Not** wired into PrepareClickToClaim, pricing inbox, or Whatnot CSV builders yet.

**Live (98 pins):** https://finsandpins.github.io/ClickToClaim/TitleWordReview/PriceCollection_20260825_1328/

## Where your Accepts are captured (ready to deploy later)

| Artifact | What it stores |
|---|---|
| **Firebase** `title_word_review/PriceCollection_20260825_1328/batch_full_98_v1/` | Live Accepts (cleaned title, word chips, who/when) — syncs Steve + Lexi |
| **`training_exports/accepted_labels_latest.json`** | Snapshot of accepted ebay→cleaned pairs for training / offline use |
| **`title_seed_rules.json`** | Encoded learnings (never words, movie phrases, acronym expansions, dedupe, no punctuation) |
| **`title_seed.js`** | Seed / tokenize logic that applies those rules |
| **Export button** in the UI | Downloads full JSON anytime |

When you want this in production Whatnot CSV flow: copy/adapt `title_seed.js` + `title_seed_rules.json` (and/or load the accepted labels) into a new Cursor Projects builder — do **not** edit pricing/CTR watchers until you say to ship.

## Listing source

Uses Firebase `selected_candidate` only (ClickToMatch match or ClickToPrice pick). Never the original rank‑1 suggestion.

## Title vs description policy

- **Title:** Character · Maker acronym (WDI/DSSH/…) · Set · LE — short, **no punctuation**, **each word once**
- **Title-off:** movie/show names, Mystery, spelled-out “Walt Disney Imagineering” / “Studio Store Hollywood”, etc.
- **Description (later):** those red/movie/expansion words + “Please rely on the photo…” for search

## Files

| File | Purpose |
|---|---|
| `index.html` | Review UI |
| `seed.json` | All 98 pins (generated) |
| `title_seed_rules.json` | Learnings / denylists |
| `title_seed.js` | Tokenize + seed suggestion |
| `training_exports/` | Accepted-label snapshots |
| `build_seed_from_firebase.py` | Regenerate seed (read-only Firebase) |
| `crops/` | Self-contained crop JPEGs for Pages |

## Regenerate

```bash
python3 build_seed_from_firebase.py --all --out seed.json --download-crops
```

## Firebase paths (separate from pricing)

- Labels: `title_word_review/PriceCollection_20260825_1328/batch_full_98_v1/`
- Prior pilot (15): `…/batch_15_v2_chosen_listing/` — imported on load if needed

## Safety

New folder only under `TitleWordReview/`. No harness / watcher / `pin_pricing_tests` writes.
