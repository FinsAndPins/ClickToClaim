# What you need to do vs what waits for the Mac

**Start here on home day:** [`docs/HOME_DAY.md`](docs/HOME_DAY.md) — ordered commands for Lexi-ready deploy.

---

## Locked from planning

- [x] Ship-to: **Fins and Pins, LLC**, 15049 Canopy Cover Dr, Winter Garden, FL 34787
- [x] Lexi alerts / Access: **finsandpins@gmail.com** (+ steve.fierstein@gmail.com)
- [x] Invite-only; 24h offer aim; Disney pins; no minimum; photo tips; US shipping only
- [x] No public email addresses; offer mail says don’t reply
- [x] Moderation: **Google Cloud Vision SafeSearch**
- [x] PR merge conflicts with `main` resolved on this branch

---

## You (accounts — phone or Mac)

- [ ] Cloudflare account
- [ ] Google Cloud Vision API key (`docs/MODERATION.md`)
- [ ] Resend account + domain verify for `offer@` / `noreply@`
- [ ] Invite code (password manager; set via `wrangler secret put INVITE_CODE`)

## You (Mac sitting — see HOME_DAY.md)

- [ ] `./scripts/setup_local.sh` + `npm run dev` + `./scripts/smoke_local.sh`
- [ ] `wrangler login` + `./scripts/provision_cloudflare.sh`
- [ ] Paste real D1 `database_id` into `wrangler.toml`
- [ ] Secrets + `ENVIRONMENT=production` + `PUBLIC_BASE_URL`
- [ ] `wrangler deploy` + DNS `sell.finsandpins.shop` + Access on `/admin*`
- [ ] Lexi dry run (upload → price on Mac → offer → accept)

## Me (already done / can do on Mac with you)

- [x] App code + invite gate + US-only + no-reply policy
- [x] Merge conflicts with `main`
- [x] `setup_local.sh`, `smoke_local.sh`, `provision_cloudflare.sh`, `HOME_DAY.md`
- [ ] Fix bugs you hit during deploy (open Cursor on the Mac)
- [ ] Tune Vision thresholds if real boards false-positive

## Later (not home day)

Cloud RF-DETR/eBay (`docs/CLOUD_PRICING_MIGRATION.md`), PayPal API, public no-invite, non-US exceptions.
