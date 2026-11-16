# Cloud intake — future development

Ideas deferred on purpose. Production `sellmycollection` / Mac inbox stay untouched until **SHIP TO PRODUCTION**.

## Seller cloud lab (current goal)

Match the **non-cloud / Mac intake** seller experience Lexi already liked:

1. Seller uploads board photos (may upload while filling contact).
2. Privacy/terms checkbox at **Submit** (not a separate pre-picker processing modal).
3. SafeSearch → store photos → **Thanks** (offer later by email).
4. No seller Board Box Editor, Match, or live detect wait.

The win for Lexi is moving collection intake **off Instagram** onto this site. Pricing stays a staff/Mac (or later staff-cloud) step behind the scenes.

---

## Internal cloud BoardsToPrice (future — Lexi + Steve)

**Status:** Spec only. Do not wire into the seller form.

A **separate** staff tool, similar UX energy to seller upload, but for **our** boards we want to price (like dropping into BoardsToPrice), not for public sellers.

| | Seller intake (now) | Internal cloud price (later) |
|--|---------------------|------------------------------|
| Who | Public / invite sellers | Lexi + Steve (staff auth only) |
| Privacy / ToS acknowledgments | Required (seller checkbox + privacy page) | **None** (internal operators) |
| When detect starts | Not on seller path | **Immediately** on photo drop |
| Box editor | No | Optional after detect (delta reprice on edits). Default: auto-price as detected |
| Then | Thanks → offer email later | Match / CTM–CTP harness link for pricing |
| Notify Lexi | Offer email only (lab: notify off until GO) | Optional; iMessage stays off until Steve says GO |

### Suggested shape

- **Home:** `/admin/cloud-price` (or short staff URL) on the cloud lab Worker first.
- **Flow:** Drop board photos → Cloud Run detect→eBay immediately → Match / harness. Optional Board Box Editor only when boxes look wrong (delta reprice).
- **Reuse:** Existing Cloud Run (`IntakeCloudPricing`), admin box-session / confirm / Match plumbing already built for the lab. Seller `/boxes/:token` routes can stay as staff/debug or be folded under `/admin/…`.
- **Do not:** Retarget production BoardsToPrice / Mac Named Collections / sellmycollection without **SHIP TO PRODUCTION**.
- **Do not:** Add seller privacy modals to this internal tool.

### Why separate

Seller path must stay simple and trustworthy (Instagram replacement). Internal path can optimize for Lexi’s pricing speed (immediate detect + box edit) without seller consent theater.

---

## Other backlog

| Item | Notes |
|------|--------|
| Resend on lab | Wire when testing offer/reject email; no upload receipt. |
| Custom domain for cloud lab | e.g. cloud-lab.finsandpins.shop after DNS. |
| Lexi notify on cloud | Explicit GO only. |
| SHIP TO PRODUCTION | Wire production intake / pages only when Steve says so. |
| Incremental detect append | Add boards to a running job without full re-detect (internal tool). |

## Related

- North star: `NORTH_STAR.md`
- Advisor / ToS notes: `ADVISOR_NOTES.md`
- Cloud pricing migration (longer arc): `CLOUD_PRICING_MIGRATION.md`
