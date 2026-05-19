# Show 20260518 Runbook

Last updated: 2026-05-18

This runbook documents what was actually done for show `20260518`, what failed, and what was fixed.

## Goal

- Keep CTR click targets and pricing crops aligned by using one detection source and one coordinate space.
- Publish CTR from `ClickToClaim/20260518/boards`.
- Run pricing using those same board outputs, not a second detector pass.

## Scripts used (Cursor Projects / Show20260518)

- `detect_boards_rfdetr_for_ctr.py`
  - Input: `ClickToRequest` board photos (flat folder, original filenames like `IMG_*.JPG`).
  - Output: `ClickToClaim/20260518/boards/{stem}.JPG`, `{stem}.json`, and `manifest.json`.
  - Key behavior: EXIF transpose + baked 1280 max dimension before RF-DETR and before writing CTR JPGs.
- `crop_boards_from_ctr_json.py`
  - Crops pricing inputs from existing CTR board JSON/JPG without re-detecting.
  - Produces deterministic crop names and `pin_uid_map.json` bridge.
- `price_show_boards_rfdetr.sh`
  - Legacy/deprecated for show-night alignment because it re-detects from staged board images.
  - Keep only as fallback tooling, not the preferred show flow.
- `RunPriceShow20260518.command`
  - Finder launcher for the legacy pricing shell script above.

Note: `price_show_from_ctr_crops.sh` is not present in this folder as of this update.

## Step-by-step (what was done)

1. Place board photos in `ClickToRequest` with original camera names intact.
2. Run `detect_boards_rfdetr_for_ctr.py`.
3. Verify `ClickToClaim/20260518/boards` contains matching `.JPG`, `.json`, and `manifest.json`.
4. Commit/push CTR show folder:
   - `3825e9a` added show `20260518` boards.
5. Fix parity/caching issue and republish:
   - `a751dd3` refreshed board outputs and aligned `BOARDS_MANIFEST_VERSION` to `8`.
6. Pricing path for aligned runs:
   - Crop from CTR board JSON/JPG (`crop_boards_from_ctr_json.py`), then run pricing on those crops.
   - Do not run a second RF-DETR pass for pricing if CTR alignment is the priority.

## Default show flow (current operating format)

1. Generate CTR board outputs in `ClickToClaim/20260518/boards` (single detection source).
2. Build Whatnot artifacts from that same inventory (`build_whatnot_20260518.py`).
3. Review in **batch format** (JSON payload + embedded batch HTML), then apply manual fixes.
4. Export/share final CSV only after zero-price rows are explicitly reviewed.

Batch review is the default format because it keeps board crop, board bbox, labels, and price context in one place for fast scroll-through validation.

## What went wrong and fixes

- **Issue: coordinate mismatch on Board 3 (`IMG_4680`).**
  - Cause: preprocessing parity drift from original ClickToClaim behavior.
  - Fix: enforce EXIF transpose + baked 1280 JPEG preprocessing in detect flow before prediction/export.
- **Issue: stale board asset loading after board fixes.**
  - Cause: manifest/image cache bust version mismatch risk.
  - Fix: bump and align `BOARDS_MANIFEST_VERSION` in both `index.html` and `reports.html` (set to `8` in `a751dd3`).
- **Issue: pricing flow risked diverging from CTR clicks.**
  - Cause: re-detect path (`price_show_boards_rfdetr.sh`) can create a second coordinate source.
  - Fix: set show-night rule to crop from CTR JSON/JPG for pricing.

## Lessons learned / agreements

- "Only change X" still means preserve all legacy preprocessing fixes required for behavior parity.
- One detector output source per show is safer than multiple independent detection passes.
- For live operations, click-index alignment matters more than squeezing maximum crop megapixels.
- **Whatnot CSV policy:** include explicit Lexi zero-price rows by default, flag them with `lexi_raw_price_zero=Y`, then apply manual sheet-side price fixes before final publish.
- **Final zero-row pricing (this show):** six explicit Lexi `0` rows were manually corrected to `20`, `350`, `60`, `300`, `250`, and `125`.
- **Pin mapping rule:** `pin_key` is 0-based (`IMG_####-k`), while crop labels/titles are human-facing 1-based (`pin_n = k + 1`); keep this translation explicit in all exports.
- **Review format rule:** batch review JSON + embedded HTML is the primary operator workflow for this show and future parity runs.

## May 18 additions: delta top-up workflow (validated)

- Purpose: generate a **delta Whatnot CSV** containing only newly requested pins between two exports (mid-show or end-of-show top-up).
- Script path: `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/Show20260518/build_whatnot_delta_20260518.py`.
- Builder flags added in `build_whatnot_20260518.py` for repeatability:
  - `--click-json-path`
  - `--only-pin-keys-file`
  - `--delta-from-export`
  - `--out-csv-basename`
  - (plus related delta/output controls)
- Today's validated counts:
  - latest export rows: `279`
  - prior export rows: `230`
  - computed new pins: `49`
  - output CSV: `whatnot_upload_20260518_delta.csv`
- Operator rule: run this as the default top-up method instead of re-uploading the full set.

## May 18 additions: Lexi pricing harness with CTR clicks overlay

- Default pricing review page for this show now includes CTR click visibility:
  - `PriceCollection_*/testing_ui_visual_baseline_with_ctr_clicks/index.html`
- Live validated URL:
  - `https://finsandpins.github.io/PreparingInventory/PriceCollection_20260517_1514/testing_ui_visual_baseline_with_ctr_clicks/index.html`
- Non-negotiable implementation constraint:
  - keep an exact copy of `testing_ui_visual_baseline/` behavior (totals, rounding checkbox, controls, pricing state)
  - layer only CTR-click UX on top
- Overlay additions only:
  - green `.clicked` highlight on selected pins
  - count badge when click count > 1 (matching ClickToRequest admin pattern)
- Inputs:
  - `ctr_claims_<show>.json`
  - optional fallback `../pin_uid_map.json`
- Labeling requirement: board prefix in-row, e.g. `Board 19 · img4696_pin27`.
- Pages compatibility note: existing workflow already discovers `testing_ui_visual_baseline*` paths.

## Critical gotchas from May 18

- **Never modify live CTR show assets while working pricing harnesses.**
  - We accidentally changed ClickToClaim board labels in `2c2f245` and had to revert in `203c50d`.
  - Hard rule: path-limit all commits and stage only target files.
- **When asked for "identical X + Y", clone X first, then add Y.**
  - Re-implementing from scratch caused missing totals/rounding/data-path behavior.
- **GitHub Pages parent-relative fetch can 404 unexpectedly.**
  - `../pin_uid_map.json` may fail even if present in repo; optional fetches must be tolerant (`try/catch` + fallback data).
- **Dirty repo safety: never use broad staging in PreparingInventory-scale trees.**
  - Use `git add <explicit path>` only; never `git add .` or `git add -A`; verify with `git status` before commit.
- **Verify target file path before editing.**
  - Confirm the file being changed is the exact page the user is viewing (PreparingInventory vs ClickToClaim split).

## Embed script safeguards (batch HTML generation)

`embed_review_batch.py` now enforces:

- Template contains exactly one `/*__REVIEW_ROWS__*/` placeholder.
- Template contains exactly one `<!doctype html>`.
- Review JSON has a top-level `rows` array.
- Embedded `const REVIEW_ROWS = [...]` is present and parses as valid JSON.
- Placeholder is fully consumed (no unresolved token left in output).

These checks are intentional guardrails so bad template edits fail fast instead of silently shipping broken review pages.

## Artifact paths (show 20260518)

- CTR boards (source of truth): `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/GitHub Repository/ClickToClaim/20260518/boards`
- Pricing collection artifacts: `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/GitHub PreparingInventory/PreparingInventory/PriceCollection_20260517_1514`
- Whatnot review payload: `PriceCollection_20260517_1514/whatnot_upload_20260518_review_data_v4.json` (or `_v2+` suffix from unique-path writes)
- Embedded batch review HTML (validated working file): `Show20260518/pin_match_review_20260518_batch_v4_fixed.html`
- Warnings / zero exclusions:
  - `PriceCollection_20260517_1514/whatnot_upload_20260518_warnings_v4.txt`
  - `PriceCollection_20260517_1514/whatnot_upload_20260518_excluded_zero_price_v4.csv`
- Final CSV lineage example:
  - `whatnot_upload_20260518_v4.csv` (builder output with flags)
  - `whatnot_upload_20260518_final.csv` (manual fixed publish file)
- Delta top-up lineage:
  - `whatnot_upload_20260518_delta.csv` (new pins only between exports)

## See also

- [Show20260518 README](file:///Users/steve/Library/Mobile%20Documents/com~apple~CloudDocs/Cursor%20Projects/Show20260518/README.md)
- [Show 20260518 lessons](file:///Users/steve/Library/Mobile%20Documents/com~apple~CloudDocs/Cursor%20Projects/Show20260518/SHOW_20260518_LESSONS.md)
- `docs/UNIFIED_SHOW_PIPELINE_AGREEMENTS.md`
- `docs/SHOW_AUTOMATION_PLAN.md`
- `LESSONS_20260518_ZERO_ROW_FIXES.md` (in `Show20260518`)

## Future split (explicit)

- **Track A: show-night aligned pricing (default).**
  - Crop from CTR JSON/JPG and keep one coordinate source.
- **Track B: automatic BoardsToPrice-style pricing (separate path).**
  - Keep as a separate automation track and do not mix with show-night alignment assumptions.
- **Optional enhancement: higher-res crop path.**
  - Detect at 1280 for CTR JSON, then crop full-res originals via tested coordinate scaling.
  - Requires explicit validation before adopting in show-night flow.
