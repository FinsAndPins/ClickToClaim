# Board Box Editor — 20260810

Manual pin-box cleanup for the Aug 10, 2026 show boards.

## Use (iPhone / iPad / Mac)

After GitHub Pages updates:

**https://finsandpins.github.io/ClickToClaim/BoardBoxEditor/20260810/**

1. Pick a board.
2. Tap a bright green box → drag to move; drag corner squares to resize.
3. **Add** / **Delete** as needed. **Undo** reverses the last edit.
4. **Save** → writes to Firebase (`boardBoxEditor/20260810/…`) so all devices stay in sync, and renumbers `crop_stem` in reading order (`img####_pin01`…).
5. **Download JSON** → local backup of the current board.
6. **Reload file** → discard Firebase edits for this board and reload the committed detect JSON.

## Detect baseline

RF-DETR (production CTR settings: EXIF + max 1280 + two-pass IoU dedupe) was run from:

`Cursor Projects/BoardBoxEditor_20260810/run_detect.sh`

Output lives in `./boards/` (`IMG_####.JPG` + `.json` + `manifest.json`).

## After boxes look good

Tell the agent to:

1. Pull Firebase edits into `boards/*.json` (or use downloaded JSONs).
2. Clone `20260806` → `ClickToClaim/20260810` using these boards.
3. Run pricing from the edited CTR boards (`crop_boards_from_ctr_json` / watcher path).
4. Apply **25% off** display (list struck through; sale price in totals) like `20260720`’s 20% off.

## Backup / QR-card cleanup

Pre-cleanup JSON snapshot (restore if needed):

`boards_backup_pre_qr_card_cleanup/`

Auto pass `qr_card_outer_drop_v1`: dropped outer boxes only when a smaller pin box was nested inside **and** OpenCV detected a QR on that outer crop (white Fins & Pins backing cards). Report: `qr_card_cleanup_report.json`.

Cards where RF-DETR never found a separate pin-only box are unchanged — shrink those by hand in the editor.
