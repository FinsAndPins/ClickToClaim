# Line family review (offline starting sets)

GitHub Pages review UI for verifying Adorbs / WDI / DEC / DSSH candidate pins before any strip backtest.

## Pages

- `index.html`
- `adorbs.html`
- `wdi_carded.html`
- `dec_carded.html`
- `dssh_carded.html`

## Firebase

Top-level RTDB path (does not touch shows / pin_pricing_tests / boardBoxEditor):

```
lineFamilyReview/exclusions/{class}/{id}
```

Classes: `adorbs`, `wdi_carded`, `dec_carded`, `dssh_carded`.

Tap exclude writes `{ excluded: true, title, pin_key, source_id, ts }`. Tap again removes the node (restore).

## Data

Candidates drawn from Firebase export (~39k titled pins), title synonym pools, local PricingWork crops, then title-similarity dedupe to ~50 unique pins per class.
