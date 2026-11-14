# Cloud intake north star

**Intent:** The cloud lab starts as an exact duplicate of Mac/non-cloud intake (photos → SafeSearch → seller review → offer), with **everything in the cloud**. Lexi notification stays **OFF** while testing. Then we add cloud-only speed: Board Box Editor + ClickToMatch, with as little wait as possible.

Production `sellmycollection.finsandpins.shop` stays untouched until **SHIP TO PRODUCTION**.

## Latency goals

1. **While the seller fills the form**, uploaded boards already run SafeSearch → RF-DETR → eBay prefetch.
2. **By Submit**, Board Box Editor should often be ready (or show boards that are ready first).
3. **Partial readiness:** show detected boards / Match pins as they become available; keep the rest loading in the background.
4. Lexi iMessage stays off until Steve says GO.

## Current lab behavior (progressive v1)

| Phase | What runs |
|-------|-----------|
| Photo pick | Upload to R2 temp → Vision SafeSearch → promote into draft collection → debounced Cloud Run detect+prefetch |
| Form fill | Detect continues; import movie / BBE can open once `cloud_awaiting_boxes` |
| Submit | Identity written onto draft; confirmation email attempted; remaining temps finished; detect refreshed if more boards landed |
| Confirm boxes | Same as before → Match with deferred remaining pricing |

## Still next

- True incremental detect (append boards without full re-job)
- Progressive CTM UI that lists ready pins while others load
- Wire `RESEND_API_KEY` on the lab Worker (receipt + reject + offer emails)
- Lexi notify only after explicit GO
