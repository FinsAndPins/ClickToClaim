# CTR watcher — iCloud detect + notify (20261005)

## Symptom
ClickToRequest `20261005` failed during RF-DETR: PIL `OSError: [Errno 11] Resource deadlock avoided` / `UnidentifiedImageError` reading `ClickToClaim/<show>/boards/*.JPG` right after write. Retry also hit `patch_ctr_show_slug.py` exit 1 when HTML was already patched (`changed == 0`). Concurrent NotifyOutbox drains hung Messages; Cursor TCC could not send.

## Cause
Detect writes web JPGs into the iCloud show `boards/` path, then CoreML/PIL reads them immediately. iCloud contention corrupts or locks the read. A single leftover board JPG makes `has_board_outputs` true and skips re-detect (false commit-only recovery). Patch script treats already-correct slug as failure. Messages wedged under overlapping `osascript` sends.

## Rule
1. If CTR detect dies on iCloud board JPG reads: run `detect_boards_rfdetr_for_ctr.py` with `--output-dir` under App Support (local), validate, byte-copy into `ClickToClaim/<show>/boards`, then `prepare_click_to_claim.sh` recovery commit/push.
2. Before retry after a failed detect: remove partial `boards/` (no stray JPG) so prepare does not skip detect.
3. Success notify: Prefer LaunchAgent/Terminal `.command` (`open …command`) after quitting wedged Messages; do not pile concurrent drains from Cursor.
4. Keep full-res copies under `Cursor Projects/<show>/` before the watcher deletes ClickToRequest (needed for CtrFullresPricing next).

## Where
ClickToRequest watcher / PrepareClickToClaim; App Support `CtrDetectWork/`; NotifyOutbox + Terminal `.command`.

## Template pin (20261005 Canva) — shipped production

- **Symptom:** Next CTR would still bootstrap from `20260910` pink chrome.
- **Cause:** `CTR_TEMPLATE_ID` default in `click_to_request_watcher_launcher.sh` was pinned to `20260910`; bootstrap did not copy `ctr-bg-canva.jpg`.
- **Rule:** When Lexi locks a new CTR look, update launcher `CTR_TEMPLATE_ID`, copy any new root assets (e.g. `ctr-bg-canva.jpg`) in `bootstrap_show`, then re-run `install_click_to_request_launchagent.sh` and verify the live Application Support launcher.
- **Where:** PreparingInventory `prepare_click_to_claim.sh` + `launchd/click_to_request_watcher_launcher.sh`; live mirror under Application Support `ClickToRequestWatcherBin` / `click_to_request_watcher_launcher.sh`.

## Template pin (20261012 search) — shipped production

- **Symptom:** New shows kept the 20261008 page (no title search). Pinning 20261012 on the iCloud checkout would have failed because that folder is not there. Companion admin pages would still have pointed at Monday's pricing run, crop folder, and `showConfig/20260803_leftover/soldStems`. The copied page also carried 140 old sold-stem names.
- **Cause:** The watcher read the template only from the iCloud ClickToClaim checkout, and `patch_ctr_show_slug.py` rewrote the main price id but not companion run ids, crop URLs, the shared leftover sold path, or `_SOLD_STEMS_BOOTSTRAP`.
- **Rule:** `CTR_TEMPLATE_ID=20261012`. Read template HTML from ClickToClaimGit first, then iCloud. Every new show must leave the patch with that show's date, that show's pricing run (or `test_CTR_<date>_pricing_unset`), `showConfig/<date>/soldStems` and `pendingStems`, an empty sold-stem bootstrap, and the search bar. Do not copy Monday's Firebase paths forward. Re-run `install_click_to_request_launchagent.sh` after launcher or patch changes. CTRandPricing `template_id` is the same show. Its leftover keys stay show-specific and must be updated before the next combined run.
- **Where:** PreparingInventory `patch_ctr_show_slug.py`, `prepare_click_to_claim.sh`, `launchd/click_to_request_watcher_launcher.sh`. CTRandPricing `show_config.json` (iCloud source and App Support bin).

## Install must not blank the LaunchAgent (20261013)

- **Symptom:** `com.finsandpins.ClickToRequestWatcher.plist` became 0 bytes during install. The already-running job kept going, but the next restart would not load.
- **Cause:** `install_click_to_request_launchagent.sh` redirected `sed` onto the live plist while the template file was missing. The redirect emptied the destination before sed failed.
- **Rule:** Render the launcher and plist to a temp file, and replace the live file only when the render is non-empty and `plutil -lint` passes. Keep `launchd/com.finsandpins.ClickToRequestWatcher.plist` in PreparingInventory.
- **Where:** PreparingInventory `launchd/install_click_to_request_launchagent.sh`.
