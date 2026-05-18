# Unified Show Pipeline Agreements

Last updated: 2026-05-18

Discussion notes only. Implementation is deferred until we explicitly decide to build.

## Agreed (so far)

- Non-destructive implementation policy when build work starts: add new files/folders first; avoid risky in-place churn.
- Show id format stays `YYYYMMDD`.
- Unified flow: RF-DETR output to per-image JSON, then crops named `img####-pin##.jpg`, then Lexi pricing harness runs on those same crops.
- Use one detector inventory only (no second pricing-only detector run).
- Order nuance should stay aligned with the existing FUTURE/playbook framing.
- Add/keep a Whatnot CSV button in the harness.
- Add/keep an admin CTR price overlay button.
- Support multi-board shows (30-50+ boards and beyond).
- Reports/admin CTR behavior stays conceptually as it works now.
- Pricing harness remains private.
- Public CTR should remain no-price for now (possible future public price mode later).
- Stability priority: CTR should keep working even when pricing-side steps fail.
- Traceability should use `pin_uid` plus manifest linkage; no formal audit system required right now.
- MacBook remains the orchestration machine for this workflow.
- Cursor Projects artifacts referenced in this discussion:
  - `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/Whatnot show 20260511/whatnot_upload_20260511.csv`
  - `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/Whatnot show 20260511/WHATNOT_CTR_PLAYBOOK.md`
  - `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/Whatnot show 20260511/ALIGNMENT_NOTES.md`
- Firebase authority notes remain in-repo: see `FUTURE.md` and `project_context_cursor.md`.

## Considerations: images, GitHub, and GitHub Pages

Lessons from **PreparingInventory** + Pages deploys apply directly when we wire **ClickToRequest** and **pricing** into one pipeline.

- See also: `docs/PREPARING_INVENTORY_GITHUB_ARCHIVE.md` for the 2026-05-16 archive/cleanup session notes and commit trail.

- **Board and crop images are still required for the product.** Nothing about “slim repos” removes the need for image bytes. The browser must resolve **every URL** the harness or CTR requests (HTML/JS, JSON, `img src`, listing thumbs, etc.). If a UI links to `../crops/…` or `raw.githubusercontent.com/…/crops/…`, those paths must exist wherever that URL points.
- **Separate three concerns:** (1) what lives in **git** on `main`, (2) what **GitHub Pages** puts in the **`_site` artifact** (often a small subtree so deploy stays under size limits), (3) optional **archive** copies on disk or in another store (S3, second repo, iCloud-only) for history. Moving “full-resolution / historical” trees out of the primary repo only works if **links and exports** (e.g. Whatnot CSV image URLs) are updated to something stable—or if the live UI continues to use **`raw.githubusercontent.com`** and those blobs remain on `main` at those paths.
- **Do not publish entire `PriceCollection_*` roots via Pages.** Scope the workflow to what the hosted UI needs (e.g. `testing_ui_visual_baseline` **plus** any sibling folders that relative links require, such as `crops/` or `board_photos/`, if the HTML does not use raw GitHub URLs). Oversized artifacts cause failed or flaky deploys.
- **Avoid hardcoding a single `PriceCollection_YYYYMMDD_HHMM` path** in the Pages workflow. Prefer **discovery** (enumerate collections and paths that exist) or a **generated manifest** of deploy paths so new show folders do not require a manual workflow edit.
- **Guardrails:** fail the Pages job with a clear message if **`_site`** exceeds a chosen size ceiling (e.g. on the order of hundreds of MB), so regressions are caught before upload.
- **After each deploy:** smoke-check the real Pages URL (or `curl -I`) for the current show path so 404s are caught before show time.
- **Retention vs git size:** deleting or moving old folders from the working tree later does not shrink **historical git objects** until history is rewritten (usually avoided). Real savings come from **not committing huge binaries** in the first place, using **LFS** only where versioning binaries is worth the cost, or hosting images outside git.
- **Stable URLs for downstream tools:** Whatnot CSV and public links should prefer **durable URLs** you control, not only deep `PriceCollection_*` paths that churn when you reorganize.
- **Local clone hygiene:** large unrelated `git status` noise (e.g. iCloud sync) risks accidental commits; periodic `git status` / `git restore` when appropriate reduces that risk.

## Open / to discuss

- Confirm global uniqueness strategy for `img####` across all boards in a show.
- Decide exact unified Firebase strategy: new subtree in an existing project vs a new project, while leaving the two legacy DBs untouched.
- Reconcile "script read-only Firebase" guidance with harness behavior where Lexi writes state.
- Tighten security posture from current public read/write defaults.
- Confirm whether the Whatnot importer changed and what must stay compatible.
- Optional future decisions:
  - Public price visibility flag in CTR.
  - CI steps that touch Firebase.

## Explicit non-goals for now

- Lexi re-running detection/re-crops to stabilize ids is out of scope for this phase.

## Validated by Show 20260518 (interim two-script path)

- Same RF-DETR inventory proved workable for both CTR detection output and pricing inputs, avoiding Roboflow-vs-RF-DETR inventory mismatch.
- Original camera filenames can stay intact in one flat input folder; manifest filename ascending order is a practical shoot-order source.
- ID bridge pattern validated: CTR pin keys use `{boardStem}-{0-basedIndex}`, crop stems use `img{digits}_pinNN`, and `pin_uid_map.json` bridges CTR, Whatnot, and export joins.
- Interim publish shape works with minimal surface change: duplicate show folder `YYYYMMDD` in ClickToClaim, write `boards/` only, and keep Firebase show id equal to the folder name.
- Manual show pricing path is cleaner when staged in manifest order and run directly, without BoardsToPrice watcher/iMessage automation.
- Separate Firebase databases are acceptable for this interim; a later unified script can namespace under one project when we collapse paths.
- Carried forward to a future single script: one detector inventory, filename-preserving flat ingest, manifest-ordered sequencing, and explicit pin uid bridging.
- Intentionally deferred in this interim: optional `BOARDS_MANIFEST_VERSION` bump policy and final git push/deploy choreography.

See also (Cursor Projects): [Show20260518 README](file:///Users/steve/Library/Mobile%20Documents/com~apple~CloudDocs/Cursor%20Projects/Show20260518/README_SHOW_20260518.md)

## Show 20260518 interim operating agreement (current reality)

- **Interim two-script flow:** run `detect_boards_rfdetr_for_ctr.py` to generate `ClickToClaim/20260518/boards/*.JPG + *.json + manifest.json`, deploy CTR from that folder, then run pricing from those same board artifacts without re-detecting.
- **Pricing source of truth:** crop from existing CTR board JSON/JPG (`crop_boards_from_ctr_json.py`) so pricing uses the exact same click-space and pin ordering as CTR.
- **Single detection source rule:** for show night, both CTR and pricing consume only `20260518/boards` outputs. Do **not** price directly from `ClickToRequest` originals and do **not** run a second RF-DETR pass for pricing.
- **Porting parity requirement:** when moving `ClickToClaim.py` behavior to RF-DETR scripts, preserve EXIF transpose + baked `1280` max-dimension preprocessing. Board 3 (`IMG_4680`) proved parity gaps break click alignment.
- **Expectation rule:** when asked to "only change X", the implementation still must carry over all legacy preprocessing fixes needed to preserve behavior (orientation, sizing, coordinate frame, and ordering).
- **Recorded commits:** `3825e9a` (add CTR show `20260518` boards), `a751dd3` (refresh/fix boards and bump `BOARDS_MANIFEST_VERSION` to `8` parity in `index.html` + `reports.html`). Pricing collection commit/tag is still TBD in this repo because pricing artifacts live in `PreparingInventory`.

See also (Cursor Projects): [Show20260518 README](file:///Users/steve/Library/Mobile%20Documents/com~apple~CloudDocs/Cursor%20Projects/Show20260518/README_SHOW_20260518.md)

## Show 20260518 additions (operationally validated)

- **Flow confirmation:** one RF-DETR detect -> CTR boards -> crop-from-CTR-JSON pricing -> Whatnot CSV build; no second detect pass.
- **ID bridge clarification:** `pin_key` uses `{boardStem}-{k}` (0-based) while crop names use `_pinNN` (1-based). `pin_n = k + 1` is expected behavior, not a mis-join.
- **Whatnot CSV policy:** include all clicked pins by default, keep `lexi_raw_price` + `lexi_raw_price_zero`, and flag explicit Lexi `0` rows for manual correction. Keep optional `--exclude-zero-price` for special runs only.
- **No automatic floor override for flagged zeros:** explicit Lexi `0` rows should not be auto-interpreted as `$10` for final pricing decisions; operator applies real final prices during manual review.
- **Batch review format:** use `pin_match_review_batch_template.html` + `embed_review_batch.py` to produce a standalone embedded HTML (Safari `file://` safe), with left CTR bbox crop vs right Lexi crop in continuous scroll.
- **Template requirement:** single-document HTML with `const REVIEW_ROWS = /*__REVIEW_ROWS__*/;` plus embed validation script.
- **Outcome:** side-by-side batch review validated all `230` matches quickly and is now preferred for future shows.

See also:
- `docs/SHOW_20260518_RUNBOOK.md`
- [Show20260518 README](file:///Users/steve/Library/Mobile%20Documents/com~apple~CloudDocs/Cursor%20Projects/Show20260518/README.md)
- [Show 20260518 lessons](file:///Users/steve/Library/Mobile%20Documents/com~apple~CloudDocs/Cursor%20Projects/Show20260518/SHOW_20260518_LESSONS.md)

## Higher resolution crops (future reference)

- CTR currently serves baked `1280` board JPGs, and click indices must remain stable; therefore show-night pricing should crop from the same CTR JSON/JPG pair.
- Using higher-resolution crops from `ClickToRequest` originals would require either (a) scaling box coordinates from `1280` space to full-res source pixels, or (b) full-res detect for both CTR and pricing (heavier processing and larger hosted assets).
- eBay visual matching usually gains only modestly beyond roughly `512-1280` for thumbnail-scale search; pin/crop alignment and index correctness are more important for live show operations.
- Optional enhancement path: keep detect at `1280` for CTR JSON, then crop from full-res originals using tested coordinate scaling. Treat this as a separate, test-gated improvement.
