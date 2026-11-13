# Pin Matching Game

Public game: compare a pin crop to an eBay candidate. Match / No Match / Not a pin / Skip.

Live: `https://finsandpins.github.io/ClickToClaim/PinMatchingGame/`

## Queue lanes

1. **Controls** (injected): known answers for trust calibration.
2. **Priority**: active unpriced inventory. Consensus can write the pricing harness.
3. **Backlog** (durable forever): historically decided CTM match/no-match and CTP/listing match pairs. Votes never remove the pair and never write harness.

Manual `price_source` overrides are never seeded into backlog (price override is not proof of visual match).

## Seed durable backlog

From this repo:

```bash
python3 PinMatchingGame/tools/seed_queue.py --seed-backlog-from-firebase --dry-run
python3 PinMatchingGame/tools/seed_queue.py --seed-backlog-from-firebase
```

Optional: `--limit N`, `--run-limit N` (newest N pricing runs only).

Only collections that still have public crops on `PreparingInventory` main are seeded. If left-pin images go blank after pruning old collections:

```bash
python3 PinMatchingGame/tools/repair_crop_urls.py
```

Writes only under Firebase `pin_matching_game/v1`. Does not touch pricing watcher scripts or CTR show folders.

## Seed priority batch (unchanged)

```bash
python3 PinMatchingGame/tools/seed_queue.py \
  --ui-data /path/to/ui_data.json \
  --collection PriceCollection_YYYYMMDD_HHMM
```
