# Show Automation Plan

Last updated: 2026-05-19

This captures the agreed direction for automating future ClickToRequest and pricing prep. It is a plan, not the current production workflow.
It also captures decisions made on 2026-05-19 so future-Steve and future-AI can continue without re-litigating core choices.

## Goal

Let Steve prepare a future show by creating a dated folder under:

`/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/ClickToRequest/YYYYMMDD/`

and placing that show's board photos in it. A watcher on Steve's MacBook should then run the ClickToRequest and pricing preparation steps that are currently done manually.

Whatnot CSV export remains a separate workflow.

## Proposed Trigger

- Use dated subfolders, for example `ClickToRequest/20260521/`.
- Do not use a sentinel file.
- Before implementing the watcher, inspect Lexi's existing pricing watcher on Steve's MacBook and mirror that pattern for how runs are detected and started.
- The watcher should process one show at a time using a lock file, so multiple dated folders can exist but RF-DETR runs serially.
- Early automated runs should use one show folder at a time to keep logs and messages easy to follow.
- Confirmed log file path format for both pipelines:
  - `~/Library/Logs/show-automation/{YYYYMMDD}-{stage}.log`
  - `{stage}` is `ctr` or `pricing`.

## ClickToRequest Workflow

1. Detect a new show folder using the mirrored watcher pattern from Lexi's pricing flow.
2. Refuse to run if the target show folder already exists in `ClickToClaim` with board outputs.
3. Bootstrap `ClickToClaim/YYYYMMDD/` by copying the most recent prior show folder as the template.
   - Copy `index.html`, `reports.html`, `icons/`, and expected static files.
   - Do not copy old `boards/` outputs.
4. Run RF-DETR once on that show's photos.
5. Write baked board JPGs, detection JSON, and `manifest.json` into `ClickToClaim/YYYYMMDD/boards/`.
6. Validate:
   - manifest count matches photo count
   - every JSON has predictions
   - board image dimensions match JSON image dimensions
   - prediction counts look plausible
7. Commit and push path-limited show files.
8. Send iMessage with a clear prefix, for example:
   - `ClickToRequest for show 20260521 is ready`
   - include the live URL and log path.

## Pricing Workflow

1. Create `PriceCollection_YYYYMMDD_HHMM` using the existing pricing convention.
2. Crop from the ClickToRequest board JSON/JPG outputs.
   - Do not run a second detector pass for show-night aligned pricing.
   - Preserve `pin_uid_map.json`.
3. Run the existing pricing flow Lexi uses.
4. Create the standard visual pricing harness.
5. Create a separate CTR-click overlay harness only as a sibling page, never by modifying Lexi's standard harness.
6. Send iMessage with a clear prefix, for example:
   - `Pricing for whatnot show 20260521 is ready`
   - include Lexi's URL and log path.

## Notifications

- Steve receives all iMessage notifications:
  - start (run kicked off)
  - done (success)
  - errors (include the log path)
- Lexi receives only start and done (success), and does not receive error notifications.
- Keep the existing message prefix format:
  - `ClickToRequest for show YYYYMMDD ...`
  - `Pricing for whatnot show YYYYMMDD ...`

## CTR Click Overlay Agreement

- The overlay page must be a copy of the existing `testing_ui_visual_baseline/` harness first.
- Add only click overlay behavior:
  - green highlight for clicked pins
  - count badge only when click count is greater than one
  - board prefix in labels, for example `Board 19 · img4696_pin27`
- Do not change totals, rounding checkbox, prices, layout, or any other Lexi pricing behavior.
- Keep the overlay as a separate page, usually:

`PriceCollection_*/testing_ui_visual_baseline_with_ctr_clicks/index.html`

## Whatnot CSV Workflow

- Keep this separate from the ClickToRequest/pricing automation.
- For future shows, generate one row per detected pin.
- Clicked pins include usernames in the description.
- Unclicked pins keep the normal image/pin reference description but no usernames.
- Do not add a separate `clicked` column unless the workflow changes; users can filter by `@` in the description.
- Keep `lexi_raw_price` and `lexi_raw_price_zero` for price review.

## Safety Rules

- Prefer the safer implementation over the fastest one.
- Never modify an earlier live show folder when preparing a new show.
- Never modify `ClickToClaim/YYYYMMDD` while working on a PreparingInventory pricing harness, except for the specific show being prepared.
- Use path-limited commits only.
- In dirty repos, never use `git add .` or `git add -A`.
- If output already exists, refuse and notify rather than overwriting.
- On errors, log to a known file and iMessage Steve with the log path. Do not auto-revert.

## Agent Edit Safety

- Cross-repo boundary is strict:
  - PreparingInventory/PriceCollection/live CTR harness requests must not modify `ClickToClaim/**`.
  - ClickToClaim show-page requests must not modify PreparingInventory paths unless explicitly asked.
- Show-folder guard: do not edit `ClickToClaim/YYYYMMDD/` unless the user explicitly names ClickToClaim in the request.
- Path-limited commit protocol:
  - restate allowed paths before editing,
  - stage only explicit paths with `git add <path>`,
  - never use broad staging (`git add -A`, `git add .`, `git commit -a`).

## Implementation Phases

0. Inspect Lexi's existing pricing watcher on Steve's MacBook and document the local detection/trigger pattern to mirror.
1. Parameterize the current manual scripts with `--show-id`, `--input-dir`, and output paths.
2. Add a bootstrap script that creates a new show folder from the most recent prior show template.
3. Add a manual one-command orchestrator for CTR, then pricing.
4. After another clean show, add the MacBook watcher using Lexi's mirrored pattern (no sentinel file).
5. Add polished iMessage notifications and operator logs.

## Open Items

- Confirm the exact mechanics of Lexi's pricing watcher so the show watcher can mirror it as implementation step 0.

## Future work

- Not Pin pricing-harness design reference: `docs/NOT_PIN_FEATURE_PLAN.md`.

## Post-20260521 security backlog

- Firebase RTDB security is currently open (`.read: true` and `.write: true`) and was confirmed in-console before show day.
- Risk: anyone with database access knowledge can read/write live claim data, pricing collaboration state, and related operational data.
- Plan after show `20260521`:
  - tighten RTDB rules (do not leave public read/write),
  - test rule changes on a staging copy first,
  - then roll to production with an explicit rollback note.
- Important reminder: Firebase console password alone does not protect the live database; security rules are the actual guardrail.

### Data pull and analysis path (for Steve and assistant)

- Keep documented export naming so future analysis scripts can auto-locate exports:
  - `fins-and-pins-click-to-claim-default-rtdb-*-export.json`
- Pricing harness data reference path to keep stable:
  - `pin_pricing_tests/test_PriceCollection_*__build_*/visual_baseline/pins/`
- CTR claims path lesson from live overlay debugging:
  - claims are stored per board stem, for example `claims/IMG_4731/...`,
  - do not assume a show-date-only node such as `claims/20260521` is complete.
- Overlay/fetch behavior requirement:
  - subscribe by board entries from `manifest.json`, then read corresponding `claims/{boardStem}/...`.
- Export/access options to implement after show:
  - manual Firebase console export workflow for periodic snapshots, or
  - a read-only service account / authenticated-export path for scripted assistant analysis.
