# Unified Show Pipeline Agreements

Last updated: 2026-05-13

Discussion notes only. Implementation is deferred until we explicitly decide to build.

## Agreed (so far)

- Non-destructive implementation policy when build work starts: add new files/folders first; avoid risky in-place churn.
- Show id format stays `YYYYMMDD`.
- Unified flow: RF-DETR output to per-image JSON, then crops named `img####-pin##.jpg`, then Lexi pricing harness runs on those same crops.
- Use one detector inventory only (no second pricing-only detector run).
- Order nuance should stay aligned with the existing FUTURE/playbook framing.
- Add/keep a Whatnot CSV button in the harness.
- Add/keep an admin CTR price overlay button.
- Support multi-board shows (30-50+ boards and beyond).
- Reports/admin CTR behavior stays conceptually as it works now.
- Pricing harness remains private.
- Public CTR should remain no-price for now (possible future public price mode later).
- Stability priority: CTR should keep working even when pricing-side steps fail.
- Traceability should use `pin_uid` plus manifest linkage; no formal audit system required right now.
- MacBook remains the orchestration machine for this workflow.
- Cursor Projects artifacts referenced in this discussion:
  - `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/Whatnot show 20260511/whatnot_upload_20260511.csv`
  - `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/Whatnot show 20260511/WHATNOT_CTR_PLAYBOOK.md`
  - `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/Whatnot show 20260511/ALIGNMENT_NOTES.md`
- Firebase authority notes remain in-repo: see `FUTURE.md` and `project_context_cursor.md`.

## Open / to discuss

- Confirm global uniqueness strategy for `img####` across all boards in a show.
- Decide exact unified Firebase strategy: new subtree in an existing project vs a new project, while leaving the two legacy DBs untouched.
- Reconcile "script read-only Firebase" guidance with harness behavior where Lexi writes state.
- Tighten security posture from current public read/write defaults.
- Confirm whether the Whatnot importer changed and what must stay compatible.
- Optional future decisions:
  - Public price visibility flag in CTR.
  - CI steps that touch Firebase.

## Explicit non-goals for now

- Lexi re-running detection/re-crops to stabilize ids is out of scope for this phase.
