# Git checkpoints — RF‑DETR & import benchmarks

This file records **known-good documentation checkpoints** and how they pair with the **ClickToCollect** app repo on Desktop. **“Push what we have”** means **tag meaningful states**—not deleting the legacy detector path in source.

---

## ClickToClaim (this repository)

| Item | Purpose |
|------|---------|
| **`detection_eval/ON_DEVICE_IMPORT_BENCHMARKS.md`** | Wall-clock import comparisons (old vs new builds), **pins/s**, run protocol, and perf UX notes. |
| **Tag `docs-import-benchmarks-2026-05-06`** | Anchors the benchmark tables + this checkpoint doc. |
| **`336cfa2` area (`main`)** | Docs checkpoint: unified show pipeline agreements + pricing/visual-search context; PinVlm **Labs-only / v1** scope lives in root **`FUTURE.md`** (related earlier anchor: **`d62ad96`** area). |
| **ClickToCollect security checklist (`main`, 2026-05-16)** | **`FUTURE.md`** → *ClickToCollect — security (v1 vs App Store)*; pairs with app **`9767e28`** (Phase 1 **`e63baf1`**); full day anchor **`0bb892c`**. |

This repo does **not** contain the iOS binary or Core ML package; use the app repo tag below for code rollback.

---

## ClickToCollect app (`~/Desktop/ClickToCollectApp`)

| Item | Purpose |
|------|---------|
| **Default detector** | **RF‑DETR** — `RfDetrPinDetector.mlpackage`, `RfDetrPinDetectorEngine`, `CoreMLDetectionService`. |
| **Legacy path (keep)** | Optional Ultralytics / Vision flow behind **`INCLUDE_LEGACY_ULTRAYOLO_PIN_DETECTOR`** and **`AppFeatureFlags.pinDetectorBackendResolved`** — see `AppFeatureFlags.swift` and `SETUP.md`. **Do not remove** until the team explicitly drops support. |
| **Tag `rf-detr-baseline-2026-05-06`** | Checkpoint: RF‑DETR integration, Collection perf UX batch, Core ML concurrency fixes, bundled model on the order of **~50 MB** in the tree (expect larger **.ipa** than the legacy-only era). |
| **`7290237` (`main`, 2026-05-15)** | Doc sync anchor: **`CURRENT_PROJECT_VERSION` → 6**; recent UX batch (PinVlm removed from Labs + model dropped, Collection/Cleanup/Add copy, OR filters, Overlap progress, SearchView filters, delete copy). Pair with **`FUTURE.md`** *Session log — 2026-05-15*. |
| **`0bb892c` (`main`, 2026-05-16)** | Doc sync anchor: **`CURRENT_PROJECT_VERSION` → 7**; batch since **`7290237`**: View on Board, Collection filter UX, **`CleanupScanProgressOverlay`**, Home Screen/Spotlight shortcuts, security Phases 1–2, archived ML models, Swift 6 **`CoreMLDetectionService`**. Pair with **`FUTURE.md`** *Session log — 2026-05-16*. |
| **Perf implementation plan** | See `~/Desktop/ClickToCollectApp/PERF_RECOMMENDATIONS.md` (phased perf plan for <1k typical, ~10k heavier; deprioritizes 100k+ for now). |

### Rollback / comparison (app repo)

```bash
cd ~/Desktop/ClickToCollectApp
git fetch --tags
git tag -l '*rf-detr*' '*2026-05*'
git show rf-detr-baseline-2026-05-06 --stat
```

- **Inspect old behavior:** `git checkout rf-detr-baseline-2026-05-06` (detached) or create a branch from that tag.
- **Shared branches:** prefer **`git revert <commit>`** over rewriting history.

### Bundle size

The RF‑DETR **`.mlpackage`** dominates app size versus a small legacy detector. When only one backend ships to users, remove **unused** models from the Xcode target and bundle resources to avoid paying for both.

---

## Session notes — PreparingInventory automated pricing (2026-05-07)

These notes cover **Mac-side automated pricing** (PreparingInventory + PinPricingStudyMVP), not the iOS app.

### What we tested

- **Goal**: For pricing the **show boards** (last step), prefer **Lexi’s already-decided price** (from previously priced collections) as **rank 1** in ClickToPrice, while still running **eBay Browse** to populate ranks 2+.
- **Approach (prototype)**: Add an **optional** “local visual library” to `PinPricingStudyMVP/run_visual_baseline_pipeline.py`:
  - Index recent `PreparingInventory/PriceCollection_*` pins by reading `testing_ui_visual_baseline/ui_data.json` + `crops/`.
  - For each new crop, compute **pHash** and pick the nearest neighbor within a threshold.
  - If found, inject a synthetic **FIXED** candidate at **rank 1** (source `pin_tooling.local_visual_library`); eBay FIXED comps follow unchanged; `ebay_full_pool_candidates` remains the raw eBay pool.

### What we ran / learned

- **Pipeline trigger sanity**: Watcher waits for **120s quiet**, then runs; successful runs end with **`Done. Push complete.`** and **`lock released (exit 0)`**.
- **RF‑DETR detection (Core ML) still works** in the watcher path by default (see PreparingInventory `board_inbox_watcher.sh`): it prefers `PinPricingStudyMVP_RFDETR_TEST` when `PIN_PRICING_USE_RFDETR` is unset / truthy, and falls back to Roboflow when `PIN_PRICING_USE_RFDETR=0`.
- **Manual RF‑DETR harness test** (no commits): created `PriceCollection_20260507_2223` from three boards; confirmed `testing_ui_visual_baseline/index.html` exists and the harness URL was logged.
- **Local visual library**: manual run excluding the source collection showed **some** cross-collection matches are possible in principle, but it’s not yet production-wired and needs thresholding + review UX to be trusted.

---

## Session notes — Firebase paths & pricing authority (2026-05-08)

### What we clarified (code-backed)

- **Pricing collection / `build_testing_ui` harness** writes to **`pin_pricing_tests/<test_run_id>/<approach_id>/pins/…`** (often `visual_baseline`). The **`test_run_id`** is in that run’s **`ui_data.json`**. This matches **PreparingInventory `PriceCollection_*`** harness folders users open for ClickToPrice-style review.
- **Study labeling** (`run_study.py` bundle, top-level run `index.html`) uses a **different** root: **`pin_pricing_study/<run_id>/labels/…`**. Do not assume one export covers both.

### What we learned

- **Authority for Lexi’s final prices:** Treat **Firebase `pin_pricing_tests`** as the collaboration source of truth for harness state; **local** collection JSON is not a substitute for “what Lexi finally chose” when building indexes or rank‑1 injection.
- **Safe read-only access:** Use a **separate Firebase Auth account** + **narrow `.read` rules** for export scripts; **Admin SDK is not rules-enforced** for reads/writes the same way client SDK is — design exports accordingly.
- **Automation:** Any “our price first” / library feature should **fail open** to the existing eBay path if export or indexing fails.

