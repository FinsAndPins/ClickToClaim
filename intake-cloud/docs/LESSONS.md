# Intake lessons

## 2026-11-16 — Preflight: double Detect + missing overlay button

- **Risks before next seller test:** (1) `send-to-ctp` left `cloud_queued` while also `waitUntil(detect)` → cron could start a second Cloud Run job. (2) Admin page did not auto-refresh, so Open pricing overlay looked “missing” after Detect. (3) waitUntil could die after claiming `cloud_running` with only `cloud_pending:…` folder.
- **Rule:** Claim `cloud_running` immediately after queue; cron atomically claims `cloud_queued` before detect. Admin collection page polls until Open pricing overlay exists. Cron restarts detect if still `cloud_running` with no `cloud:` job after ~90s. Keep overlay heal for `cloud_confirming` + harness-ready phases.
- **Where:** `send-to-ctp`, `processQueuedCloudPricing`, admin collection poll script, `healStuckCloudJobs`

## 2026-11-16 — Overlay missing after Detect: heal cloud_confirming → cloud_done

- **Symptom:** Detect + price ran; Cloud Run harness existed; admin still said Open pricing overlay appears after Detect + price (no button).
- **Cause:** `continuePricingAfterDetect` / confirm `waitUntil` died after Cloud Run reached `match_ready`, before D1 wrote `overlay_url` + `cloud_done`.
- **Rule:** Cron heal: if `cloud_confirming` and Cloud Run phase is harness-ready (`match_ready` / `done` / …), set `cloud_done` + `overlay_url`. Also restore missing `overlay_url` when already `cloud_done`.
- **Where:** `healStuckCloudJobs` in `intake-cloud/src/app.ts`

## 2026-11-16 — Admin pricing overlay: invite blocked CTM/CTP assets

- **Symptom:** Staff could open `/admin/.../cloud-harness` but ClickToMatch / ClickToPrice assets 403’d; button label also unclear vs Mac “Open pricing overlay”.
- **Cause:** Invite middleware required a cookie for `/api/cloud/*` even though those routes are staff-gated. Cloud Run `<base href>` pointed at Cloud Run, so asset URLs never hit the Worker proxy.
- **Rule:** Bypass invite for `/api/cloud/` (staff auth on the route). Rewrite harness HTML `<base>` + file URLs to `/api/cloud/jobs/{id}/file/...`. Admin button label = **Open pricing overlay** (same as non-cloud).
- **Where:** `app.ts` invite middleware; `cloud_price.ts` `rewriteCloudHarnessHtml`

## 2026-11-16 — Staff Detect auto-prices; BBE optional delta

- **Symptom:** Admin collection page parked on Board Box Editor after RF-DETR; harness only after Confirm.
- **Cause:** Progressive seller UX treated BBE as a required gate before eBay finish.
- **Rule:** Staff **Detect + price** runs RF-DETR then auto confirm-as-detected (finish eBay + harness). Board Box Editor is optional for bad boards; Save delta-reprices (drop deleted, price added, re-price moved, keep unchanged). Cron heals stuck `cloud_awaiting_boxes` the same way.
- **Where:** `intake-cloud/src/app.ts` `continuePricingAfterDetect`; Cloud Run `confirm-boxes` / `apply_box_confirm_delta`

## 2026-11-16 — Seller path = non-cloud; detect+BBE is internal later

- **Symptom:** Agree-and-choose + early detect + seller BBE made cloud intake feel harder than the Mac form Lexi already liked.
- **Cause:** Optimized for pricing speed on the public seller path; Lexi’s real win is Instagram → site, not seller box editing.
- **Rule:** Seller cloud = upload → Submit privacy checkbox → SafeSearch → `/thanks` → staff prices → offer email. No seller BBE/Match/early detect. Keep detect + Board Box Editor for a **separate** internal BoardsToPrice tool (staff auth, no privacy acknowledgments). Spec: `FUTURE_DEVELOPMENT.md`.
- **Where:** `seller-home.js`, `app.ts` finish/`/thanks`; docs `NORTH_STAR.md`, `ADVISOR_NOTES.md`, `FUTURE_DEVELOPMENT.md`

## 2026-11-15 — Processing consent before Choose; detect-only until Submit (retired)

- **Goal (retired):** Start RF-DETR as soon as boards upload, without eBay on abandoners.
- **Was:** Agree-and-choose modal → `processing_consent_at` → progressive promote + `prefetch_n=0`. Replaced by non-cloud seller path above; consent column may linger unused in schema.
- **Where (historical):** `seller-home.js` / `app.ts`; `IntakeCloudPricing` `start-prefetch`

## 2026-11-15 — Match “Opening Match…” forever while still awaiting boxes

- **Symptom:** Seller Match spun on Opening Match; CTM 404; poll never exited.
- **Cause:** `/boxes/:token/match` treated `cloud_awaiting_boxes` like `cloud_confirming`.
- **Rule:** Awaiting boxes → redirect to Board Box Editor. Opening Match only after Confirm (`cloud_confirming`). Heal `cloud_running` → awaiting when Cloud Run phase already has boxes. Confirming visits to `/boxes/:token` go to Match, not Thanks.
- **Where:** `intake-cloud/src/app.ts` Match + status + healStuckCloudJobs

## 2026-11-15 — Finish: Vision on full-res + HEIC moderated before convert

- **Symptom / risk:** After JPEG passthrough, finish still slow or dies: SafeSearch base64 of ~7MB boards. HEIC path moderated raw HEIC before convert.
- **Rule:** `ensureJpegBytes` first, then `moderateImage`. If payload >1.5MB, Cloud Run `/convert-to-jpeg` with `x-max-edge: 1280` for Vision only; store full-res JPEG as before.
- **Where:** `app.ts` / `progressive.ts` finish order; `moderation.ts`; Cloud Run 0.9.5

## 2026-11-15 — “Saving your photos…” stuck: Worker reencode OOMs large JPEGs

- **Symptom:** Waiting page stayed on “Saving your photos…”; D1 note `Finish stuck: 0/3 stored; 3 temp object(s) missing` while R2 temps still existed (~6–7MB JPEGs).
- **Cause:** After HEIC harden, failed `ensureJpegBytes` refused passthrough for *all* types. Full jsquash decode/encode of iPhone JPEGs OOMs/fails on the Worker; failures were miscounted as missing temps.
- **Rule:** Already-JPEG: store as-is (Cloud Run still EXIF-transposes + downscales). HEIC only: require Cloud Run convert. Do not count normalize failures as missing R2 objects.
- **Where:** `intake-cloud/src/cloud_price.ts` `ensureJpegBytes`; finish loop in `app.ts`

## 2026-11-14 — HEIC: Mac uses sips; cloud lab converts in browser + Cloud Run

- **Symptom:** iPhone HEIC uploads accepted by allowlist, then Worker `reencodeToJpeg` returned `heic_unsupported_on_worker` and used to passthrough raw HEIC (or fail detect).
- **Cause:** Production intake converts HEIC on the Mac with `sips` during handoff. Cloud lab never hits that path. Workers cannot decode HEIC.
- **Rule:** Convert HEIC→JPEG in `seller-home.js` before upload (createImageBitmap / canvas). Worker `ensureJpegBytes` falls back to Cloud Run `POST /convert-to-jpeg` (pillow-heif). Never store raw HEIC in `photos`. Already-JPEG must not go through full Worker reencode.
- **Where:** `intake-cloud/public/seller-home.js`; `cloud_price.ts` `ensureJpegBytes`; `IntakeCloudPricing` `/convert-to-jpeg` + `pillow-heif`

## 2026-11-14 — Anticipated: deferred eBay dies; Confirm waitUntil; stale CTM

- **Symptom (would hit next upload):** Match opens with few pins; remaining eBay never finishes; Confirm stuck if waitUntil dies before Cloud Run; CTM stays stale after background pricing; Match heal could skip BBE.
- **Cause:** Cloud Run request-only CPU kills `BackgroundTasks` after confirm returns. Worker had a manual `finish-remaining` but no auto kick. Confirm boards were not persisted. CTM HTML is a one-shot embed. Match heal flipped `cloud_awaiting_boxes` → done.
- **Rule:** Deploy Cloud Run with `--no-cpu-throttling` so Confirm’s BackgroundTask keeps CPU. Cron (`*/2`) retries Confirm from R2 `confirm_pending/{id}.json` and re-kicks `finish-remaining` only when still stuck (`match_ready`+deferred >90s, or hung `finishing_remaining`). CTM soft-reloads once when phase hits `done`. Heal Match status only from `cloud_confirming` (never skip BBE).
- **Where:** `intake-cloud` `app.ts` / `cloud_price.ts` / `wrangler.toml`; `IntakeCloudPricing/cloud_detect/deploy.sh` (0.9.3)

## 2026-11-14 — Confirm stuck on cloud_confirming after Match is ready

- **Symptom:** Seller Match page spun on “Opening Match…” while Cloud Run job was already `finishing_remaining` / harness 200. After open, pins still missing.
- **Cause:** (1) Confirm `waitUntil` dies before D1 → `cloud_done`. (2) Harness `<base href>` rewrite left the Cloud Run host in front of `/api/boxes/.../match-file/`, so crops/`ui_data` 401’d.
- **Rule:** Seller Match serves **CTM v2** `testing_ui_visual_baseline/new_ctm.html` (not Overlay `index.html`). Inject `<base href="/api/boxes/:token/match-file/testing_ui_visual_baseline/">` so **CTP v2** `new_ctp.html?filter=no_match` works after CTM done. Skip CTM queue pins with empty `thumb` while deferred eBay is still running. Staff admin harness can stay on Overlay.
- **Where:** `intake-cloud/src/app.ts` `GET /boxes/:token/match`; Cloud Run `POST /jobs/{id}/finish-remaining` to re-kick stuck deferred eBay

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

## 2026-11-16 — Admin harness total $402 vs Overlay $304

**Symptom:** Pull total from Firebase showed $402; Overlay badges summed to $304 on the same cloud job.

**Cause:** Cloud Run built the harness with `--firebase-local-only`. Overlay kept pipeline `ui_data` prices (item `$304`). CTM/CTP still wrote/read Firebase (PinDad matches, often shipping-inclusive / re-picked listings → `$402`). Admin pull always summed Firebase.

**Rule:** Cloud harness builds use `--firebase-collab` (Mac parity). Worker proxy also forces `firebase_collab` / `load_existing_from_firebase` on `ui_data.json` and embedded Overlay payloads so older jobs sync. Pull falls back to `global_total_value` only when Firebase has no priced pins; skips `not_a_pin` and orphan keys.

**Where:** `Cursor Projects/IntakeCloudPricing/cloud_detect/price_job.py`; `intake-cloud/src/cloud_price.ts`; `intake-cloud/src/app.ts` (`pullHarnessTotalFromFirebase`)

## 2026-11-17 — Cloud harness must use Mac firebase-collab

**Symptom:** Steve expected Overlay to show CTM/CTP Match prices like non-cloud; cloud Overlay kept pipeline badges.

**Cause:** Mac `price_boards_from_inbox.sh` passes `--harness-firebase-collab`. Cloud `_build_mac_harness` had been using `--firebase-local-only` (writes only). CTM/CTP still hydrated Firebase; Overlay did not.

**Rule:** Cloud builds always `--firebase-collab`. Assert `ui_data.firebase_collab` after build. Worker proxy still forces collab on served files for older jobs. On Re-detect, clear `overlay_url` + `harness_total_cents` so admin cannot show a stale total from the previous job.

**Where:** `IntakeCloudPricing/cloud_detect/price_job.py`; `intake-cloud` Worker proxy + `queueMacHandoff`

## 2026-11-17 — Cloud pricing crops use full camera boards

**Symptom:** Another agent noted lab boards were shrunk to 1600px long side; Whatnot/CTR need full-res crops.

**Cause:** Cloud Run detect path downscaled after fetching R2 photos (speed shortcut). Crops were cut from that 1600 image.

**Rule:** Cloud Detect keeps full-res EXIF-baked boards for crops (RF-DETR letterboxes to 560 itself). Worker still stores upload JPEG as-is. Re-detect after deploy to refresh crops.

**Where:** `IntakeCloudPricing/cloud_detect/main.py` (`_board_jpeg_for_crops`); not Worker upload path
