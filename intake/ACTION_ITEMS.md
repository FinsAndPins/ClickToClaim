# What you need to do vs what waits for the Mac

Phone-friendly checklist. Nothing here requires writing code.

---

## You can do from your iPhone

### 1. Cloudflare (needed to put this on sell.finsandpins.shop)

- [ ] Cloudflare account on the same login you’ll use for the shop
- [ ] Add DNS for **`sell.finsandpins.shop`** later (CNAME to the worker — Mac or I can do this once the account is connected)
- [ ] **Cloudflare Access** application for `/admin*` on the sell hostname
  - Allow **steve.fierstein@gmail.com**
  - Add **Lexi’s email** when you have it (reply here)
- [ ] Create **R2** bucket `finsandpins-intake`
- [ ] Create **D1** database `intake` and run `schema.sql`

### 2. Email

- [ ] Pick a transactional provider (Resend is what the app is wired for)
- [ ] Domain: send **From `offer@finsandpins.shop`**
- [ ] SPF/DKIM on `finsandpins.shop` (DNS — 10 minutes on Mac is easier)
- [ ] Staff alerts already default to **finsandpins@gmail.com**
- [ ] Add Lexi’s email for alerts when you have it

### 3. Content moderation (required before real sellers)

- [ ] Create a **Sightengine** account (v1 default) and save API user + secret
  - Or Google Cloud Vision API key if you prefer
- [ ] Do **not** put keys in chat. When you’re at a keyboard, paste them into Cloudflare Worker secrets / `.dev.vars`
- [ ] Optional later: send me a handful of real board JPGs to measure false-positive rate (Mac iCloud is easier)

### 4. Copy I still need from you

- [ ] **Ship-to address** shown after Accept
- [ ] **Lexi’s email** for Access + alerts
- [ ] Confirm Sightengine vs Google Vision

### 5. Lawyer (not blocking a private beta)

- [ ] One question: if moderation flags a severe category and we only store name/email + reason code (no image), what must we do?

---

## When you’re back on the MacBook

These need the laptop, not the iPhone:

- [ ] `cd intake && npm install && npm run dev` and click through seller + staff flows
- [ ] Set `SHIP_TO_ADDRESS` in `.dev.vars`
- [ ] `npx wrangler login` and `npx wrangler deploy`
- [ ] Create real D1 + R2 and bind them in `wrangler.toml` (replace the placeholder database id)
- [ ] `wrangler secret put RESEND_API_KEY`
- [ ] `wrangler secret put SIGHTENGINE_USER` and `SIGHTENGINE_SECRET`
- [ ] Point `sell.finsandpins.shop` at the worker
- [ ] Test photo download: `./scripts/download_collection.sh <id>` then drop the folder into the **existing pricing watcher inbox**
- [ ] After CTP: paste overlay URL + harness total on the staff card, send offer
- [ ] Optional: test moderation on real boards (same Sightengine call the worker uses)

**Not on this Mac trip (later):**

- Cloud RF-DETR / eBay keys / auto harness link after upload
- PayPal G&S API (“create payment request”)
- Second moderation vendor
- Cindy’s Access login

---

## What I already built in this PR

- Seller upload + privacy/terms + PayPal G&S required
- Temp storage → moderation → clean originals or full delete
- Staff dashboard (Kanban, notes, overlay, % helpers, photos, event log)
- Offer email + 7-day reusable link + reissue
- Accept → Ready to pay email; ship-to; seller postage
- Decline survey (optional wanted amount)
- Waiting / received list
- Local Mac download script for pricing
- Cron cleanup of abandoned temp uploads (~40 min)

Local dev **passes photos without a moderation vendor**. Production **refuses uploads** until a vendor key is set (fail closed).
