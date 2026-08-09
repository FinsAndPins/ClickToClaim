# Board Box Editor

Reusable multi-device pin-box editor for show prep (first shipped for **20260810**).

## Live URL

`https://finsandpins.github.io/ClickToClaim/BoardBoxEditor/YYYYMMDD/`

## Layout

| Piece | Where |
|---|---|
| Editor + boards (GitHub Pages) | `BoardBoxEditor/YYYYMMDD/` in this repo |
| Detect / QR-card cleanup scripts | iCloud `Cursor Projects/BoardBoxEditor_YYYYMMDD/` |
| Source photos | iCloud `Cursor Projects/YYYYMMDD/` |
| Live edits | Firebase `boardBoxEditor/{YYYYMMDD}/{stem}` (+ browser `localStorage` backup) |

## Workflow

1. Run CTR-style RF-DETR detect (EXIF + 1280 + IoU dedupe) into `boards/`.
2. Optional: `drop_qr_card_outers.py` — drop outer white QR-card boxes when a pin nest exists; backup JSON first.
3. Edit in the web UI (bright boxes, resize handles, Add/Delete/Undo). **Save** syncs devices and renumbers `crop_stem`.
4. When boxes are good: export into CTR `YYYYMMDD/boards`, clone a template show, price from those boards.

## Editor must-haves

- Unsaved leave dialog: **Save** / **Don’t Save** / **Cancel**
- iOS scroll: pan on the board canvas; `touch-action: none` only on boxes/handles
- Tie-out: edit **before** crops/claims so click index ↔ `crop_stem` ↔ price stay aligned
