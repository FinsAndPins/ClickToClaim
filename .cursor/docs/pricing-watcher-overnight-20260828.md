# Pricing watcher — overnight incident (2026-08-28) and hardening plan

Status: **document only**. Steve chose to leave the watcher alone for now. Do **not** implement the hardening items below unless he explicitly asks and says **SHIP TO PRODUCTION**.

Related Cursor rule (always-on checklist): `.cursor/rules/pricing-watcher-lessons.mdc`  
Production isolation: `.cursor/rules/production-pricing-experiment-isolation.mdc`

---

## What broke overnight

Lexi dropped ~5 board photos into iCloud `BoardsToPrice` around 10:56pm. Two separate failures stacked:

### Failure 1 — Watcher watched the wrong folder

After a LaunchAgent reinstall, the launcher’s `PREP` pointed at App Support `PreparingInventoryGit`. The bridge inbox was App Support `BoardsToPrice` (empty). Lexi’s photos lived in the **iCloud** drop zone and were never seen.

**Class of bug:** install / env retargeting can silently change which folder is “inbox” without failing closed.

**Hotfix (already applied that night):** set `BOARDS_TO_PRICE_DROP_ZONE` to Lexi’s iCloud `BoardsToPrice` in the launcher + watcher / price scripts, then reinstall. Run proceeded as `PriceCollection_20260828_2339`.

### Failure 2 — Pipeline OK, publish failed (exit 128)

Harness built under `PricingWork`, but `git add PriceCollection_20260828_2339` failed (`pathspec did not match`). Copy into the publish clone was skipped when `PUBLISH_REPO == PREP` (both App Support), so the collection never landed in the git tree used for push. Pages stayed empty until manual rsync + scoped commit/push.

**Class of bug:** “pipeline succeeded” ≠ “live on GitHub Pages with the correct link texted.” Success was defined too early (work folder exists), not at the user-visible outcome.

**Live collection after manual publish:**  
https://finsandpins.github.io/PreparingInventory/PriceCollection_20260828_2339/testing_ui_visual_baseline/index.html

### Prior related incident (June 2026)

Wiring `local_visual_pin_library` into production `run_visual_baseline_pipeline.py` crashed every pricing run via the App Support mirror. Lesson: experiments must not touch production pricing paths; see production-isolation rule.

---

## Path contract (current intended layout)

| Role | Intended path |
|------|----------------|
| Lexi drop zone | iCloud `…/GitHub PreparingInventory/PreparingInventory/BoardsToPrice` (`BOARDS_TO_PRICE_DROP_ZONE`) |
| Bridge / mirror inbox | App Support (sync from drop zone; must not be the *only* place Lexi can drop) |
| Work / build | `~/Library/Application Support/FinsAndPins/PricingWork/` |
| Publish clone (git push) | `~/Library/Application Support/FinsAndPins/PreparingInventoryGit/` |
| Watcher scripts mirror | `~/Library/Application Support/FinsAndPins/PreparingInventoryWatcherBin/` |

Install must not silently retarget Lexi’s drop folder. Prefer **fail closed** (refuse install / refuse run) over guessing.

---

## Recommended hardening (deferred)

Do **not** open a broad “harden the watcher” rewrite. When Steve next intentionally ships pricing changes, prefer **two small, reversible patches**:

### 1. Freeze path contracts (highest ROI / do first)

- One contract source (or fixed defaults) for drop zone / work / publish / watcher bin.
- `install_boards_inbox_launchagent.sh` may only write those known paths.
- Start-of-run asserts: if drop zone ≠ Lexi’s iCloud BoardsToPrice (or agreed contract), **exit loud** — never retarget quietly.

### 2. Success = Pages live + correct link texted

- Copy into publish clone whenever `COL_DIR` ≠ `PUBLISH_REPO/NEWNAME` (not only when PREP ≠ PUBLISH_REPO).
- Treat push failure / missing pathspec as **failed run**.
- Clear BoardsToPrice and send iMessage **only after** publish succeeds (optional HEAD check on Pages URL).
- On failure: alert Steve; do **not** clear Lexi’s drop zone as if the run worked.

### 3. Optional later: always-on Mac mini

Same scripts, machine that does not sleep. Bridge when the dominant pain is laptop sleep / iCloud flakiness — **not** a substitute for fixing path/publish logic. Cheaper interim than Cloud Run if uptime is the only remaining issue.

**Out of scope for this hardening:** RF-DETR, eBay, CTM/CTP logic, cloud pricing migration, intake product work.

---

## Risk / reward / effort (decision record)

| Idea | Break risk | Reward | Effort | Do now? |
|------|------------|--------|--------|---------|
| Path contracts | Low–medium if tiny; high if broad install cleanup | Stops wrong-folder overnight | Small surgical change | **Next intentional SHIP**, not a side project |
| Pages + link as success | Medium (clear/text timing, false fail/success) | Stops half-publish + heroics | Small–medium + one E2E drop test | **After** path freeze is boring |
| Mac mini | Low code / medium ops | Sleep/uptime only | Ops setup | **Later**, if laptop sleep dominates |

**Steve’s decision (2026-08-29):** leave the watcher alone for now; capture lessons so future agents check proactively.

**Rule of thumb for future work:** If the change fits one sentence and can be verified with one photo drop + “Pages live + text matches,” it may be worth shipping. If it needs a design doc or touches more than install asserts + post-publish checks, do not do it casually.

---

## Checklist before any future pricing-watcher change

Before editing or reinstalling production pricing paths, agents must:

1. Confirm user said **SHIP TO PRODUCTION** (or clear equivalent).
2. Restate allowed file paths; stage only those paths (no `git add -A`).
3. Verify path contract: drop zone / PricingWork / PreparingInventoryGit / WatcherBin — install must not retarget Lexi’s folder.
4. Trace publish: work folder → copy into publish clone → `git add` that folder → push → Pages URL.
5. Confirm success gating: BoardsToPrice clear + iMessage only after publish success; failure must not pretend success.
6. After intentional PinPricing / watcher script changes: re-run `install_boards_inbox_launchagent.sh` so App Support matches source.
7. Prefer one real or staged end-to-end drop test over assuming log “OK” means Lexi got a link.

---

## Key runtime locations (Mac)

- Watcher bin: `~/Library/Application Support/FinsAndPins/PreparingInventoryWatcherBin/`
- Publish clone: `~/Library/Application Support/FinsAndPins/PreparingInventoryGit/`
- Work: `~/Library/Application Support/FinsAndPins/PricingWork/`
- Source scripts (iCloud git): `…/GitHub PreparingInventory/PreparingInventory/`
- Builder often used: `Cursor Projects/PinPricingStudyMVP_RFDETR_TEST/`
