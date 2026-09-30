# CTR nest-suppress trial — 20261001

Pointer. Implementation: `~/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/CtrNestSuppressTrial_20261001/`

## Outcome (2026-09-29)

**Prefer-parent FAILED** on the 28 new boards (kept multi-pin nest blobs, dropped real pin boxes; Board 10 clickability broken). Details: `CtrNestSuppressTrial_20261001/docs/PREFER_PARENT_FAILED_20261001.md`.

- Trial detect: prefer-parent **off by default** (opt-in only). Do not re-enable as default.
- CTR LaunchAgent restored to production bin.
- Do **not** ship prefer-parent into pricing watcher.
- Standing rule: CTR and pricing share one box set / `crop_stem`s (no dual RF on the same photos).

## Historical lock (2026-09-28)

Original trial planned prefer-parent contain_frac 0.85 for show 20261001. That default is retired after the failure above.
