# CTR watcher — empty LaunchAgent + iCloud prune flicker (20261013)

## Symptom
- Photos sat in `ClickToRequest/20261013` with no prepare run.
- Local mirror was deleted mid-ingest; drop briefly looked empty.

## Cause
1. `~/Library/LaunchAgents/com.finsandpins.ClickToRequestWatcher.plist` was **0 bytes** (since 2026-10-05), so launchd could not keep the CTR watcher loaded.
2. `prune_stale_mirror_show_dirs` deleted the local mirror on a single failed iCloud directory listing (folder still present; listing flickered).
3. iCloud `ClickToClaim` working copy was behind `origin/main`, so template `20261008` (Canva + Tap to Exclude) was missing until copied from `ClickToClaimGit`.

## Rule
- If CTR drops are ignored: check plist size (`wc -c`) and `launchctl print gui/$UID/com.finsandpins.ClickToRequestWatcher`.
- Never prune the local mirror on one miss; recheck iCloud after a short sleep.
- Pin `CTR_TEMPLATE_ID=20261008` in App Support launcher; ensure that show exists under the iCloud `CTR_REPO` path prepare reads (or sync from `ClickToClaimGit`).
- Pricing LaunchAgents stay untouched when only CTR is in scope.

## Where
- Runtime: `~/Library/Application Support/FinsAndPins/ClickToRequestWatcherBin/watch_click_to_request.sh`
- Launcher: `~/Library/Application Support/FinsAndPins/click_to_request_watcher_launcher.sh`
- Plist: `~/Library/LaunchAgents/com.finsandpins.ClickToRequestWatcher.plist`
