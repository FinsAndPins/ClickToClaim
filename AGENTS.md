# Cursor / agent guidance for this repo

## Auto-ship (commit / push / merge)

When requested work is done, **do not stop at a branch or open PR**. In the same turn:

1. Commit only the task’s files (explicit paths when path allowlists apply).
2. Push to the remote.
3. Land on **`main`** (merge the PR, or merge locally and `git push origin main`) so GitHub Pages refreshes without Steve.

Opening a PR is not done — merge it before the final summary unless blocked (auth, conflicts, checks Steve cares about).

Still do **not** auto-ship protected production pricing / PrepareClickToClaim / inbox-watcher paths without explicit **SHIP TO PRODUCTION**. See `.cursor/rules/production-pricing-experiment-isolation.mdc`.

More detail: `.cursor/rules/auto-ship-commit-push-merge.mdc`
