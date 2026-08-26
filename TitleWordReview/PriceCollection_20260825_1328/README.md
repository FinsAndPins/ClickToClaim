# Title Word Review — PriceCollection_20260825_1328

One-off experiment for training better Whatnot **listing titles** from the **chosen** eBay listing title.

**Live:** https://finsandpins.github.io/ClickToClaim/TitleWordReview/PriceCollection_20260825_1328/

## Listing source (important)

Uses Firebase `selected_candidate` only:

| Situation | What you see |
|---|---|
| ClickToMatch matched | That matched listing (badge: ClickToMatch) |
| CTM no-match → ClickToPrice pick | The listing you chose in CTP (badge: ClickToPrice pick) |

Never uses the original rank‑1 / `pipeline_slot0` suggestion unless that *was* the chosen match. Manual-price pins without a chosen listing are excluded.

Page also **read-only hydrates** `selected_candidate` from `pin_pricing_tests/…` on load. Labels write only to `title_word_review/…`.

## Safety

- New files under `TitleWordReview/` only.
- No harness / watcher / pricing script changes.
