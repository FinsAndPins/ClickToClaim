# Cloud intake north star

**Intent:** The cloud lab starts as an exact duplicate of Mac/non-cloud intake (photos → SafeSearch → seller review → offer), with **everything in the cloud**. Lexi notification stays **OFF** while testing. Then we add cloud-only speed: Board Box Editor + ClickToMatch, with as little wait as possible.

Production `sellmycollection.finsandpins.shop` stays untouched until **SHIP TO PRODUCTION**.

## Latency goals

1. Photos may **upload** while the seller fills the form (disclosed). Detect/eBay wait until **Submit** (privacy / ToS).
2. After Submit, **pipelined** detect→eBay so board 1’s boxes (and Match-window prices) appear ASAP while later boards still detect.
3. **Partial readiness:** BBE/CTM show boards/pins as they become available; keep the rest loading.
4. Lexi iMessage stays off until Steve says GO.

## Current lab behavior

| Phase | What runs |
|-------|-----------|
| Photo pick | Upload to R2 temp only (not a submission yet) |
| Submit | SafeSearch → store → one Cloud Run job: detect board N, eBay those crops while detecting N+1 |
| First board ready | `board_ready` callback → import movie opens BBE; editor polls for more boards |
| Confirm boxes | Match for ready pins; remaining eBay deferred in background |

## Detect ↔ eBay order (cloud only)

Batch “detect all boards, then eBay all pins” is right for overnight Mac pricing. For seller wait time it is wrong.

**Prefer pipelined per board (not strict sequential):** as each board finishes RF-DETR, immediately start eBay on those crops while the next board detects. Overlap detect and eBay. Do **not** wait for board 1’s full eBay window before starting board 2 detect (that idles the GPU). Do **not** wait for all 25 detects before any eBay (that delays first Match pins).

Seller-facing: BBE/CTM show boards/pins as each board’s detect (then its eBay) completes.

## Still next

See `FUTURE_DEVELOPMENT.md` (Lexi staff cloud price, progressive CTM, Lexi notify GO, etc.).
