# EbayTitleSlotExtract_20261123

**New experiment only.** Do not wire into Whatnot CSV builders, pricing watchers, PrepareClickToClaim, or Title Word Review production paths.

## Goal

Use a **text LLM** (not VLM) on the matched eBay **listing title** to fill description slots that Script A does **not** already handle:

| Bucket | Fields | Goes into Whatnot description? |
|---|---|---|
| keep | `set`, `maker`, `park_or_event` | yes (with Script A character/movie) |
| quarantine | `le_size`, `is_chaser`, `is_mystery`, `year` | **never** |
| drop | shipping / rare / you-choose fluff; **AP** / **PP** back stamps | never |

Hard excludes (AP/PP/LR/OE/Cast Exclusive/Fantasy/Opened/loose/no box/In Hands/…) live in `scripts/exclude_patterns.py` and the frozen prompt.

**Shopify / other agents:** see [`SHARED_TITLE_SLOT_APPROACH.md`](./SHARED_TITLE_SLOT_APPROACH.md) for the paste-ready handoff.

Character + movie/franchise stay with **Script A**. This extractor must not invent them.

## Data (from Firebase run behind `whatnot_upload_20261123_buynow.csv`)

Source pricing run: `test_PriceCollection_20261121_2225__build_20261123_fullres_visual_baseline`

| File | Contents |
|---|---|
| `data/all_matched_listings.json` | ~628 matched listing titles |
| `data/sample_100.json` | stratified 100 |
| `data/dev_50.json` / `holdout_50.json` | 50/50 split (holdout sealed until prompt+scorer frozen) |
| `data/gold_*_50.json` | templates — fill after reviewing predictions |

This Firebase dump has **listing titles only** (no Item Specifics / aspects). Aspect-first is preferred when aspects exist on a future run; here title LLM is the right test.

## Round 1 status (dev_50)

Already run against the Firebase titles behind `whatnot_upload_20261123_buynow.csv`:

| Artifact | Path |
|---|---|
| LLM predictions | `reports/extract_dev_llm.json` |
| Heuristic baseline | `reports/extract_dev_heuristic.json` |
| Review CSV (fill gold columns) | `reports/review_dev.csv` |
| Round log | `reports/round1_log.md` |

Self-check: quarantine leak into `description_candidate` = **0** (sanitizer strips Mystery/Chaser/LE#/year even when `keep.set` retains product-line wording).

Gold labels still empty → field accuracy not scored yet. Holdout sealed.

## Run external provider (optional A/B; needs API key)

```bash
cd EbayTitleSlotExtract_20261123
export GEMINI_API_KEY=...   # preferred: gemini-2.0-flash
# or: export OPENAI_API_KEY=...

python3 scripts/run_extract.py --split dev --model gemini
python3 scripts/build_review_sheet.py --split dev --pred reports/extract_dev_gemini.json
# Fill data/gold_dev_template.json (nested under .gold) or review CSV gold_* columns
python3 scripts/score_predictions.py --split dev --pred reports/extract_dev_llm.json
```

Holdout only after scorer + `prompts/extract_v1.txt` are frozen and quarantine leak on labeled dev is **0**.

## Gates

1. `quarantine_leak_rate == 0` on labeled set (LE# / Chaser / Mystery / year never in `description_candidate`)
2. Wrong keep fact worse than empty — prefer miss over inventing maker/set
3. Budget: keep total LLM spend ≤ $10 for this experiment

## Isolation

- Create/edit files **only** under `EbayTitleSlotExtract_20261123/`
- Do not change TitleWordReview, Whatnot CSV builders, or any ClickToClaim show folder
