# On-device import benchmarks (ClickToCollect)

Upload / import timing comparisons: **old model** vs **new model** builds.

| Boards | Old model pins | Old sec | New model pins | New sec | Old pins/s | New pins/s |
| -----: | -------------: | ------: | -------------: | ------: | ---------: | ---------: |
|     20 |            603 |      32 |            574 |      32 |       18.8 |       17.9 |
|     42 |           1382 |      61 |           1309 |      67 |       22.7 |       19.5 |
|     44 |           1242 |      50 |           1197 |      47 |       24.8 |       25.5 |
|    103 |           4068 |      68 |           3871 |     120 |       59.8 |       32.3 |
|    141 |           4663 |     120 |           4420 |     120 |       38.9 |       36.8 |

When comparing runs, treat **pin counts** and **wall time** together (dedupe, skipped files, and background work differ between builds).

## App changes (recent perf UX batch)

Implemented in **ClickToCollect** on Desktop (`~/Desktop/ClickToCollectApp/...`):

- **PinsGrid prefetch** when within the last **14** visible pins (`scrollPrefetchTailCount`).
- **Collection** navigation title **inline**.
- **Tag catalog refresh** coalesced **~3.2s** after the last `boardsLibraryDidMutate` pulse.
- **`pinIDsOnBoard`** via `FetchDescriptor` instead of faulting **`board.pins`** for board context-menu bulk tagging and merged helpers.
- **`canApplyMergedBulkTags`** uses **`cachedPinCount`** before fetch where possible.

## What we learned

- Pin counts often differ **old vs new**; compare **pins and time together** and prefer **pins/s** as a rate signal.
- Small board counts are **noisy**; take care interpreting deltas.
- Large import (**103 boards**) showed a bigger **wall-time** gap—investigate with **repeat runs + Instruments**; watch for **ceiling effects** (e.g. **141-board** both **120s**).
- Treat the table as **directional** until the run **protocol** is locked.

## Run protocol (for future rows)

- Same **payload**, **folder**, **device**, **iOS**, and **build**.
- **Cold vs warm** library optional note in the row or caption.
- Consider logging **attempted** vs **committed/skipped** for interpretability.
