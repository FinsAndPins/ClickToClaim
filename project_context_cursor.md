# Project context (Cursor)

High-level notes for AI sessions and humans: what exists, where it lives, and pitfalls. This file is a **snapshot**, not a full spec.

---

## Where to build (WIP vs shipped)

**Convention (also in Cursor project rule `cursor-projects-and-github.mdc`):**

- **New work / drafts / experiments** → iCloud **`Cursor Projects`**  
  `~/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects`
- **Finished tools** → **GitHub** (this repo and similar). Promote from Cursor Projects when the user confirms something is done.
- **Existing iCloud folders** (e.g. `PinToPull20260402` at CloudDocs root): leave in place unless the user asks to move; **only new** work defaults to **Cursor Projects**.

---

## Repositories and locations

| Area | Path / notes |
|------|----------------|
| **Click To Request / Identify (GitHub)** | This repo: `ClickToClaim`. Dated show folders (e.g. `20260402/`) hold `index.html`, `boards/`, Firebase config. |
| **PinToPull / seller pack-out (iCloud)** | `~/Library/Mobile Documents/com~apple~CloudDocs/PinToPull20260402/` — **not** always committed to git; scripts and outputs live next to each other. |
| **Older ClickToPull templates** | iCloud: `Create ClickToPull/` (`clicktopull.py`, `pdf_to_whatnot_orders.py`). |
| **ClickToCollect (iOS, Vegas / Lexi)** | **Canonical Cursor + Xcode tree:** `~/Desktop/ClickToCollectApp/` — **git repo initialized 2026-04-20** at that root (not inside **ClickToClaim**). App sources: `ClickToCollect/ClickToCollect/*.swift`, **`CLAUDE.md`**, **`TOMORROW.md`**, **`SETUP.md`**. |

### ClickToCollect — value pricing handoff (2026-04-20)

- **Shipped in the app:** Labs → **Pricing collections** — on-device **crop + saved sessions**; **import Mac `candidates.json` + `crops/`** into Application Support; **Add** tab supports **camera or Photos** for board capture.
- **Not in the app:** eBay Browse / visual baseline — still produced by **PinPricingStudyMVP** + **PreparingInventory** (`RunBoardsPricing.command` → `price_boards_from_inbox.sh` → `run_visual_baseline_pipeline.py`). See **PreparingInventory** section below.
- **Private beta workflow (Option 1):** Lexi captures on phone → sends board photos to Steve → Mac pipeline → return **`candidates.json` + `crops/`** folder (iCloud / AirDrop / Messages) → Lexi **imports JSON from Files** so listing overlays work in-app. **Do not** ship eBay API credentials inside the iOS binary; a future bridge uses **server-held** secrets or the Mac-only path.
- **Detail doc:** `ClickToCollect/ClickToCollect/CLAUDE.md` → sections **Value pricing (Vegas / Lexi)** and **Progress log** for file-level pointers.

---

## PinToPull20260402 (Apr 2026 seller workflow)

**Purpose:** After a Whatnot show, merge listing inventory + seller orders, copy board assets, generate annotated pull guides and packing visuals.

**Inputs**

- `whatnot_orders.csv` — merged **Whatnot upload** CSVs (`whatnot_upload_20260329` + `whatnot_upload_20260402` style columns, including `Flags` where needed).
- `whatnot_pull_orders_YYYYMMDD.csv` — **buyer orders** from Seller Hub PDFs via `pdf_to_pull_orders.py` (filters by order date; pin refs in `title` as `Pin ####-##`).
- `PhotoValidation1/` (etc.) — **`IMG_<board>.jpg`** + **`IMG_<board>.json`** copied from `Create ClickToPull` and/or `ClickToClaim/20260402/boards/` for boards referenced in the upload merge.

**Scripts (iCloud folder)**

| Script | Role |
|--------|------|
| **`pdf_to_pull_orders.py`** | Seller Hub order PDFs → `whatnot_pull_orders_YYYYMMDD.csv`; date in filename from PDF footer when possible. |
| **`clicktopull.py`** | Reads orders CSV; maps pin **N** → `predictions[N-1]`; writes `ClickToPull_output/clicktopull.html`, `clicktopull_pulls_only.html` (boards with ≥1 successful box), `IMG_*_pull.jpg`. |
| **`pin_lookup.py`** | Debug: print raw vs “reading-order” slot for a board/pin. |
| **`build_virtual_pull_board.py`** | Builds **three** PNGs: A→Z buyers; most pins first; fewest pins first (tie-break: username). |

**`clicktopull.py` options / behaviors worth knowing**

- `ORDERS_CSV_FILE` points at the **pull orders** CSV (not the upload inventory CSV).
- Longer username badges; `IMG ####` label top-right; optional `DEBUG_DRAW_PREDICTION_NUMBERS` for QA.
- “Pulls only” HTML omits boards where **no** pin box was drawn (index out of range, etc.).

**Scale / counts (example run)**

- ~173 pull lines, ~43 buyers, ~81 boards with highlights (numbers depend on CSV).

---

## ClickToValidate20260406 + PreparingInventory (Apr 2026)

**Purpose:** Catalog-match validation for the 20260406 Whatnot upload (~3,091 pins, 96 boards), **without** bloating the **ClickToClaim** repo. Shipped on a **separate GitHub repo** with GitHub Pages.

| Item | Location |
|------|----------|
| **GitHub repo** | `FinsAndPins/PreparingInventory` |
| **Local clone (example)** | iCloud `…/GitHub PreparingInventory/PreparingInventory/` |
| **Pages base (first run)** | `https://finsandpins.github.io/PreparingInventory/ClickToValidate20260406/` |
| **Pages base (pulled-board run)** | `…/PreparingInventory/ClickToValidatePulledBoards20260406/` |
| **Firebase RTDB path** | `photo_validation/ClickToValidate20260406` and `photo_validation/ClickToValidatePulledBoards20260406` — each folder sets `FB_BUILD_FOLDER` explicitly (not derived from URL). Same Firebase **project** as CTR; CTR uses `claims` / `showConfig` / `feedback` only. |
| **Also on disk** | `ClickToClaim/ClickToValidate20260406/` — staging copy; large `pins/` + `refs/` should **not** be committed into ClickToClaim unless the user explicitly wants them there. |

**Boards-to-price inbox (same repo, Apr 2026):** `RunBoardsPricing.command` + `price_boards_from_inbox.sh` — git tag **`preparing-inventory-pricing-baseline-2026-04-26`** for rollback; **`README.md`** in the PreparingInventory clone describes recovery, GitHub file-size limits, and **`EBAY_CHECKPOINT_EVERY`**. Pipeline behavior: **`PinPricingStudyMVP/PIPELINE_DECISIONS.md`**.

**Static site files (validator folder)**

- `index.html` — one-at-a-time validator; `GITHUB_PAGES_BASE` for crop JPEGs on Pages.
- `reports.html` — Firebase-driven report + **Export Whatnot CSV (matches only)**.
- `batch_scroll_review.html` — all rows; **CLIP sort**; **Match / No Match** → same Firebase writes as `index.html`; **Needs review only** + **After vote, scroll to next**; reviewer from `validator_user` (distinct names per person).
- `pending_items.json` — crop paths, titles, `sku`, `clip_score`, etc.
- `sku_description_tails.json` — SKU → legacy catalog description tail (from scanning `Upload to whatnot for 20260406 show/**/*.csv`); used to append **Disney Pin …** franchise text for Whatnot descriptions. Regenerate if new Whatnot CSVs add SKUs.
- `export_whatnot_matches_csv.py` — CLI: Firebase matches + `pending_items` + tails → Whatnot bulk CSV (run with network for RTDB JSON).

**Whatnot CSV export rules (matches only)**

- **Title:** `{short pin name} IMG {board}-{pinNN}` (e.g. `Star Wars Black Spire Outpost IMG 3104-01`), short name = CLIP prefix stripped + trailing SKU removed from **pending_items title** (not Firebase snapshot — `item.title` preferred over `res.title` so catalog fixes apply).
- **Description:** `Please rely on the photo, rather than the description. {short name} {franchise} IMG {board}-{pinNN}` with **IMG … at the end**; `franchise` = substring from **Disney Pin** onward in the SKU tail (fallback `Disney Pin` or tail + ` Disney Pin`).
- **Image URL 1:** GitHub Pages URL under `…/pins/<filename>.jpg`.
- **SKU correction example:** `2835-3` (Black Spire) had wrong **Lion King** in an old CSV tail — fixed to **Star Wars** in `pending_items` titles, tails, and source test CSVs; duplicate “Star Wars” avoided (tail = generic `Disney Pin` when title already carries Star Wars).

**GitHub secret scanning**

- Firebase **`apiKey` (`AIza…`)** appears in HTML → GitHub may alert. It is a **client** Firebase Web API key (expected in browser apps). **No change made** per user (Apr 2026): mitigate later via **API key restrictions** in Google Cloud Console (HTTP referrers) if desired; security relies on **RTDB rules**, not hiding the key.

**Post-show pull / VirtualPullBoard-style tooling (feasibility)**

- Same building blocks as **PinToPull20260402**: orders with **buyer + title** (parse `IMG ####-##`), `IMG_*_roboflow.json` boxes, board JPEGs, `pins/` crops.
- **Buyer mapping (preferred, Apr 2026):** On **Whatnot → Shipments**, use Chrome **DevTools → Network** while rows load. Capture **`graphql`** responses with **`operationName=MyShipmentsById`** (or save the whole page as **HAR with content**). That JSON includes **`buyer.username`**, **`order.id`**, and **`listing.title`** (with `IMG ####-##`). Save per show as e.g. `Show YYYYMMDD/shipments_graphql_MyShipmentsById.json` or `Show YYYYMMDD/www.whatnot.com.har`. **Still download the ledger CSV** (see **Store buy-now pull reports** below): ledger = authoritative list of sold lines and amounts; GraphQL/HAR = reliable **order → buyer** without PDF text bugs.
- **Legacy / fallback:** Shipments **PDF** + text extraction (fragile); **`buyer_overrides.json`** (`IMG ####-##` or order id → buyer) patches any missed lines when PDF parsing drops items.
- **Whatnot Seller API:** Public developer docs may mention GraphQL; browser-captured responses are enough for one-off show tooling without a formal API key.

### ClickToValidatePulledBoards20260406 (second validator run)

**Purpose:** Another catalog-match validation batch (pulled-board workflow), isolated from the first run.

| Item | Detail |
|------|--------|
| **Pages path (typical)** | `https://finsandpins.github.io/PreparingInventory/ClickToValidatePulledBoards20260406/` |
| **Firebase** | `photo_validation/ClickToValidatePulledBoards20260406` — set explicitly as `FB_BUILD_FOLDER` in `index.html`, `reports.html`, and `batch_scroll_review.html` (same pattern as the first folder). |
| **Gotcha** | A **cached** older page can still post to `photo_validation/ClickToValidate20260406`. After any `FB_BUILD_FOLDER` change, confirm the served HTML and hard-refresh so votes land in the correct node. |

**UI:** Main validator top summary aligned with batch scroll: total pins, match count, no-match count, and how many still need review.

### Pulled-board price overlays (Cursor Projects, Apr 2026)

**Example folder:** `~/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/PriceOverlayPulled20260406_rot90cw/`

- **`overlay_prices.py`:** Non-destructive pipeline: reads board JPGs + Roboflow-style `IMG_*` JSON, applies validated listing prices (from the same kind of `pending_items.json` workflow used for validation), writes **new** overlay images. Boards are rotated **−90° (clockwise)** so JSON box coordinates match the on-disk photo orientation after rotation. Price text is drawn **centered in each pin bounding box**, large **yellow** fill with **black** outline. Display amount: **at least 10**, **round to nearest 5**, **integer**, **no** currency symbol or decimals (11–12 → 10; 13–14 → 15; etc.).
- **`index.html`:** Scrollable gallery of all generated boards; **board number** and **image** identifiers at the top of each board section.
- **Related inputs on iCloud:** e.g. `Minimal folder for Claude/Output 20260406/` (Roboflow JSON), `Pulled boards 20260406/` (source JPGs). Sharing with family: send the iCloud folder or a zip; **GitHub Pages** for this gallery was left optional.

### Store buy-now pull reports (Show 20260406, iCloud)

**Folder (example):** `~/Library/Mobile Documents/com~apple~CloudDocs/Show 20260406/StorePullBoards_20260406/`  
**Venv:** `.venv` with `Pillow`, `pypdf` as needed for PDF path only.

| Input | Role |
|-------|------|
| **Whatnot ledger CSV** | Source of truth for **which** lines sold (filter rows whose `Message` contains **`IMG ####-##`**) and for **earnings / amounts**. **Download every show.** |
| **Shipments “show report” CSV** (sidebar export, e.g. `Whatnot shipments YYYYMMDD download.csv`) | Per-line **buyer** (`buyer_username`), **order** (`order_numeric_id`), **listing text** (`product_name` / `product_description` with `IMG ####-##`). Great join key to ledger; **row set can differ** from ledger when orders span **show + marketplace** or get **re-bundled** (see **Ledger vs shipments tie-out** below). |
| **`MyShipmentsById` JSON** (from HAR or Network **Copy response**) | Source of truth for **buyer** per order / line when no CSV; includes `listing.title` with `IMG ####-##` and `order.id`. **Preferred over PDF** when capturing from the browser. |
| **Shipments PDF** | Optional legacy mapper; use **GraphQL/HAR/CSV first**. |
| **`buyer_overrides.json`** | Manual map: keys `IMG ####-##` and/or `Order ID` → buyer username; fixes edge cases when PDF misses lines (GraphQL usually makes this rare). |
| **`IMG_####.JPG` + `IMG_####_roboflow.json`** | Board photo + boxes (paths wired in scripts / upload folder layout). |
| **Pin crops** (e.g. `img####_pinNN.jpg` or `pins/`) | Buyer “virtual pull” thumbnails. |

| Script | Output |
|--------|--------|
| **`build_store_pull_report_from_ledger.py`** | `storepull_pulls_only_*.html`: board photos with **green** pull boxes and **yellow** pin index badges; optional buyer name on badge when PDF map passed. Summary line: total IMG pins, sales total (integer dollars), boards shown vs skipped; per-board **“IMG #### · N pins”**. Uses **reading-order sort** on Roboflow predictions (see **Pin numbering** below). |
| **`build_virtual_pull_boards_by_buyer_from_ledger.py`** | **4th arg = shipments show-report `.csv`** (preferred): reads `order_numeric_id`, `buyer_username`, `product_name` / `product_description` for IMG lines; **ledger date** = calendar date(s) from CSV `placed_at` on those rows (or override with 7th arg `YYYY-MM-DD`). Emits **`virtual_pull_boards_by_buyer_reconcile_*.csv`** plus HTML sections listing **ledger-only** vs **shipments-CSV-only** IMG lines (key = order id + `IMG ####-##`). Skips cancelled rows. **`.har` / `.json` / `.pdf`** still work as buyer-only sources (no reconcile). **PDF gap-fill** still fills missing buyers when CSV/HAR/JSON omit an order. Images **Base64**-embedded; companion mapping CSV. |

**Shipments-only store pull (same HTML/JPEG style as ledger tool, Apr 2026)**

- **Path:** `~/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/Show 20260413/build_shipment_store_pull_boards.py`
- **Input:** Whatnot **shipments** export CSV (`buyer_username`, `product_name`, `product_description`, `original_item_price`, `product_quantity`, `cancelled_or_failed`, …). Parses **`IMG ####-NN`** from name + description; **`NN` = 1-based reading-order** pin (same `(y, x)` sort as `build_store_pull_report_from_ledger.py`), **not** raw `predictions` array index.
- **Boards:** `--boards-dir` one or more folders with `IMG_####.jpg` + `IMG_####_roboflow.json` (or `IMG_####.json`). Default when present: **`Upload to whatnot for 20260406 show`** (iCloud).
- **Output:** `--out` directory gets `annotated_boards/IMG_*_pull.jpg` + `storepull_pulls_only.html` (timestamped sibling if the HTML already exists). Open the HTML **from that output folder** so relative image paths work.
- **Contrast:** Same folder’s **`generate_whatnot_shipment_pull_sheet.py`** is the **per-line** pull sheet with a **CSS** yellow box on the raw photo; there **`NN`** is **0-based** `predictions` index for **Click To Request 20260413** parity. Pick the tool that matches how titles were authored.
- **Docs:** `Show 20260413/README_BIN_PRICING.md` § *After the show — Whatnot shipment pull*; dated notes in `Show 20260413/WORKLOG_20260410.md`.

#### Ledger vs shipments tie-out (marketplace + bundles)

- **Always download both** the **ledger** and the **shipments show report CSV** when you have **marketplace** sales mixed with the show, then **reconcile** on **`Order ID`** (ledger) ↔ **`order_numeric_id`** (shipments CSV) and on **`IMG ####-##`** parsed from message vs product text.
- **Real example (Show 20260406):** Five IMG lines were on the **ledger** but **not** in the shipments CSV—all **`processing`**, all tied to one buyer’s **bundle** after an **off-show marketplace** item was **added to the same package**. Whatnot then listed the **whole package under marketplace** instead of the show; the shipments export did not list those five IMG rows while the ledger did.
- **Practice:** After export, diff or script-check counts; any **ledger-only** IMG rows need a **manual buyer** line in **`buyer_overrides.json`** (or a refreshed shipments export once the package state catches up).

#### Script readiness (next show)

- **Ready to reuse as-is** (iCloud `StorePullBoards_20260406/`, `.venv` with `Pillow` + `pypdf`):  
  - **`build_store_pull_report_from_ledger.py`** — store pull HTML; ledger + board assets + optional PDF buyer overlay; **reading-order** Roboflow sort.  
  - **`build_virtual_pull_boards_by_buyer_from_ledger.py`** — pass **shipments show-report `.csv`** as **4th argument** for buyers + **ledger↔CSV reconcile** (extra CSV + HTML lists). Legacy **`.har` / `.json` / `.pdf`** + optional **4-arg-only** PDF auto still supported. **`buyer_overrides.json`** + PDF gap-fill for missing buyers.
- **`build_store_pull_report_from_ledger.py`** reads the **ledger** only (optional **PDF** for buyers). For **shipments CSV → same green-box board JPEGs**, use **`Cursor Projects/Show 20260413/build_shipment_store_pull_boards.py`** (see table above).

**Repeatable checklist next show**

1. Download **ledger CSV** → save under `Show YYYYMMDD/`.
2. Download **shipments show report CSV** from the Shipments sidebar → same folder; **reconcile** IMG lines and order ids against the ledger (especially if **marketplace + bundles**).
3. (Optional) On Shipments, expand rows → save **HAR with content** or **`shipments_graphql_MyShipmentsById.json`** if you want a browser capture backup.
4. Run **`build_store_pull_report_from_ledger.py`** with ledger + upload folder (boards + Roboflow JSON + crops); pass **PDF** if you want buyer names on the board badges.
5. Run **`build_virtual_pull_boards_by_buyer_from_ledger.py`**: ledger, crops root, out dir, **`Whatnot shipments … download.csv`**, **`24,20,15,14`** [, optional **`YYYY-MM-DD`** ledger filter]. Review **`virtual_pull_boards_by_buyer_reconcile_*.csv`** for ledger-only / CSV-only IMG lines; add **`buyer_overrides.json`** if needed.

### Click To Request `20260406` — Firebase claims (read-only session notes)

**No code or database changes** were made to Click To Request in this work; user constraint: do not alter CTR without explicit approval.

- **Path:** `claims/20260406` — per **pin key**, a map of **user keys** to claim objects (`time`, `label`, etc.), or legacy `true` for a single anonymous claim.
- **Counting clicks:** For each pin, count user entries with a **truthy** value; sum across pins = total **user×pin** clicks. One exported snapshot in this period: **2,080** total clicks, **702** distinct pins with at least one claim, **137** unique user keys, **0** legacy `true`-only rows.

### Toast messaging (on hold)

Planned behavior (not implemented): **during the show**, if someone requests a pin that was already in the **pre-show pull** set, show a toast that it was **already pulled** **without** exposing queue position; if the pin was **not** pre-requested, the toast may include **pin number** so they know approximate queue position. Implementation would be scoped to **`ClickToRequest20260406`** only, with review before any commit/push.

### Reference: `title_cleaner` scripts

Three variants of `title_cleaner.py` (including `title_cleaner.PinPricingModel.py`) were copied into iCloud **`Minimal folder for Claude/`** for reference. They can strip unwanted marketplace phrases (e.g. “free shipping”, “rare”) when configured.

---

## Pin Pricing Study MVP (iCloud, research)

**Path:** `~/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/PinPricingStudyMVP/`

**Purpose:** Compare eBay visual search, pHash rerank, and Gemini-keyword retrieval for pin crops; label thumbnail matches in a local HTML UI; persist labels under Firebase RTDB `pin_pricing_study/<run_id>`.

**Authoritative write-up:** **`STUDY_LEARNINGS_AND_NEXT_STEPS.md`** in that folder — 100-crop run conclusions, Firebase/eval dashboard usage, **`pin_dedupe_nms_v1`** (IoU NMS before crop numbering), Gemini fix notes, labeling interpretation (thumbnail-only), next steps, and **dated session notes** (e.g. **2026-04-10:** keyword **`buildSearchVariants`** / multi-call dedupe rationale; agreement to **discuss then test** pHash vs embedding-style matching). **Not** a shipped tool in this repo; promote to git only when Steve says it is done.

**Consumer app backlog (same folder):** **`CONSUMER_APP_TODO.md`** — product migration notes including **on-device photos** (picker + sandbox), **staged progress / demo (phone → laptop)**, harness **`--firebase-collab`**, and **click/tap pin → X overlay** to mark sold/traded and keep the collection view current (soft state + optional undo).

---

## Pin numbering and wrong highlights (important)

### Array index vs “pin N” on the board

- **Roboflow JSON** stores the **`predictions`** array in whatever order the API returns. **Board-photo upload / clip crops** (see **Canonical crop pipeline** below) assign pin numbers in **reading order**: sort boxes by **`(y, x)`** (top-to-bottom, then left-to-right), then pin **1** = index **0** after that sort, pin **2** = index **1**, etc. Listing titles use **`IMG ####-NN`** to refer to that **reading-order** index **NN**.
- **PinToPull / legacy `clicktopull`** historically maps pin **N** to **`predictions[N-1]` in file order** (no sort). That only matches listings if your pipeline **never** reordered predictions—or if the API order already matches reading order by chance.

### Canonical crop pipeline (do not break)

- **Script:** `~/Library/Mobile Documents/com~apple~CloudDocs/Cursor Projects/PinVisualSearchMVP/tools/prepare_upload_folder_clip_validate.py`  
  Companion: `roboflow_board_client.py`, `clip_index_matcher.py` (validator bundle uses **CLIP** matching; docstring says **no imgbb / eBay** for that flow—older tools may differ).
- **Behavior:** Calls Roboflow → saves **`IMG_*_roboflow.json`** (API-shaped JSON, **not** reordered on disk) → **`sort_predictions_reading_order`** by **`(y, x)`** in memory → crops **`img####_pinNN.jpg`** in that order. Example run: board folder such as **`Upload to whatnot for 20260406 show`**; output crops also land under **`PreparingInventory/…/ClickToValidate20260406/pins`** when copied/deployed there.
- **Roboflow:** Unchanged by reading-order; sorting is **local post-processing** before crop assignment. **Do not overwrite or delete** canonical Roboflow JSON as a “fix”; add **new** files if you ever need extras.

### Single sort rule vs sidecar JSON (Apr 2026)

- **Option A (recommended):** One **shared** rule everywhere: after loading predictions, **`sort` by `(y, x)`**, then pin **N** = sorted index **N−1**. Applies to **cropping**, **store pull overlays**, **price overlays** (with rotation as needed), and any future **`IMG ####-NN` → box** tool. **No second JSON required** for correctness if all tools use the same function.
- **Option B (optional):** A **sidecar** file (e.g. pin index map) is only for **human audit / diff**, not a substitute for matching the crop script’s sort—avoid two diverging implementations.
- **Nothing urgent** if cropping + store pull script already use **`(y, x)`**; **new** scripts that map listing pin numbers to boxes must use the **same** sort. Optional cleanup: extract **`sort_predictions_reading_order`** into one small shared module imported by PinVisualSearchMVP + Show pull scripts (dedupe only).

### Store pull overlays (fixed Apr 2026)

- **Bug:** `build_store_pull_report_from_ledger.py` initially used **raw** `predictions` order. Pins on the board were highlighted in the **wrong** place while **`img####_pinNN.jpg`** and the listing were correct—because crops used **sorted** order but the report did not.
- **Fix:** Before drawing boxes, apply the same ordering as cropping: **`sort_predictions_reading_order`** (`sort` by `(y, x)`), then treat pin **N** as index **`N - 1`** in **that** sorted list. This matches **`img3115_pin31.jpg`** ↔ Roboflow box for pin 31.
- **Rule for any new tool:** If **`IMG ####-NN`** comes from the **upload/crop** pipeline, **always** use the **same sort key** as that pipeline when mapping **NN** → bounding box (for pull HTML, price overlays, QA).

### Other risks

- **Mismatch:** Cropping from one API response but saving **different** JSON than the one used to number pins → wrong or shifted indices. **Mitigation:** One inference run → save **that** JSON → all downstream tools use **that** file + the **same** sort rule.
- **Pyto (iPhone):** JSON first, then crop — usually keeps order stable if numbering matches that JSON.
- **Debug:** `pin_lookup.py` (PinToPull folder) compares raw vs reading-order slot; optional `DEBUG_DRAW_PREDICTION_NUMBERS` in clicktopull for QA.

---

## ClickToClaim app behavior (reference)

- Live board UIs iterate `predictions` with **array index** as the pin key (e.g. `forEach((pin, idx) => …)`). That index must match listing numbering and ClickToPull.

---

## Click To Request `20260416` — lite mode, deploy, rollback (Apr 2026)

### What shipped

- **Developed** under `20260416_lite_test/` with Firebase **`${showDateSlug}_lite_test`** so experiments did not write to live `claims/20260416`.
- **Production** changes are **`20260416/index.html` only** (`reports.html` unchanged; it already uses `showDateSlug`).
- **Live wiring:** `const fbName = showDateSlug` — same RTDB paths as before (`claims/20260416`, `showConfig/20260416`, `feedback/20260416`). New clicks **continue** in the same tree as pre-deploy traffic.
- **Git:** deploy commit **`a8886e8`** (“lite mode + global fuel totals”). Rollback tag **`ctr-20260416-before-lite-ui`** points at **`6c10bd8`** (last good tree before lite). Restore file only: `git checkout ctr-20260416-before-lite-ui -- 20260416/index.html` → commit → push.
- **Cache busts** in that `index.html`: `BOARDS_MANIFEST_VERSION` **4**; `<meta name="ctr-countdown" content="closes-to-end-v3-lite">`.

### Product intent (confirmed)

- **Default URL** (no `?lite=1`): load **all boards** from `manifest.json` — same entry experience as before for people who tolerated full load.
- **Opt-in lite:** banner + **“tap here”** opens **`?lite=1&start=0`** (10 boards per page, prev/next, **Go back to all boards at once**). **Linktree** can keep one canonical URL; optional future IG link could deep-link straight to `?lite=1` if desired.

### Technical notes (lite)

- **Fuel / “Total requested” / spots** in lite mode: driven by the **full** flat Firebase **`claims`** snapshot (`latestClaimsData`), with **`claimsSnapshotReceived`** so an **empty** snapshot still means “zero global requests,” not “only count visible boards.”
- **Admin “Pins” total** in lite: **`computeAllBoardPinTotals`** sums every `boards/*.json` prediction count after manifest load; until `globalAllBoardPinCountReady`, totals fall back to boards currently in the DOM.
- **Queue / toast math** (`queueRankForPinFromState`, `countClaimedPinsFromState`): use the global snapshot in lite after Firebase’s first snapshot, so paging does not truncate “in line” logic.

### Adding boards mid-show (operational)

- **Append-only:** add new `IMG_*` `.JPG` + `.json`, **append** filenames to **`manifest.json`**. Do **not** rename or replace stems for boards that already have claims (pin keys are `boardStem-index`; renames misalign clicks vs images).
- After any manifest change, **bump `BOARDS_MANIFEST_VERSION`** in `index.html` again so clients refetch `manifest.json`.

### eBay Browse + proxy (Apr 2026)

- **Proxy:** `https://clicktoidentify-proxy.onrender.com` — `GET /health` → `{"ok": true}` when the service is alive.
- **Symptom:** `GET /keyword_search?…` returned **proxy HTTP 200** with JSON **`eBay keyword search failed (429)`** — eBay **Browse** body: *Too many requests / request limit reached*. That is **application throttling**, not a permanent ban.
- **Dashboard:** [developer.ebay.com](https://developer.ebay.com/) → **Application keys** → **Production** Client ID + secret for server-side calls.
- **OAuth reality:** **`client_credentials`** + scope **`https://api.ebay.com/oauth/api_scope`** is the usual **public catalog** token (matches `ClickToIdentify20260402/ebay_proxy.py`). Long **Authorization code** `sell.*` / `commerce.*` scopes on the app (e.g. **PinPricingTool**) are for **signed-in seller** flows; they do not replace the need to stay under **Browse** rate limits for image/keyword search.
- **Quota coupling:** the **same eBay application** credentials on Render **and** heavy local pricing runs **share** one throttle bucket.

### eBay Browse batch pricing (implemented — PinPricingStudyMVP)

Implemented in [`PinPricingStudyMVP/ebay_api.py`](file:///Users/steve/Library/Mobile%20Documents/com~apple~CloudDocs/Cursor%20Projects/PinPricingStudyMVP/ebay_api.py) (`EbayClient`) and wired from [`PinPricingStudyMVP/run_visual_baseline_pipeline.py`](file:///Users/steve/Library/Mobile%20Documents/com~apple~CloudDocs/Cursor%20Projects/PinPricingStudyMVP/run_visual_baseline_pipeline.py).

**CLI flags (defaults shown):**

| Flag | Default | Purpose |
|------|---------|---------|
| `--ebay-browse-min-interval-sec` | `0` | Minimum seconds between **Browse** calls (`search_by_image`, `keyword_bin_search`). `0` means no fixed pacing on the success path. |
| `--ebay-large-run-threshold` | `1000` | If crop count ≥ this **and** explicit min interval is `0`, auto-use large-run interval (unless disabled). |
| `--ebay-large-run-min-interval-sec` | `0.15` | Auto pacing for large runs (~6.7 calls/s max from spacing alone). |
| `--ebay-no-auto-large-run` | off | Disable automatic min-interval for large runs. |
| `--ebay-max-retries` | `12` | Max attempts per Browse request (429 / 5xx). |
| `--ebay-backoff-cap-sec` | `120` | Cap on a single exponential backoff wait. |
| `--ebay-circuit-429-threshold` | `10` | Consecutive **HTTP 429** responses before **circuit breaker** long pause. |
| `--ebay-circuit-cooldown-sec` | `2700` | Cooldown when circuit trips (~45 min + jitter). |

**Environment overrides** (same names, optional): `EBAY_BROWSE_MIN_INTERVAL_SEC`, `EBAY_LARGE_RUN_THRESHOLD`, `EBAY_LARGE_RUN_MIN_INTERVAL_SEC`, `EBAY_MAX_RETRIES`, `EBAY_BACKOFF_CAP_SEC`, `EBAY_CIRCUIT_429_THRESHOLD`, `EBAY_CIRCUIT_COOLDOWN_SEC`, `EBAY_NO_AUTO_LARGE_RUN=1`.

**Behavior:** honors **`Retry-After`** when present; otherwise exponential backoff with **jitter** on **429** and **5xx**; **circuit breaker** pauses the job after sustained 429s (aggressive tight retries can still lengthen eBay cooldown — defaults are conservative).

**Still backlog / ops**

- **Verify limits** in current eBay **Buy Browse** docs — do not treat chat-suggested fixed rates (e.g. “1 rps”) as authoritative without checking.
- **Optional:** separate **eBay applications** (batch vs interactive proxy) to isolate quotas if allowed by eBay and worth the ops overhead.

### Firebase snapshot (Cursor Projects)

- Example export for audit / planning: `…/Cursor Projects/fins-and-pins-click-to-claim-default-rtdb-20260416-export.json` (and possible duplicate filename with “`export 2`”). **Not** a substitute for git rollback of static HTML; **restoring** RTDB from export is a separate, deliberate process.

---

## Future product ideas (tracked in-repo)

See **`FUTURE.md`** for written-up enhancements, including:

- Cross-device pairing (username + short code).
- **“My requested pins” board** in Click To Request (personal board-style view of claims).

---

## Maintenance

- Update this file when major workflows or paths change.
- **2026-04-06:** Added pulled-boards validator, price-overlay tooling, CTR Firebase click-count notes, and on-hold toast plan (see subsections under **ClickToValidate20260406 + PreparingInventory**).
- **2026-04-07:** Documented **store buy-now pull** workflow (ledger CSV + **`MyShipmentsById` HAR/JSON** for buyers), iCloud scripts under **StorePullBoards_20260406**, **`buyer_overrides.json`**, and the **reading-order Roboflow sort** fix for correct pull highlights vs crop numbering.
- **2026-04-08:** Added **shipments show report CSV** to inputs; **ledger vs shipments tie-out** (marketplace + bundle case, five ledger-only IMG lines); **`build_virtual_pull_boards_by_buyer_from_ledger.py`** now uses **`.csv`** as primary buyer source with **reconcile CSV + HTML** (ledger-only vs CSV-only IMG lines).
- **2026-04-09:** Documented **canonical Roboflow crop pipeline** (`prepare_upload_folder_clip_validate.py`), **reading-order = Roboflow-agnostic post-process**, **single-sort vs optional sidecar JSON**, and **no urgent change** if all **`IMG ####-NN` → box** tools match the crop script.
- **2026-04-10:** **Pin Pricing study** — documented in iCloud **`PinPricingStudyMVP/STUDY_LEARNINGS_AND_NEXT_STEPS.md`**: **`buildSearchVariants`** (extra keyword searches for `#` queries), why **client-side dedupe** matters after merging responses; **agreement** to align on **evaluation goals** before building more matching automation (pHash vs embeddings vs eBay order). **Consumer backlog (same day):** expanded **`CONSUMER_APP_TODO.md`** (on-device picker + sandbox; **tap pin → X overlay** for sold/traded; **Collection state** section); **`README.md`** in that folder points there; this **`project_context`** Pin Pricing subsection links the same backlog.
- **2026-04-15:** **Click To Request `20260416` lite mode** shipped in `20260416/index.html` (commit **`a8886e8`**, rollback tag **`ctr-20260416-before-lite-ui`**). **eBay** proxy health OK; Browse **`keyword_search`** observed **429** throttling — see **Click To Request `20260416` — lite mode, deploy, rollback** and **eBay Browse batch pricing (implemented)** above.
- **2026-04-17:** **PinPricingStudyMVP** — Browse **`search_by_image` / `keyword_bin_search`**: **`Retry-After`**, jittered backoff, optional min interval, large-run auto pacing (default ≥1000 crops → 0.15s spacing), circuit breaker on sustained **429**; flags + `EBAY_*` env documented under **eBay Browse batch pricing (implemented)**.
- Dated Firebase backups may appear as `firebase-rtdb-backup-*.json` (often gitignored).
