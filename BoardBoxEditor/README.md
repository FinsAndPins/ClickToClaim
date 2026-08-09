# Board Box Editor

Optional, on-demand pin-box editor (first used for **20260810**).

**Not part of standard show prep.** Do **not** wire into PrepareClickToClaim, the pricing watcher, inbox scripts, or other default CTR/pricing flows. Keep it available when we want a manual cleanup pass.

## Future product note

Strong candidate to embed in the website when customers can upload their own board photos for collection quotes — so they (or we) can fix boxes before crops hit pricing.

## Live URL (when a show folder exists)

`https://finsandpins.github.io/ClickToClaim/BoardBoxEditor/YYYYMMDD/`

## Layout

| Piece | Where |
|---|---|
| Editor + boards (GitHub Pages) | `BoardBoxEditor/YYYYMMDD/` in this repo |
| Detect / optional cleanup scripts | iCloud `Cursor Projects/BoardBoxEditor_YYYYMMDD/` |
| Source photos | iCloud `Cursor Projects/YYYYMMDD/` |
| Live edits | Firebase `boardBoxEditor/{YYYYMMDD}/{stem}` (+ browser `localStorage` backup) |

## Optional workflow (manual only)

1. Run CTR-style RF-DETR detect (EXIF + 1280 + IoU dedupe) into `boards/` — copy of detect script, not production hooks.
2. Edit in the web UI (bright boxes, resize handles, Add/Delete/Undo). **Save** syncs devices and renumbers `crop_stem`.
3. If using for a show: export into CTR `YYYYMMDD/boards`, then price from those boards.

## Editor must-haves

- Unsaved leave dialog: **Save** / **Don’t Save** / **Cancel**
- iOS scroll: pan on the board canvas; `touch-action: none` only on boxes/handles
- Tie-out: edit **before** crops/claims so click index ↔ `crop_stem` ↔ price stay aligned
