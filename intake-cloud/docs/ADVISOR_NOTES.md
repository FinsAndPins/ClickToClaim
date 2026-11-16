# Trusted advisor notes (cloud intake)

Steve asked for pushback when a choice is weak on tech, privacy, ToS, or harm. Living list.

## Decisions we made (and why)

| Choice | Verdict |
|--------|---------|
| Seller cloud = non-cloud workflow | **Do this.** Lexi’s win is Instagram → site. Keep upload → Submit → Thanks. No seller BBE/Match. |
| Seller Agree-and-choose + early detect | **Retired (2026-11-16).** Overcomplicated the seller path; non-cloud was already fine. |
| Internal cloud BoardsToPrice (detect + BBE immediately) | **Later, separate tool.** Staff only; no privacy acknowledgments. See `FUTURE_DEVELOPMENT.md`. |
| One Cloud Run job, pipelined per board | **Keep for internal / staff pricing.** Not for the public seller wait screen. |
| Upload confirmation email | **Don’t.** Offer-only (and reject) by design. |
| Lexi notify on cloud lab | **Off** until Steve says GO. |

## Watch / harden

1. **Seller path** — Finish lands on `/thanks`. Do not auto-open `/boxes/…` for sellers.
2. **Google Vision SafeSearch** — On Submit (same as production). Fail closed in production; lab may use Vision when keyed.
3. **Seller PII** — Offer email + staff alerts only as today.
4. **Do no harm** — No silent production wiring. Cloud lab does not touch Mac inbox, Named Collections, or sellmycollection until SHIP TO PRODUCTION.
5. **Internal tool** — When built, keep it under `/admin/…`; never mix seller ToS into that flow.

## Product copy

Privacy: photos may upload while filling the form; submission is Submit. Seller does not agree to live pin detect before Submit. Internal staff tooling needs no seller consent UI.
