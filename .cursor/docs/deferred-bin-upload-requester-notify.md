# Deferred: notify CTR requesters when pins go to Whatnot BIN

**Status:** Idea only. Do **not** implement yet (Steve + Lexi ask, 2026-09-28).  
**Source:** After Script A/B hardening for show `20260928`, Lexi wants requesters notified when their requested pins are uploaded to the Whatnot buy-it-now listing.

## Goal (product)

When Fins & Pins uploads a show’s leftover / BIN Whatnot file, people who requested those pins in Click To Request get a heads-up (text and/or email) so they can go buy them.

## Why this is not a small bolt-on

CTR claims today store **display names / @handles**, not phone numbers or emails. Notification needs:

1. **Consent + contact capture** (opt-in) before any send.
2. A clear **trigger** (BIN upload succeeded), not Script B alone (Script B can run multiple times before upload).
3. A **digest per person** (one message listing their pins), not one SMS per pin.
4. Ops safety so Lexi/Steve are not accidentally blasted, and customers are not spammed on dry runs.

## Recommended shape (when we build it)

### 1. Opt-in contact on CTR (first)

- In Click To Request, after username entry (or in account/settings): optional **Notify me when my pins hit BIN** with email and/or mobile.
- Store under something like `notifyPrefs/{showId}/{userKey}` or `users/{userKey}/notify` with `{ email?, phone?, channels[], optedInAt, consentVersion }`.
- Default **off**. No contact → no message.
- Keep prefs out of the public claims tree if possible.

### 2. Trigger = “BIN upload confirmed”

Do **not** fire from Script B. Fire from an explicit post-upload step, e.g.:

- Lexi/Steve clicks **“BIN uploaded. Notify requesters”** on reports / a small Whatnot helper page, **or**
- A local command run only after Whatnot confirms the listing is live.

That step should:

1. Load final uploaded SKU/pin set (or the Whatnot CSV actually uploaded).
2. Join to `claims/{showId}` for those pins.
3. Join claim user keys to notify prefs.
4. Build one digest per opted-in user (board/pin list + Whatnot show/link).
5. Send via chosen channel(s); write `binNotify/{showId}/{userKey}` with status so re-runs are idempotent.

### 3. Channels

| Channel | Pros | Cons / needs |
|---|---|---|
| **Email** | Cheap, good for digests, easier compliance | Need a sender (SendGrid/Postmark/etc.) |
| **SMS** | High notice | TCPA consent, carrier costs, Twilio (or similar); do not use Steve’s personal iMessage blast to customers |
| **iMessage** | Already used for Lexi/Steve ops | Poor fit for many customers; Apple ID handles ≠ CTR usernames |

**Suggestion:** start with **email digest only**, optional SMS later with explicit SMS consent checkbox.

### 4. Message content (draft)

Subject/body roughly:

- Show date / name
- “Pins you requested are now available as Buy It Now on Whatnot”
- Short list (Board/Pin + character if cheap to include)
- Link to the Whatnot show or shop
- Unsubscribe / manage prefs link

Cap list length (e.g. first 15 pins + “and N more”).

### 5. Idempotency and dry runs

- Marker per show+user: do not resend on Script B reruns.
- Dry-run mode that writes the digest list to a review HTML/CSV for Lexi before any send.
- Steve-only test send first.

## Out of scope / do not confuse

- This is **not** Whatnot order / shipping notifications.
- This is **not** the pricing-watcher iMessage path to Lexi.
- Do not harvest phones from elsewhere without consent.

## Implementation sketch (later)

1. CTR UI: opt-in + contact fields → Firebase prefs.  
2. Small `Cursor Projects` (or later promoted) notifier: join CSV + claims + prefs → digests.  
3. Admin button / command after BIN upload.  
4. Email provider integration; SMS phase 2.  
5. Audit log in Firebase or local `bin_notify_runs/`.

## Related

- Script B already rebuilds `Requested by:` from claims; that join key is the pin side of this feature.
- Whatnot upload lessons: `Cursor Projects/WhatnotUploadRunner/LESSONS_20260917.md`
