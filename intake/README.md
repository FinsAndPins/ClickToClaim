# Sell My Collection (intake) — v1

Public site (planned): **https://sell.finsandpins.shop**  
Shop stays on **https://finsandpins.shop** (ClickToRequest + Shopify).

This folder is a Cloudflare Worker app: seller upload, moderation, staff dashboard, firm offers, Accept → Ready to pay.

## Run locally (Mac)

```bash
cd intake
cp .dev.vars.example .dev.vars
npm install
npx wrangler d1 execute intake --local --file=./schema.sql
npm run dev
```

Open:

- Seller: http://127.0.0.1:8787/
- Staff: http://127.0.0.1:8787/admin  
  (local bypass uses `DEV_ADMIN_EMAIL` in `.dev.vars`)

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
| `ACTION_ITEMS.md` | Phone vs Mac checklist |
| `LOCKED_DECISIONS.md` | Product decisions |
| `docs/MODERATION.md` | Why Google Vision, how to add the key |
| `docs/CLOUD_PRICING_MIGRATION.md` | How to move RF-DETR/eBay later **without** putting keys on the public site |
