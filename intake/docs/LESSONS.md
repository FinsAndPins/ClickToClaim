# Intake lessons

## 2026-10-06 — Upload-first landing (photos then contact)

**Symptom:** Two-page flow felt slow. Lexi stayed on upload during moderation (fixed separately). Sellers waited on photos with nothing to do.

**Cause:** Contact form was required before any upload started.

**Rule:** Photos start uploading on pick. Step 2 unlocks as soon as upload starts. Submit collection is the only moment that creates a real submission (moderation + Mac handoff). Abandoned temp files expire and are deleted. Rollback: `docs/ROLLBACK_TWO_PAGE_20261006.md` and Worker `55276018-ad61-4938-aeff-fba58840f873`.

**Where:** `intake/` Worker only. Not NamedCollections, BoardsToPrice, or CTR watchers.

## 2026-10-06 — Overlay button + Pull total from Firebase

**Symptom:** Staff pasted the CTM URL and typed the harness total by hand.

**Cause:** Pricing publish lived in Named Collections / Pages with no intake callback.

**Rule:** Intake-only `link_pricing_overlay_once.py` (same handoff LaunchAgent) links the Open pricing overlay button. Staff clicks **Pull total from Firebase** after Lexi finishes pricing (sums `display_price`). Do not edit Named Collections for this.

**Where:** intake Worker admin card; `Cursor Projects/IntakeToCollectionsToPrice/link_pricing_overlay_once.py`
