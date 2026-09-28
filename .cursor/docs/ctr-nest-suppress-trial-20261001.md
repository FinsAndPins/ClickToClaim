# CTR nest-suppress trial — 20261001

Pointer only. Implementation lives under Cursor Projects (not this repo):

`~/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/CtrNestSuppressTrial_20261001/`

## Locked (2026-09-28)

- Show `20261001`, nest-suppress V1 prefer parent (contain_frac 0.85).
- Production CTR bin stays untouched; LaunchAgent swap/restore for trial.
- Script A: pricing harness button → confirm → Firebase `whatnotScriptARequests/20261001` → local watcher; Steve-only iMessage.
- Script B: noon Oct 1 local, only if Script A success marker exists.
- BoardsToPrice / production pricing scripts: **not** modified for this trial.

## Rollback

`launchagents/restore_production_ctr.sh` retargets the ClickToRequest launcher back to `ClickToRequestWatcherBin`.

## Deferred

If the trial works, later port nest-suppress into the pricing watcher (SHIP TO PRODUCTION). See `deferred-pricing-nest-suppress.md`.
