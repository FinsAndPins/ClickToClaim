# Board Box Editor

Pin-box editor shipped with each CTR show from PrepareClickToClaim / the ClickToRequest watcher (template **20260822+**).

## Live URL

`https://finsandpins.github.io/ClickToClaim/BoardBoxEditor/YYYYMMDD/`

Or open from **YYYYMMDD → Reports** (admin) → **Board box editor**.

## Layout

| Piece | Path |
|---|---|
| Editor + boards (GitHub Pages) | `BoardBoxEditor/YYYYMMDD/` in this repo |
| Firebase edits | `boardBoxEditor/{YYYYMMDD}/{stem}` (+ browser `localStorage` backup) |

Prepare copies the editor UI and that show’s `boards/` into `BoardBoxEditor/<show>/` after RF-DETR detect. Reports links use the show slug so the editor always opens the matching boards.

## Workflow

1. Edit in the web UI (bright boxes, resize handles, Add/Delete/Undo). **Save** → Firebase + renumber `crop_stem`.
2. Ask an agent to **sync** Firebase → `ClickToClaim/YYYYMMDD/boards` and bump `BOARDS_MANIFEST_VERSION` so the live CTR picks up the boxes.
3. Price / claim from the synced CTR boards.

## Editor UX to preserve

Bright boxes, corner handles, Add/Delete/Undo, Save/Don’t Save/Cancel on leave, iOS pan-y scroll (`touch-action: none` only on boxes/handles). SHOW_SLUG is derived from the URL path (`BoardBoxEditor/<show>/`).

## Future product note

Candidate UX for a later website feature: customers upload board photos for collection quotes → fix/confirm boxes → then run pricing on cleaner crops. Do not build that product wiring unless explicitly requested.
