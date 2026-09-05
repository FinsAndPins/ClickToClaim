# Content moderation — v1 recommendation

## Recommendation: Google Cloud Vision SafeSearch

Use **Google**, not Sightengine, for v1.

**Why**

- You already live in Google products. One Cloud bill, one API key, same org you’ll want later for cloud pricing.
- SafeSearch is a normal first filter for user-uploaded photos (adult / racy / violence / medical).
- The intake worker already calls it. No new vendor account.
- Sightengine is a *better specialist* for UGC nudity scoring, but it’s another company, another invoice, and another secret. We planned a **second** vendor only after we measure false positives on real pin boards.

**Caveat (important for Disney pins)**  
Cartoon characters, shiny metal, and skin-tone plastics can trip **racy** at our strict setting (we reject `POSSIBLE` and up). That’s the “never even slightly questionable” bar. After you’re home, run `scripts/test_google_safesearch.mjs` on a folder of real boards. If too many good boards fail, we loosen **racy** only — not adult/violence.

**Do not put the API key in chat or git.** On the Mac: `npx wrangler secret put GOOGLE_VISION_API_KEY`

## Create the key (Mac, ~10 minutes)

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create or pick a project (e.g. `finsandpins-intake`)
3. Enable **Cloud Vision API**
4. APIs & Services → Credentials → **Create credentials → API key**
5. Restrict the key: **Cloud Vision API** only, and optionally HTTP referrer / IP once you know the worker egress (restriction can wait until after a first test)
6. Store it as a Worker secret (step above)

Billing must be enabled on the project. Vision SafeSearch is cheap at collection-intake volume.

## What happens on reject

- Temp photo is deleted
- Nothing is written to the clean originals bucket
- Staff get name / email / PayPal / reason codes — **no image**
- Seller is asked to retry with board photos only
