# Cloud intake — future development

Ideas deferred on purpose. Build when seller cloud path is stable. Production sellmycollection / Mac inbox stay untouched until **SHIP TO PRODUCTION**.

## Lexi staff cloud price (priority)

Separate staff section (not the seller intake form) that reuses the same Cloud Run pipeline with a simplified front end.

- **Auth:** Staff only (existing admin / DEV_ADMIN pattern), no invite code or seller contact form.
- **Flow:** Drop board photos → pipeline starts immediately (pipelined detect→eBay) → optional Board Box Editor or “confirm as detected” → Match / harness link.
- **Notify:** Lexi iMessage stays **off** until Steve says GO.
- **Privacy:** Staff tooling is not the seller privacy path (no “hold until Submit” seller copy).
- **Suggested home:** `/admin/cloud-price` (or a short staff URL) on the cloud lab Worker first.
- **Do not:** Retarget BoardsToPrice / Mac Named Collections without SHIP TO PRODUCTION.

## Other backlog

| Item | Notes |
|------|--------|
| Progressive CTM | Show Match pins as they price; keep loading the rest (seller path). |
| Privacy update for pre-Submit detect | Only if product wants RF-DETR before Submit; requires rewriting `/privacy` first. Not allowed under current copy. |
| Incremental detect append | Add boards to a running job without full re-detect when more photos land mid-job. |
| Resend on lab | Wire when testing offer/reject email; no upload receipt. |
| Custom domain for cloud lab | e.g. cloud-lab.finsandpins.shop after DNS. |
| Lexi notify on cloud | Explicit GO only. |
| SHIP TO PRODUCTION | Wire production intake / pages only when Steve says so. |

## Related

- North star: `NORTH_STAR.md`
- Advisor / ToS notes: `ADVISOR_NOTES.md`
