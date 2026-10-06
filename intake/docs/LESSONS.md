# Intake lessons

## 2026-10-06 — Upload-first landing (photos then contact)

**Symptom:** Two-page flow felt slow. Lexi stayed on upload during moderation (fixed separately). Sellers waited on photos with nothing to do.

**Cause:** Contact form was required before any upload started.

**Rule:** Photos start uploading on pick. Step 2 unlocks as soon as upload starts. Submit collection is the only moment that creates a real submission (moderation + Mac handoff). Abandoned temp files expire and are deleted. Rollback: `docs/ROLLBACK_TWO_PAGE_20261006.md` and Worker `55276018-ad61-4938-aeff-fba58840f873`.

**Where:** `intake/` Worker only. Not NamedCollections, BoardsToPrice, or CTR watchers.
