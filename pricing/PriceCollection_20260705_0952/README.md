# Connie collection harness upgrade (PriceCollection_20260705_0952)

Upgraded `new_ctp.html` / `new_ctm.html` to current ClickToPrice / ClickToMatch v2 behavior
**without changing the Firebase path**, so existing reviews stay intact:

`pin_pricing_tests/test_PriceCollection_20260705_0952__build_31617_visual_baseline/visual_baseline/pins/`

## Use now (this ClickToClaim Pages mirror)

- ClickToMatch: `../testing_ui_visual_baseline/new_ctm.html` (see SHARE_LEXI_URL.txt for full URLs)
- ClickToPrice no-match: `new_ctp.html?filter=no_match`

Sibling pages that were not upgraded (contact sheet, NTS, overlay) link back to the
existing PreparingInventory Pages copies.

## Promote back to PreparingInventory

Copy these two files over the same paths in `FinsAndPins/PreparingInventory` when you
have write access:

- `PriceCollection_20260705_0952/testing_ui_visual_baseline/new_ctp.html`
- `PriceCollection_20260705_0952/testing_ui_visual_baseline/new_ctm.html`

Do **not** re-run the pricing pipeline and do **not** change `TEST_RUN_ID`.

## Available pins CTR page

`testing_ui_visual_baseline/available.html` — board view to tap pins still for sale.
Uses a separate Firebase claims path (`claims/connie_available_20260705`) and reads
prices from the existing Connie pricing run. Does not modify CTM/CTP match history.
Default overlay mode: **Prices on clicked only**.

Prices on Available CTR: live Firebase when `display_price` exists; otherwise pipeline suggested price from `available_boards.json`. No manual Firebase JSON download needed.
