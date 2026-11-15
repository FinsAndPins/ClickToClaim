# Sell My Collection — Cloud lab (separate site)

**This is not production intake.**  
Production remains: `finsandpins-intake` → https://sellmycollection.finsandpins.shop (Mac handoff unchanged).

This Worker is an invite-only twin that prices on **Google Cloud Run** (RF-DETR + eBay + CTM/CTP). Lexi notify stays **off**.

## URLs

- Workers.dev (after deploy): see `wrangler.toml` `PUBLIC_BASE_URL`
- Seller + admin UX: same as production intake, with a CLOUD LAB banner

## Secrets (never commit)

```bash
cd intake-cloud
npx wrangler secret put INVITE_CODE
npx wrangler secret put GOOGLE_VISION_API_KEY   # optional; same as prod for moderation
npx wrangler secret put RESEND_API_KEY          # optional for offer emails
npx wrangler secret put CLOUD_PRICE_INVOKE_KEY  # must match Cloud Run INTAKE_CLOUD_INVOKE_KEY
```

## One-time GCP bridge

Cloud Run service `intake-cloud-detect-parallel` accepts `X-Intake-Cloud-Key` and stays free of Lexi notify.

### iOS-style prefetch + Board Box Editor (cloud only; iOS app untouched)

ClickToCollect prefetches eBay for the first **20** pins during celebration, then only reprices box deltas after review. Cloud mirrors that:

1. **Upload finish** → seller lands on `/boxes/:token` (wait while detect + prefetch run)
2. **Board Box Editor** → auto-opens at `/boxes/:token/editor` when status is `cloud_awaiting_boxes` (same CTR-style UX; token auth, no staff login)
3. Staff can still open the editor from admin; seller link is on the collection page too
3. **Confirm** → delta reprice + finish remaining eBay + harness

One-shot (skip editor) remains available on the collection admin page.

## Deploy

```bash
npx wrangler d1 create intake-cloud          # paste database_id into wrangler.toml
npx wrangler r2 bucket create finsandpins-intake-cloud
npx wrangler d1 execute intake-cloud --remote --file=./schema.sql
# plus any schema_*.sql files used by prod intake
npx wrangler deploy
```

## Lexi workflow (goal)

Same CTM/CTP harness she already uses, opened from admin **Open cloud CTM / CTP harness**. Match / No match writes Firebase local-only test_run_id for now. Full Lexi parity (collab Firebase + notify) waits for GO.
