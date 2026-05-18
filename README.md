# ClickToClaim (Click To Request)

This repo ships **Click To Request** show bundles for **GitHub Pages**: each dated folder has `index.html`, `boards/` (photos + JSON), icons, and harness scripts wired to Firebase.

## Pages

| Page | URL |
|------|-----|
| **Show index** (tracked bundles only; order = last commit per folder) | [finsandpins.github.io/ClickToClaim/](https://finsandpins.github.io/ClickToClaim/) |
| **Pricing collections (Lexi)** — separate repo | [finsandpins.github.io/PreparingInventory/](https://finsandpins.github.io/PreparingInventory/) |

The root index loads `shows_index.json` (regenerate with `python3 update_shows_index.py`).

## Show folders on GitHub (size policy)

Only the **newest four** full show bundles stay on `main` so the published site stays within GitHub Pages limits (large trees previously caused **“Page build failed”** and 404s for new shows). Older bundles remain **on your disk**; their paths are in `.gitignore` so they are not re-committed. When you rotate in a new show, remove the oldest bundle from tracking, add it to the ignore list, run `update_shows_index.py`, and push.

Details: **`project_context_cursor.md`** → **ClickToClaim — GitHub Pages and show retention**.

## Documentation

| File | Purpose |
|------|---------|
| **`project_context_cursor.md`** | Architecture, iCloud vs GitHub, pipelines, Firebase notes |
| **`FUTURE.md`** | Planned features, **session logs** (e.g. `20260504` Post Show overlay, `20260507` manifest / cache-bust notes) |
| **`docs/SHOW_20260518_RUNBOOK.md`** | Show-night operating flow, batch review default, zero-price policy, safeguards, artifact paths |
| **`docs/UNIFIED_SHOW_PIPELINE_AGREEMENTS.md`** | Cross-show agreements and validated 20260518 alignment decisions |
