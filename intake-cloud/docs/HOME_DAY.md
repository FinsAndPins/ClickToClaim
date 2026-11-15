# Home day — get Lexi a testable site

One sitting. Do these in order. Full product background: `LOCKED_DECISIONS.md`.

**PR:** https://github.com/FinsAndPins/ClickToClaim/pull/22  
**Branch:** `cursor/collection-intake-v1-0cd2` (or `main` after you merge)

---

## 0. Before you sit down (accounts — can be phone browser)

Create/login if you don’t have them yet:

1. **Cloudflare** (same account you’ll use for the shop)
2. **Google Cloud** project + enable **Cloud Vision API** + create an API key  
   Details: `docs/MODERATION.md`
3. **Resend** account for email
4. Pick a long random **invite code** (password manager). Don’t put it in chat or git.

Have ready: Vision API key, Resend API key, invite code.

---

## 1. Local prove-it (~10–15 min)

```bash
cd /path/to/ClickToClaim
git checkout cursor/collection-intake-v1-0cd2   # or main if merged
git pull
cd intake
./scripts/setup_local.sh
npm run dev
```

Other terminal:

```bash
cd intake
./scripts/smoke_local.sh
```

Browser:

- Seller: http://127.0.0.1:8787/?invite=local-dev  
- Staff: http://127.0.0.1:8787/admin  

Click through: form → upload a JPEG → finish → see card on Kanban. (Local moderation **passes** without a Vision key.)

---

## 2. Cloudflare resources (~15–20 min)

```bash
cd intake
npx wrangler login
./scripts/provision_cloudflare.sh
```

Then:

1. Paste the real **D1 `database_id`** into `wrangler.toml` (replace the placeholder UUID).
2. Apply remote schema if you skipped it in the script:
   `npx wrangler d1 execute intake --remote --file=./schema.sql`

---

## 3. Secrets + production vars (~10 min)

```bash
npx wrangler secret put GOOGLE_VISION_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put INVITE_CODE
```

In Cloudflare Worker settings for `finsandpins-intake`, set:

| Variable | Value |
|----------|--------|
| `ENVIRONMENT` | `production` |
| `PUBLIC_BASE_URL` | `https://sell.finsandpins.shop` |

(Ship-to, staff emails, etc. are already in `wrangler.toml`.)

---

## 4. Deploy + DNS + Access (~20–40 min — DNS is the variable)

```bash
npx wrangler deploy
```

1. Cloudflare DNS for **`sell.finsandpins.shop`** → this Worker (Workers custom domain, or CNAME per Cloudflare’s UI).
2. **Cloudflare Access** application covering `sell.finsandpins.shop/admin*`  
   Allow: `steve.fierstein@gmail.com`, `finsandpins@gmail.com`
3. Resend: verify domain; add SPF/DKIM for **`offer@finsandpins.shop`** and **`noreply@finsandpins.shop`**.

Share with Lexi only:

`https://sell.finsandpins.shop/?invite=YOUR_CODE`

---

## 5. Lexi dry run (the real test)

1. Lexi: invite link → upload 2–3 board photos  
2. You: `/admin` → open card → **Download** via  
   `INTAKE_BASE_URL=https://sell.finsandpins.shop ./scripts/download_collection.sh <id>`  
   (Access may require a browser download of photos from the card until you add an Access service token.)
3. Drop folder into existing **pricing watcher** → CTP as usual  
4. Paste **overlay URL** + **harness total** on the card → **Send offer**  
5. Lexi: open email link → Accept or Decline  
6. You: PayPal G&S (manual) → mark Paid → Waiting → Received  

Optional before live sellers:

```bash
GOOGLE_VISION_API_KEY=… node scripts/test_google_safesearch.mjs /path/to/real/boards
```

---

## If something breaks

| Symptom | Check |
|---------|--------|
| Seller sees “Invite only” | Wrong code, or `INVITE_CODE` secret not set |
| Upload fails in production | Missing Vision key (`/health` → moderation: missing) |
| No offer email | Resend key / domain not verified; events log on the card |
| Can’t open `/admin` | Access allowlist; locally DEV_ADMIN_EMAIL bypass only works on wrangler dev |
| Merge/deploy confusion | Ask Cursor on the Mac with this file open |

---

## Not this sitting

Cloud RF-DETR, PayPal API, public (no invite) launch, non-US shipping.  
Blueprint: `docs/CLOUD_PRICING_MIGRATION.md`.
