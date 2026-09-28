# Deferred: nest-suppress prefer-parent in pricing watcher

**Do not implement now** (Steve 2026-09-28). Documented for a ~2-week reminder after the CTR 20261001 trial.

## Intent

BoardsToPrice / pricing collections hit the same nested-box problem as CTR (child detections inside a good parent). The 20261001 trial runs prefer-parent only on a **sibling CTR detect path**. If that helps, add the same rule to the pricing RF-DETR path the inbox watcher runs (after IoU dedupe, before crop stems), with explicit **SHIP TO PRODUCTION** and App Support reinstall.

## Source of truth for the trial rule

`Cursor Projects/CtrNestSuppressTrial_20261001/nest_suppress/nest_suppress_v1.py`  
`Cursor Projects/CtrNestSuppressTrial_20261001/docs/DEFERRED_PRICING_NEST_SUPPRESS.md`

## When revisiting

1. Confirm 20261001 trial outcomes (dropped nested children, Fix-boxes load, false parent keeps).
2. Propose a contained pricing-watcher change + one PriceCollection verification.
3. Do not wire into production without SHIP TO PRODUCTION.

## Related rules

- `production-pricing-experiment-isolation.mdc`
- `pricing-watcher-lessons.mdc`
