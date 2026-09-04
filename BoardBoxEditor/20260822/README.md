# Board Box Editor — 20260822

Manual pin-box cleanup for the Aug 22, 2026 Click To Request boards.

## Use (iPhone / iPad / Mac)

After GitHub Pages updates:

**https://finsandpins.github.io/ClickToClaim/BoardBoxEditor/20260822/**

Or open from **20260822 → Reports** (admin) → **Board box editor**.

1. Pick a board.
2. Tap a bright green box → drag to move; drag corner squares to resize.
3. **Add** / **Delete** as needed. **Undo** reverses the last edit.
4. **Save** → writes to Firebase (`boardBoxEditor/20260822/…`) so all devices stay in sync, and renumbers `crop_stem` in reading order (`img####_pin01`…).
5. **Download JSON** → local backup of the current board.
6. **Reload file** → discard Firebase edits for this board and reload the committed detect JSON.

## Boards baseline

Copied from live CTR `20260822/boards` (RF-DETR detect from ClickToRequest).

## After boxes look good

Tell the agent to pull Firebase edits (or downloaded JSONs) back into `ClickToClaim/20260822/boards` and bump `BOARDS_MANIFEST_VERSION` so the live CTR picks them up.
