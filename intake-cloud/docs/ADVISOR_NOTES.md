# Trusted advisor notes (cloud intake)

Steve asked for pushback when a choice is weak on tech, privacy, ToS, or harm. Living list.

## Decisions we made (and why)

| Choice | Verdict |
|--------|---------|
| One Cloud Run job, pipelined per board (detect N → eBay N while detect N+1) | **Do this.** Best time-to-first-board; one warm model; less state glue than 25 jobs. |
| 25 separate Cloud Run jobs (one per board) | **Don’t.** Cold starts, invoke fan-out, harder cancel/confirm. |
| Detect-all then eBay-all | Keep for **Mac batch** only. Wrong for seller wait. |
| RF-DETR / eBay while seller still fills the form (before Submit) | **Don’t.** Privacy says photos are held for upload until Submit; eBay Browse on abandoned temps is wasteful and off-spirit. Upload-during-form stays; detect starts after Submit. Pipeline still makes board 1 ready fast. |
| Upload confirmation email | **Don’t.** Offer-only (and reject) by design. |
| Lexi notify on cloud lab | **Off** until explicit GO. |

## Watch / harden

1. **eBay Browse API** — Image search only from Cloud Run with stored seller board crops after Submit. Respect rate limits (single eBay worker thread in the pipeline). No Lexi spam. Do not scrape or republish listing images beyond what the pricing harness already does for Match. Credentials never on the Worker.
2. **Google Vision SafeSearch** — Moderation after Submit (same as production). Fail closed in production; lab may use Vision when keyed.
3. **Seller PII** — Offer email + staff alerts only as today. Draft `draft@…` collections must not linger (purge abandoned sessions).
4. **Do no harm** — No silent production wiring. Cloud lab does not touch Mac inbox, Named Collections, or sellmycollection until SHIP TO PRODUCTION.
5. **Confirm before all boards land** — Mitigated: BBE disables Confirm until `boards_done === boards_total`; confirm delta keeps baseline pins for boards not in the payload (not treated as deleted).

## Product copy vs pipeline

Privacy: photos upload while filling the form; submission is Submit. Keep that letter. Speed wins come from pipelined post-Submit detect/eBay + progressive BBE/CTM UI, not from pricing before consent.