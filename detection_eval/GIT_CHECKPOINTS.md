# Git checkpoints — RF‑DETR & import benchmarks

This file records **known-good documentation checkpoints** and how they pair with the **ClickToCollect** app repo on Desktop. **“Push what we have”** means **tag meaningful states**—not deleting the legacy detector path in source.

---

## ClickToClaim (this repository)

| Item | Purpose |
|------|---------|
| **`detection_eval/ON_DEVICE_IMPORT_BENCHMARKS.md`** | Wall-clock import comparisons (old vs new builds), **pins/s**, run protocol, and perf UX notes. |
| **Tag `docs-import-benchmarks-2026-05-06`** | Anchors the benchmark tables + this checkpoint doc. |

This repo does **not** contain the iOS binary or Core ML package; use the app repo tag below for code rollback.

---

## ClickToCollect app (`~/Desktop/ClickToCollectApp`)

| Item | Purpose |
|------|---------|
| **Default detector** | **RF‑DETR** — `RfDetrPinDetector.mlpackage`, `RfDetrPinDetectorEngine`, `CoreMLDetectionService`. |
| **Legacy path (keep)** | Optional Ultralytics / Vision flow behind **`INCLUDE_LEGACY_ULTRAYOLO_PIN_DETECTOR`** and **`AppFeatureFlags.pinDetectorBackendResolved`** — see `AppFeatureFlags.swift` and `SETUP.md`. **Do not remove** until the team explicitly drops support. |
| **Tag `rf-detr-baseline-2026-05-06`** | Checkpoint: RF‑DETR integration, Collection perf UX batch, Core ML concurrency fixes, bundled model on the order of **~50 MB** in the tree (expect larger **.ipa** than the legacy-only era). |

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
