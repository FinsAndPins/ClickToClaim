# Intake lessons

## 2026-11-14 — Confirm stuck on cloud_confirming after Match is ready

- **Symptom:** Seller Match page spun on “Opening Match…” while Cloud Run job was already `finishing_remaining` / harness 200. After open, pins still missing.
- **Cause:** (1) Confirm `waitUntil` dies before D1 → `cloud_done`. (2) Harness `<base href>` rewrite left the Cloud Run host in front of `/api/boxes/.../match-file/`, so crops/`ui_data` 401’d.
- **Rule:** Serve Match whenever Cloud Run harness is 200 (don’t wait on D1). Rewrite base to a **same-origin relative** `/api/boxes/:token/match-file/...` path only. Status poll still heals `cloud_confirming` → `cloud_done`. Force harness `lastPage = "match"` so sellers land on ClickToMatch, not Overlay.
- **Where:** `intake-cloud/src/app.ts` `GET /boxes/:token/match`, `GET /api/boxes/:token/status`

## 2026-11-14 — Import movie must not gate editor open

- **Symptom:** Box-overlay “movie” on the waiting page felt like it delayed Board Box Editor.
- **Cause:** Poll awaited session/box fetches for the animation *before* checking `status.ready`, then waited another 450ms before redirect.
- **Rule:** Treat the import movie as entertainment only. Check ready first and `location.replace` to the editor immediately; refresh overlays in the background.
- **Where:** `intake-cloud/public/import-waiting.html`

## 2026-11-14 — Upside-down boards: reencode stripped EXIF without transpose

- **Symptom:** Cloud lab BBE / detect photos all upside down after upload.
- **Cause:** Worker `reencodeToJpeg` (jsquash) decoded JPEG and re-saved without applying EXIF Orientation, stripping the tag. Cloud Run `_downscale_jpeg_bytes` did the same. Watcher / `rfdetr_onnx_detector` use `ImageOps.exif_transpose`; that only helps when Orientation is still present.
- **Rule:** Bake orientation into pixels before any re-encode or downscale (Worker + Cloud Run), same as Mac pricing. Redeploy both after changing either path.
- **Where:** `intake-cloud/src/reencode.ts`; `IntakeCloudPricing/cloud_detect/main.py` `_downscale_jpeg_bytes`

## 2026-11-14 — Finish deadlock: temps never cleared → detect never queued

- **Symptom:** Waiting page stuck on “Saving your photos…” / “Hang tight” with board visible; `mac_handoff_status` stayed null while all photos were already in `photos`.
- **Cause:** Completion required `upload_temp_photos` count == 0, but temp rows were only deleted *after* completion. Fake random boxes on the wait screen also looked like bad RF-DETR.
- **Rule:** Delete each temp row when its photo is stored; complete when `stored >= finish batch size`. Wait UI draws **real** boxes from `prefetch.json` only (no random placeholders).
- **Where:** `processSubmissionBackground`, `processPendingFinishes`, `public/import-waiting.html`

## 2026-11-14 — Vision wired; upload confirmation email is intentional no-op

- **Symptom:** Lab health showed `moderation:dev_pass`. Tests with an email address got no message.
- **Cause:** Lab lacked `GOOGLE_VISION_API_KEY`. Success path is offer-only by design (same as production); reject/offer need `RESEND_API_KEY` when those paths are tested.
- **Rule:** Wire Vision on `finsandpins-intake-cloud` for SafeSearch. Do **not** send an upload receipt. Put Resend only when testing offer/reject mail.
- **Where:** `wrangler secret put GOOGLE_VISION_API_KEY`; `/health`

## 2026-11-14 — “No photos yet” on import movie; lab moderation is dev_pass

- **Symptom:** After upload showed “uploaded” on each photo, `/boxes/:token` said “No photos yet.”
- **Cause:** Finish redirects to the waiting page before background finish writes rows into `photos`. Waiting page failed hard on empty list. Cloud lab `ENVIRONMENT=development` with no Vision/Sightengine secrets → moderation is `dev_pass` (not production SafeSearch).
- **Rule:** Waiting UI must poll until photos appear. Real moderation needs `GOOGLE_VISION_API_KEY` (or Sightengine) on the Worker; production stays fail-closed without it.
- **Where:** `intake-cloud/public/import-waiting.html`, `src/moderation.ts`, `wrangler.toml` ENVIRONMENT

## 2026-11-13 — Seller Board Box Editor (app-like), not staff-only

- **Symptom:** Uploader saw “Init failed: Invite required” / no BBE after cloud upload; editor lived only on admin.
- **Cause:** BBE APIs required staff + invite; finish redirected to `/thanks` with no review link.
- **Rule:** Mint `box_review_token` at finish; redirect to `/boxes/:token` (wait → editor). Token auth on `/api/boxes/*` (no staff). Invite bypass for `/boxes/` like `/o/`.
- **Where:** `intake-cloud` `schema_box_review_token.sql`, `app.ts`, `cloud-board-box-editor.html`, `seller-home.js`

## 2026-10-31 — Form “missing data” with photos on admin; pricing never ran

**Symptom:** Lexi uploaded photos, saw a missing-data style error, saw photos on the admin page, but pricing never started for the new attempts. One Melyssa collection had worked earlier.

**Cause:** Failed attempts never reached `finish` / `submitted` (only `photo_session_started`). Admin photos were the prior successful Melyssa/Tink cards, not the failed tries. Browser HTML5 `required` blocked submit with a vague native tooltip before our JS could name every blank field (delivery / privacy / price / autofill). Closing the tab and reopening the invite link starts a new attempt; it does not submit the abandoned session.

**Rule:** Form uses `novalidate`; client + server errors list every missing field by label. Resume `intakeSession` + temp photos after refresh. Do not treat admin gallery photos as proof the latest upload finished.

**Where:** `intake/public/seller-home.js`, `intake/src/app.ts` (`finishIdentityError`, temp photo list/preview)

## 2026-10-06 — Upload-first landing (photos then contact)

**Symptom:** Two-page flow felt slow. Lexi stayed on upload during moderation (fixed separately). Sellers waited on photos with nothing to do.

**Cause:** Contact form was required before any upload started.

**Rule:** Photos start uploading on pick. Step 2 unlocks as soon as upload starts. Submit collection is the only moment that creates a real submission (moderation + Mac handoff). Abandoned temp files expire and are deleted. Rollback: `docs/ROLLBACK_TWO_PAGE_20261006.md` and Worker `55276018-ad61-4938-aeff-fba58840f873`.

**Where:** `intake/` Worker only. Not NamedCollections, BoardsToPrice, or CTR watchers.

## 2026-10-06 — Overlay button + Pull total from Firebase

**Symptom:** Staff pasted the CTM URL and typed the harness total by hand.

**Cause:** Pricing publish lived in Named Collections / Pages with no intake callback.

**Rule:** Intake-only `link_pricing_overlay_once.py` (same handoff LaunchAgent) links the Open pricing overlay button. Staff clicks **Pull total from Firebase** after Lexi finishes pricing (sums `display_price`). Do not edit Named Collections for this.

**Where:** intake Worker admin card; `Cursor Projects/IntakeToCollectionsToPrice/link_pricing_overlay_once.py`

## 2026-10-07 — Open pricing overlay → index.html (not CTM)

**Symptom:** Dashboard Open pricing overlay opened `new_ctm.html`.

**Cause:** Intake linker used Named Collections’ CTM share URL.

**Rule:** Store and link `testing_ui_visual_baseline/index.html` (the overlay). Rewrite `new_ctm.html` → `index.html` on ingest. Pull total still uses `ui_data.json` / Firebase and does not care which page the button opens.

**Where:** `link_pricing_overlay_once.py`; intake `POST /api/mac/handoff/:id/pricing-overlay`

## 2026-10-11 — Safari autofill not counting as filled

**Symptom:** Lexi (and sellers) autofill name/email; fields look filled but Submit still says the form is incomplete until they type.

**Cause:** Contact fieldset started `disabled` until photos unlock Step 2. Safari/Chrome often paint autofill without firing `input` or syncing `.value`. Our finish check only read `.value`.

**Rule:** Do not disable the contact fieldset (visual lock + `pointer-events` is enough). Listen for `change`/`blur`/`focusin` and `:-webkit-autofill` animation; commit/re-read values before `formValid` and on unlock/pageshow.

**Where:** `intake/public/seller-home.js`, `intake/public/styles.css`, `intake/src/app.ts`

## 2026-10-30 — Submit stuck on “Submitting…” with fields filled

**Symptom:** Photos all said Uploaded; pink bar said Submitting; red error asked to fill name/email/price/delivery/privacy even when they looked filled.

**Cause:** Asking price `0` (or other ≤0) passed the client “non-empty” check but `parseDollarsToCents` returns null (`n <= 0`). Finish 400 used the generic fill-all message. Catch did not reset the upload status bar, so it stayed on Submitting.

**Rule:** Client and server both require price > $0 with a specific error. On finish failure, restore the uploaded-photos status. Cron must not re-alert failed/empty Melyssa-style orphans every 2 minutes.

**Where:** `intake/public/seller-home.js`, `intake/src/app.ts` (`parseDollarsToCents`, finish errors, `scanIncompleteCollections`)

## 2026-10-28 — Large finish died; empty handoff; one text for two uploads

**Symptom:** Lexi submitted Melyssa (21 boards) + Tinkandgoldie. Only one pricing text. Melyssa drop folder had markers only (0 JPEGs). Lexi had to press Send to CollectionsToPrice; Tink was missing a photo.

**Cause:** Background finish (`waitUntil`) hit Worker CPU limits mid-job: collection row created, not all photos stored, **auto handoff never ran** (`submitted` / `mac_handoff_queued auto:true` missing). Manual re-queue then delivered whatever photos existed. Helper also marked 0-photo Melyssa delivered.

**Rule:** Finish is resumable in ticks of 4 photos; cron every 2 minutes resumes claimed sessions and auto-queues handoff when complete. Refuse deliver on count mismatch. Seller must re-submit boards that never landed in `photos`.

**Where:** `intake/src/app.ts`, cron `*/2`, `schema_finish_collection_id.sql`, Mac handoff helper
