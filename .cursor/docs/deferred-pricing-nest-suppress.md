# Deferred: nest-suppress in pricing watcher — do not ship prefer-parent

**2026-09-29:** CTR prefer-parent **failed** on 20261001 (kept multi-pin nest blobs, dropped real pins). Do **not** port prefer-parent into BoardsToPrice / pricing. See `ctr-nest-suppress-trial-20261001.md` and `CtrNestSuppressTrial_20261001/docs/PREFER_PARENT_FAILED_20261001.md`.

Any future nest work must be a **new** experiment (e.g. prefer-child), not prefer-parent, and still requires explicit **SHIP TO PRODUCTION**.

## Historical intent (superseded)

BoardsToPrice can see nested boxes too. The 20261001 trial tested prefer-parent on a sibling CTR path only. That default is retired.

## Related

- `production-pricing-experiment-isolation.mdc`
- `pricing-watcher-lessons.mdc`
- `steve-delegation-and-agent-dod.mdc` (one box set for CTR + pricing)
