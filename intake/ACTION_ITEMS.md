# What you need to do vs what waits for the Mac

Phone-friendly checklist. Nothing here requires writing code.

---

## Locked from you (this session)

- [x] Ship-to: **Fins and Pins, LLC**, 15049 Canopy Cover Dr, Winter Garden, FL 34787
- [x] Lexi alerts / Access: **finsandpins@gmail.com** (plus Steve: steve.fierstein@gmail.com)
- [x] Moderation vendor: **Google Cloud Vision SafeSearch** (see `docs/MODERATION.md`)

---

## You can still do from your iPhone

### Cloudflare (needed for sell.finsandpins.shop)

- [ ] Cloudflare account (same one you’ll use for the shop)
- [ ] Later on Mac: DNS for **`sell.finsandpins.shop`**, Access for `/admin*`
  - Allow **steve.fierstein@gmail.com** and **finsandpins@gmail.com**
- [ ] R2 bucket `finsandpins-intake` + D1 database `intake`

### Email

- [ ] Resend (or similar) account — app is wired for Resend
- [ ] From **`offer@finsandpins.shop`** + SPF/DKIM (Mac DNS is easier)
- [x] Staff alerts: **finsandpins@gmail.com**

### 3. Google Vision (required before real sellers)

- [ ] On Mac: enable Cloud Vision API, create a **restricted API key**, `wrangler secret put GOOGLE_VISION_API_KEY`
- [ ] Do **not** paste the key in chat
- [ ] Optional: run `node scripts/test_google_safesearch.mjs` on real board photos

### Lawyer (not blocking a private beta)

- [ ] If Vision flags a severe category and we only store name/email + reason code (no image), what must we do?

---

## When you’re back on the MacBook

- [ ] `cd intake && npm install && npm run dev` — seller at `/`, staff at `/admin`
- [ ] `npx wrangler login` and deploy
- [ ] Create real D1 + R2; put the real `database_id` in `wrangler.toml`
- [ ] `wrangler secret put GOOGLE_VISION_API_KEY`
- [ ] `wrangler secret put RESEND_API_KEY`
- [ ] Point `sell.finsandpins.shop` at the worker; Cloudflare Access on `/admin*`
- [ ] `node scripts/test_google_safesearch.mjs /path/to/boards`
- [ ] `./scripts/download_collection.sh <id>` → pricing watcher inbox
- [ ] Paste overlay URL + harness total, send offer

**Not this trip (later):** full cloud RF-DETR/eBay — blueprint is `docs/CLOUD_PRICING_MIGRATION.md`. PayPal API, second moderation vendor, Cindy Access.

---

## What is already in the PR

- Seller upload + terms + PayPal G&S
- Temp → Google Vision (when keyed) → keep or delete; staff alert without image
- Kanban, notes, overlay, % helpers, photos, event log
- 7-day offer link + reissue
- Accept → Ready to pay; ship-to LLC address; seller postage
- Decline survey; waiting/received list
- Mac download script + Vision board-test script
- `pricing_jobs` table reserved for a future private pricing service
