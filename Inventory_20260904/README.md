# Inventory_20260904

Staff-only inventory counter for the **20260904** Click To Request boards.

- **Boards:** https://finsandpins.github.io/ClickToClaim/Inventory_20260904/?admin=0626200207081986  
- **Reports:** https://finsandpins.github.io/ClickToClaim/Inventory_20260904/reports.html?admin=0626200207081986  

## Isolation

- Board art / boxes: read from live `../20260904/boards` (adjusted JSON).
- Counts: Firebase `inventory/Inventory_20260904/{pinKey}` only — does **not** write `claims/20260904`.
- Public CTR at `/20260904/` is unchanged (visitors still request pins).
- Unit prices on reports: harness list price from `PriceCollection_20260901_2012` ($10 min, round up to $5). Unpriced pins show blank and are excluded from dollar totals.

## Whatnot CSV

Not included yet — generate later from inventory counts where qty &gt; 1 (one shop line, qty 1).
