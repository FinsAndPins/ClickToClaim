# Match-index show pricing (20260917): lessons and deferral

**Status:** Deferred. Do not pursue as a pricing / Whatnot-title source for now.  
**Date:** 2026-09-17  
**Decision owner:** Steve

## What we tried

For the remounted **20260917** show boards (42 photos, 1112 pins), we built an experiment that:

1. Built / used a **DINOv2 match index** of our own priced pin crops (roughly last ~60 days through 20260911).
2. Visually searched each show crop against that index (no live eBay API).
3. Published a multi-device CTM harness on PreparingInventory Pages as **`EventHarness_20260917_show`** with usual Firebase collab naming (`test_EventHarness_20260917_show__build_show_visual_baseline`).

Experiment code lived under:

`Cursor Projects/PricedPinVisualSearch_20260905/`

Published harness:

- Local / App Support: `PreparingInventoryGit/EventHarness_20260917_show/`
- Live CTM: https://finsandpins.github.io/PreparingInventory/EventHarness_20260917_show/testing_ui_visual_baseline/new_ctm.html

## Outcome

**Not useful enough for pricing this show.** Visual “matches” were often wrong characters even when similarity scores looked middling-to-high (median top `_dino_sim` ~0.75).

Steve’s read after reviewing CTM: matching against **our pricing database** was **worse** than running boards through the normal **eBay pricing watcher**. The separate **event board / pricing-database board search** tooling (searching boards of pins at events) felt **more useful** than using match-index as a CTM pricing substitute.

**Decision (2026-09-17):** stop further work on match-index-as-pricing for now. Prefer:

- **Pricing watcher / live eBay** when we need prices and listing titles (Whatnot CSV, Lexi CTM/CTP).
- **Event board search** when the job is “find this board / these pins in our past priced sets at an event.”

## Why match-index failed as a pricing substitute

1. **Comps are our own crops, not live eBay listings.** Right-pane images came from historical `PriceCollection_*` thumbs (`cand_thumbs/…`), so the model was matching photo-of-our-board to photo-of-our-board.
2. **Shared foam / framing bias.** Many false pairs shared the same orange dimpled foam, similar crop framing, and small Mickey marks. Character identity often lost to background.
3. **Prior-show lookalike noise.** Top hit collections were dominated by recent foam-board runs, especially `PriceCollection_20260901_1340` (~327 / 1112 top hits), which Steve had already flagged as prior-show lookalike noise to exclude.
4. **Confident-looking scores ≠ correct pin.** High-ish DINO similarity did not mean same SKU / same character. Manual CTM examples included Snow White→Angel, Chip/Dale→Dumbo, Haunted Mansion bride→Pooh, etc.
5. **Titles follow the wrong match.** When the top visual hit is the wrong pin, `listing_title` / candidate `title` are wrong too (~962 / 1112 had nonempty titles; usefulness tracks match quality, not title presence).

## What did work (infra / process)

Keep these if this is ever revisited; they are not the reason to continue:

- Experiment stayed out of production watchers / PrepareClickToClaim (Cursor Projects only).
- Firebase collab with usual `test_<folder>__…` naming worked.
- Pages needed an explicit workflow change: `.github/workflows/pages.yml` must sparse-add / assemble **`EventHarness_*`** as well as `PriceCollection_*`, or the folder is on `main` but 404s on Pages.
- CTM eBay pane uses relative `cand_thumbs/*.jpg`. Those files must be copied into the published harness (~8.9k files here). Embedding only “Our Pin” crops is not enough.
- Large embedded HTML thumbs can hit GitHub’s ~100MB file limit; this run used smaller embedded “Our Pin” thumbs (e.g. 420px) plus external `cand_thumbs/`.

## Contrast: when each approach fits

| Approach | Good for | Weak for |
|---|---|---|
| Match-index vs our priced crops | Fast experiment; maybe near-duplicate detection within our library | Authoritative price / eBay title for a new show |
| Event board search in pricing DB | Finding a board / pin among past event boards | Full market comps |
| Pricing watcher (eBay) | Prices, listing titles, Lexi CTM/CTP, Whatnot `ebay_title` | Speed / API cost vs offline index |

## Artifacts (if needed later)

- Experiment: `Cursor Projects/PricedPinVisualSearch_20260905/` (`out/show_20260917/`, publish helper `scripts/publish_event_harness_20260917_show_to_pages.py`)
- Published: `EventHarness_20260917_show` on PreparingInventory (CTM + `ui_data.json` + `cand_thumbs/`)
- Titles field for Whatnot-style use (only if match is trusted): `listing_title` or `candidates[i].title` in `ui_data.json`

## Do not do (unless Steve reopens)

- Wire match-index into the pricing inbox watcher or PrepareClickToClaim.
- Treat `EventHarness_20260917_show` match results as source of truth for show prices or Whatnot titles.
- Expand the index / re-run CTM for more shows without a new accuracy plan (e.g. hard-exclude lookalike collections, background suppression, or require eBay confirmation).
