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

- **Title:** Character · Maker acronym (WDI/DSSH/…) · Set · **LE** — short, **no punctuation**, **each word once**, **no edition number**, **no Chaser**
- **Title-off:** movie/show names, Mystery, Chaser, spelled-out “Walt Disney Imagineering” / “Studio Store Hollywood”, LE run sizes (400, 300, …)

### Whatnot CSV (ready)

Build the bulk-upload CSV from accepted labels:

```bash
python3 build_whatnot_csv.py
```

Output: `training_exports/whatnot_upload_PriceCollection_20260825_1328.csv` (98 accepted pins).

- **Title:** accepted cleaned title + `PLEASE RELY ON THE PHOTO`
- **Description:** photo disclaimer, full synonym group keywords (from `Disney Synonyms Keywords.txt`), movie/show, Limited Edition when title has LE, IMG board-pin
- **Price:** `display_price` from pricing Firebase, **rounded up to nearest $5** (51→55, 56→60, 50→50)

### Whatnot CSV description policy

When we generate the Whatnot upload CSV, each listing **description** must include:

1. “Please rely on the photo, rather than the description.”
2. **Synonym keywords** from `Disney Synonyms Keywords.txt` — if the title hits any term in a group, include **every** acronym, synonym, and full name in that group (e.g. WDI or MOG → `WDI, MOG, Walt Disney Imagineering, Mickey's of Glendale`)
3. The **relevant movie or TV show** (for search), even though it stays out of the short title
4. **Limited Edition** spelled out when the title contains **LE**
5. IMG board–pin reference

Titles stay short (plus the photo-reliance suffix); descriptions carry the searchable long forms and synonyms. Use `build_whatnot_csv.py` in this folder (not wired into production pricing/CTR watchers).

## Files

| File | Purpose |
|---|---|
| `index.html` | Review UI |
| `seed.json` | All 98 pins (generated) |
| `title_seed_rules.json` | Learnings / denylists |
| `title_seed.js` | Tokenize + seed suggestion |
| `Disney Synonyms Keywords.txt` | Maker synonym groups for Whatnot descriptions |
| `build_whatnot_csv.py` | Build Whatnot bulk-upload CSV |
| `training_exports/` | Accepted-label snapshots + upload CSV |
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
