# Trusted advisor notes (cloud intake)

Steve asked for pushback when a choice is weak on tech, privacy, ToS, or harm. Living list.

## Decisions we made (and why)

| Choice | Verdict |
|--------|---------|
| One Cloud Run job, pipelined per board (detect N → eBay N while detect N+1) | **Do this.** Best time-to-first-board; one warm model; less state glue than 25 jobs. |
| 25 separate Cloud Run jobs (one per board) | **Don’t.** Cold starts, invoke fan-out, harder cancel/confirm. |
| Detect-all then eBay-all | Keep for **Mac batch** only. Wrong for seller wait. |
| RF-DETR while seller fills the form (after processing consent) | **Do.** Agree-and-choose grants processing consent; promote + detect-only (`prefetch_n=0`) can run during the form. Opens BBE faster. |
| eBay Browse while seller still fills the form (before Submit) | **Don’t.** Wasteful on abandoners and off-spirit. Kick Match-window prefetch on Submit (`/jobs/{id}/start-prefetch`) or run detect+prefetch together if detect had not started. |
| Upload confirmation email | **Don’t.** Offer-only (and reject) by design. |
| Lexi notify on cloud lab | **Off** until explicit GO. |

## Watch / harden

1. **eBay Browse API** — Image search only from Cloud Run with stored seller board crops after Submit. Respect rate limits (single eBay worker thread in the pipeline). No Lexi spam. Do not scrape or republish listing images beyond what the pricing harness already does for Match. Credentials never on the Worker.
2. **Google Vision SafeSearch** — Moderation after Submit (same as production). Fail closed in production; lab may use Vision when keyed.
3. **Seller PII** — Offer email + staff alerts only as today. Draft `draft@…` collections must not linger (purge abandoned sessions).
4. **Do no harm** — No silent production wiring. Cloud lab does not touch Mac inbox, Named Collections, or sellmycollection until SHIP TO PRODUCTION.
5. **Confirm before all boards land** — Mitigated: BBE disables Confirm until `boards_done === boards_total`; confirm delta keeps baseline pins for boards not in the payload (not treated as deleted).

## Product copy vs pipeline

Privacy: processing consent before any photo leaves the phone (Agree and choose); commercial Submit checkbox stays on step 2. Detect may run after processing consent; eBay only after Submit.