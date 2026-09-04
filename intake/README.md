# Sell My Collection (intake) — v1

Public site (planned): **https://sell.finsandpins.shop**  
Shop stays on **https://finsandpins.shop** (ClickToRequest + Shopify).

This folder is a Cloudflare Worker app: seller upload, moderation, staff dashboard, firm offers, Accept → Ready to pay.

## Run locally (Mac)

```bash
cd intake
./scripts/setup_local.sh
npm run dev
```

- Seller: http://127.0.0.1:8787/?invite=local-dev  
- Staff: http://127.0.0.1:8787/admin  

Smoke: `./scripts/smoke_local.sh` (with `npm run dev` running).

**Deploy day:** [`docs/HOME_DAY.md`](docs/HOME_DAY.md)

## What v1 does

- Seller: name, email, PayPal G&S, agree to terms, up to 100 photos (15 MB each)
- Photos sit in a temp bucket, get moderated, then either **deleted** (reject + staff alert, no image) or stored as clean originals
- Staff Kanban, cover photo, private note, overlay URL, harness total + 30/40/50/60% helpers
- One firm offer email from `offer@finsandpins.shop` (when Resend is configured)
- Reusable offer link, **7 days**, reissue without repricing
- Accept → email Steve/Lexi “Ready to pay”; show ship-to; seller ships themselves
- Decline: optional why / optional “what would have worked”
- Pricing data is kept even after expiry/decline

## What v1 does not do (on purpose)

- Invite-only until you turn it off (`?invite=` or the code form)
- No cloud RF-DETR / eBay pricing in v1 (still Mac CTM/CTP). Prep notes: `docs/CLOUD_PRICING_MIGRATION.md`
- No PayPal API yet (manual G&S after Accept)
- No auto shipping labels (seller’s postage)
- No second moderation vendor yet (Google Vision first: `docs/MODERATION.md`)

See **ACTION_ITEMS.md** for Mac deploy steps.

Docs:

| File | Purpose |
|------|---------|
| `ACTION_ITEMS.md` | Who does what |
| `LOCKED_DECISIONS.md` | Product decisions |
| `docs/HOME_DAY.md` | **Ordered Mac deploy + Lexi test** |
| `docs/MODERATION.md` | Why Google Vision, how to add the key |
| `docs/CLOUD_PRICING_MIGRATION.md` | Later: private RF-DETR/eBay (not v1) |
