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
