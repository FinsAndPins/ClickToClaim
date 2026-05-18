# PreparingInventory GitHub Archive/Cleanup Session (2026-05-16)

Last updated: 2026-05-16

This note captures the archive/cleanup work completed for `PreparingInventory` and the practical rules we want to keep using.

## What we did

- Investigated GitHub Pages failures caused by an oversized deploy artifact (around 8GB) and legacy deploy assumptions.
- Kept a sparse `.github/workflows/pages.yml` strategy so Pages deploys only the required harness path(s), not full historical trees.
- Moved about 70 `PriceCollection_*` folders (older than 5 days) from the local repo working tree to local archive storage under `OldNotOnGitHub`.
- Removed moved collections from GitHub using scoped `git rm` (not blanket deletes), then restored recent collections needed for current use.
- Applied commit sequence during cleanup:
  - `f29bffc`
  - `dd01ecc`
  - `96abe91` (over-archive mistake)
  - `bbb73e9` (`manual_exclude` index-only adjustment)
  - `da8b465` (restored 10 collections from the last 5 days)
- Moved `build/`, `testlocal/`, and `CollectionToPrice1/` out of the GitHub-tracked tree to local archive storage.
- Moved `manual_exclude/` out of the repo-tracked archive set as part of the cleanup plan.

## Learned

- GitHub repo size API still reports historical objects (about 3.8GB) even after working-tree cleanup; deleting current files does not remove history.
- `.gitignore` does not remove already tracked files; tracked paths require explicit `git rm --cached` or `git rm` workflows.
- Pages deploy should include only `testing_ui_visual_baseline` per collection (plus anything strictly required by relative links).
- Mac/iCloud archive location for removed historical folders is `.../OldNotOnGitHub` (outside GitHub-tracked history).
- Automatic pricing flow (`RunBoardsPricing_RFDETR` + `BoardsToPrice`) is unaffected by this archive approach.
- Whatnot image links generated after import do not need old raw GitHub URL history to keep current workflow operational.

## Still to do

- Optionally evaluate git history rewrite to shrink true repository object size (document risks before attempting).
- Prevent future broad agent actions that move all collections by default; always scope to explicit age/path criteria.
- Continue periodic archive cycle: move `>5d` collections to `OldNotOnGitHub`, then run scoped `git rm` only for those moved paths.
- Keep the restore workflow documented for quickly re-adding recent collections when needed.
- Resolve unrelated `git status` noise tied to `20260411` local state before future archive passes.
- Consider `.gitignore` patterns for newly generated collections where appropriate (without breaking required tracked outputs).
- Add/keep a Pages artifact size guardrail in CI.
- Verify `pricing_index.json` after each archive/restore pass.

## Paths used

- ClickToClaim docs repo:
  - `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/GitHub Repository/ClickToClaim`
- PreparingInventory repo:
  - `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/GitHub PreparingInventory/PreparingInventory`
- Local archive root (Mac/iCloud):
  - `/Users/steve/Library/Mobile Documents/com~apple~CloudDocs/GitHub PreparingInventory/OldNotOnGitHub`

## Key commits (PreparingInventory)

- `f29bffc`
- `dd01ecc`
- `96abe91`
- `bbb73e9`
- `da8b465`
