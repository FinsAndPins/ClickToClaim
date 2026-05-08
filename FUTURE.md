# Future development

Ideas and planned enhancements for Click To Request (and related tools). Not committed to a release date.

---

## Session log — 2026-05-04 (`20260504` show bundle)

**Shipped**

- **Full-screen “show’s over” layer** (`#showEndedOverlay`, `z-index` above modals) driven by Firebase **`showConfig/<YYYYMMDD>/endedFullscreen`**: **`true`** when admin taps **Post Show** on boards or Reports; **`false`** on **Schedule**, **Pre-Show**, or **During Show** (same writes as the existing phase bar).
- **Content:** HTML + CSS using existing CTR tokens (`--fp-bg`, `--fp-chunk`, `--fp-text`, `--fp-muted`) — not a static photo — so **Whatnot** and **Instagram @Fins.And.Pins** are real links; copy stresses **Mondays & Thursdays · 12 noon EST · Whatnot**.
- **Layout evolution:** Social icons + message card wrapped in **`.show-ended-stack`** (max-width 520px); overlay uses **`justify-content: center; align-items: center`** so **Mac / iPad / iPhone** all center the block; **`white-space: nowrap`** on **`12 noon EST`** fixes orphan **EST** on narrow phones.
- **`reports.html`:** Same four phase buttons under **Show window** so you can clear **`endedFullscreen`** when the boards page is fully covered (admin-only page).

**Learned**

- **PNG splash:** Sharp on one screen but awkward cross-device; hard to edit copy (e.g. missing Whatnot). **HTML overlay** wins for accessibility, links, and iteration.
- **Flex pitfalls:** Icons at top + **`flex: 1`** main with **`justify-content: flex-start`** left odd vertical gaps; **`justify-content: center`** on the overlay without a single centered **stack** made iPad/Mac look **left-aligned** (`width: 100%` child filled the row). Fix: one wrapper column centered as a unit.
- **Keyword search “broken”:** Often empty results + long proxy cold-start — looks like a spinner hang; retry / wait helps.

**Git anchors (if reverting or diffing)**

- Photo-era splash + social-on-overlay (before HTML message): **`214fa38`** (includes `show-ended-splash.png`, later removed).
- HTML message, no PNG: **`32e38d1`**.
- Centered stack layout: **`e0f1c8d`**.

---

## Session log — 2026-05-06 (`20260507` boards)

**Shipped**

- **More boards** for live **`20260507`**: added **`IMG_*`**.**`JPG`** + matching **`.json`** under **`20260507/boards/`**, updated **`manifest.json`**, bumped **`BOARDS_MANIFEST_VERSION`** to **`6`** in **`index.html`** and **`reports.html`** (must match).

**Learned**

- **`manifest.json` must be strict JSON** — a **trailing comma** after the last array element breaks **`fetch(...).json()`** in the browser and the show page stops loading boards until fixed.
- **`reports.html`** had fallen behind **`index.html`** on **`BOARDS_MANIFEST_VERSION`** before this round; out-of-sync versions mean Reports can silently use a **cached older manifest**.

**Git anchor**

- Boards + manifest fix + version sync: **`9f4e48d`**.

---

## Session log — 2026-05-08 (ClickToCollect detection + local character-training prep)

**Shipped / recorded (app — `ClickToCollectApp` `main`)**

- **Deferred “second pass” false positives (stars / specks / huge edge boxes):** iterative tightening on **`PinBoxPostProcessor`** and **`DeferredBoardDenseScanService`** — higher non-dense tile confidence, per-tile **top‑K** clamp, deferred-only pixel-size confidence ramps and edge-hugging huge-rect drops, with **DEBUG** drop-reason logging. Earlier pass added shared post-processing for viewport + deferred paths. Commits include **`6eb9f4c`**, **`aaebe81`** (see app repo history for exact diffs).
- **Build fix:** **`PinBoxPostProcessor.swift`** — **`import Foundation`** for **`String(format:)`** (Swift 6 / strict module visibility).

**Recorded (local — Cursor Projects, not the app repo)**

- **`TrainCharacterDetector/labeler/` — cluster labeler:** seed palette from **`TopCharacterLabels.txt`**; **live autosave** to a user-picked **`labels_autosave.csv`** (File System Access API + IndexedDB handle, debounced writes); fixed **assign shortcut buttons** storing `"4  Mickey"` instead of **`Mickey Mouse`**; progress bars show **crop counts** where possible; **`README_LABELING.md`** updated. Starter file **`labels_autosave.csv`** (header only). **`python` vs `python3`:** pyenv users may need **`python3 -m http.server`** for the local server one-liner.

**Learned (character / set labeling for future classifiers)**

- **CLIP clusters often follow “set” or shape language** (e.g. ducks, castles), not a single character — labeling a **mixed** duck cluster as **one** character poisons a **character-ID** model. Leave mixed clusters **unlabeled** or split/re-cluster until homogeneous.
- **Single-label character training:** for **Mickey+Minnie** on one pin, pick a **primary** subject or defer; **multi-label** is valid only if the **training objective** and loss are multi-label end-to-end — don’t mix arbitrarily.
- **Set-centric vs character-centric** are **different tasks** — see **Set-centric pin / series classification (future)** below.

---

## Set-centric pin / series classification (future)

**Intent (product / ML):** A **separate** labeling and model path from **character identity**. Examples: **duck-series mold**, **castle / frame**, **Loungefly silhouette**, **Snack Attack** lineup, etc. — orthogonal to “this pin is primarily **Stitch** vs **Donald**.”

**Why separate:** Users may want **both** signals (character + series shape), but a single softmax head forced to choose one collapses orthogonal attributes; training **“everything duck-colored ⇒ Stitch”** breaks character IDs.

**Direction when prioritized**

1. **Taxonomy:** Define stable **series / shape / set** labels (small curated list at first).
2. **Data:** Same crop pipeline (`crops/` from detector); labels may overlap **characters** — use **multi-label** or **two lightweight heads** (character + series) if both ship in-product.
3. **UX:** Tie into **ClickToIdentify** / in-app suggestions only after thresholds feel safe; optional second pass like today’s deferred detection (fast first, refine later).

**Explicitly later than:** first shipped **character** suggestion loop (needs clean per-character crops first).

---

## Post Show thank-you page (admin) — extended mockup / QR (optional)

**Shipped May 2026 (minimal path):** On **`20260504/index.html`**, **Post Show** turns on a **full-screen overlay** with thank-you copy, schedule line, Whatnot + Instagram links, and social icon row — see **Session log — 2026-05-04** above. **`reports.html`** mirrors the phase buttons so admins can turn the overlay off.

**Still optional (original mockup):** A **separate** page matching the **May 2026** visual: soft gradient, **frosted** card, **QR code** in the center (“Scan… socials”), if you want that in addition to or instead of the overlay someday.

**Implementation notes if you add it later:** Keep paths **relative** under `/ClickToClaim/<show>/`; host QR under `boards/` or `icons/`; optional query param to reuse one HTML across shows.

---

## Cross-device “My requests” (username + short pairing code)

**Goal:** Let someone see the same pin selections on a second phone or tablet without losing their queue, using their whatnot username plus a short code tied to their existing anonymous id.

**Proposed flow**

1. **First device (unchanged core):** User enters their whatnot username as now. The app already stores a random `fp_identity` in `localStorage` and uses it as the Firebase user key under each pin.
2. **Surface a short code:** Show the **last 4 characters** (or digits) of that identity next to their username in the UI so they can write it down or remember it.
3. **Second device:** On the login screen, add something like **“I already set this up on another device”** → prompt for **same username** + **4-character code** → look up or reconstruct the pairing so the app uses the **same** underlying identity as the first device (same Firebase paths as before).

**Thoughts / design notes**

- **Fits the current model:** Claims are already stored per `identityKey`; the missing piece is letting a new browser adopt an existing key instead of always minting a new one.
- **You’ll need a lookup or verification step:** Today only the **full** sanitized key appears in Firebase paths. Options include (a) storing a small `devices/{sanitizedKey}` or `pairing/{shortCode}` map in RTDB (written once from device A), (b) deriving the key deterministically from username+code (usually weaker), or (c) a short-lived server/Cloud Function that validates code and returns the canonical key—stronger, more work.
- **Security / abuse:** A 4-character code from a limited alphabet has a small space; anyone who guesses username + code could impersonate that viewer. Mitigations: longer code (e.g. 6–8), rate limits, short expiry for pairing, or “confirm on first device” if you add push/email later. For a low-stakes show tool, you may accept the risk with clear UX (“treat this like a PIN”).
- **UX detail:** Normalize username the same way on both devices (e.g. `@handle`, case rules) so pairing doesn’t fail on typos.

---

## “My requested pins” board (in Click To Request)

**Goal:** After someone has requested pins on the live show, show them a **personal board view**: all pins they claimed, similar to pack-out “virtual board” tooling but **organized like real board photos** (per `IMG ####` sections / grid), not only a flat buyer list.

**Building blocks (already in the ecosystem)**

- Firebase claims keyed per show / pin / user (`claims/...`), same identity model as today.
- Board **`IMG_<board>.jpg`** + **`IMG_<board>.json`** (`predictions` boxes); geometry matches ClickToPull / cropping tools.

**Sketch**

1. For the logged-in user, aggregate claim keys for the current show → list of `(board, pin index)` (or whatever the app uses today for `pinKey`).
2. For each board they touched, either:
   - **Collage:** crop each box (same as `build_virtual_pull_board.py` style) and lay out tiles **grouped by board** with board header / aspect like your photos, or
   - **Annotated full board:** reuse ClickToPull-style overlay but only their pins highlighted.
3. Surface behind a clear CTA (“See my pins”) from the logged-in area or post-show summary.

**Note:** Pin index must stay aligned with the **same JSON artifact** used when numbering listings (see `project_context_cursor.md` — avoid re-inference changing `predictions` order).

---

## Pin visual search — crop quality and matching (PinVisualSearchMVP)

**Goal:** Incrementally improve CLIP matching quality without changing the overall CSV-gated database workflow.

**CLI / pipeline knobs (implement when needed)**

- **`--crop-jpeg-quality`** on `prepare_upload_folder_clip_validate.py` (today hard-coded **92** on `crop.save`). Allow **95–98** or document a one-line change for experiments.
- **`--crop-format`** (JPEG vs **PNG**) for saved board crops; trade disk size vs lossless crops before CLIP’s internal resize.
- **`--roboflow-thumb-max`** is already exposed (default **1280**); document tuning (**1600–2048**) for dense boards so detection boxes are sharper—often higher ROI than JPEG quality alone.
- **`--padding-frac`** tuning notes in REFERENCE or tool help: more padding can include pin edges; too much adds background noise for CLIP.

**Larger follow-ons**

- Optional **stronger vision encoder** (larger CLIP or other embedding model): requires rebuilding `clip_embeddings.npy`, updating `clip_index_matcher` / Space, and re-benchmarking latency on CPU.

**Reminder:** Crops are already cut from **full-resolution** board photos; only the **Roboflow request** is downscaled. Biggest wins are usually **better boxes** and **consistent lighting** vs catalog images, not raw megapixel count.

---

## Character tagging model (ClickToCollect)

**Goal:** Build and ship our **own character / pin-subject tagging** model—trained on labeled pin crops—so ClickToCollect can suggest consistent tags, improve collection search, and support future Labs or pricing flows without relying solely on generic off-the-shelf taggers.

**Direction (non-binding)**

- Start from **curated manifests** (e.g. image path or URL + label); define taxonomy rules (single character vs multi-character vs place/theme) and **label normalization** before training.
- Prefer **fine-tuning** a compact vision classifier or embedding head over training from scratch; choose **on-device inference** vs a small **hosted model** from latency, binary size, and how often you want to refresh weights.
- Treat **rights and licensing** for training images the same way you treat any customer or show-derived media you do not own outright.

**On-device import timing:** Wall-clock import comparisons for **old vs new model** builds (with pins/s and run-protocol notes) live in `detection_eval/ON_DEVICE_IMPORT_BENCHMARKS.md`.

---

## Overlapping regions across multiple board photos (ClickToCollect) — v2 / v3

**Vocabulary:** In the app, a **Board** is one **photo** of many pins (often on a PinFolio-sized panel). In the field, a collector may call **“the board”** a **large wall** made of several cork or PinFolio panels. They take **multiple photos of different regions** of that wall; **overlapping frames** are common.

**Problem (Lexi use case):** The **same physical pin** appears in the overlap between two (or more) **Board** photos. Detection + collection import can create **separate pin records** for that one pin—not because the pin is a duplicate design, but because it was captured twice across photos. This is **cross-photo overlap**, not primarily “double boxes on one image.”

**Constraint:** Prefer **on-device** processing; **no internet** required for this flow.

**Product direction (agreed in principle):** Help the user **clean up redundant coverage** rather than pretending homography will auto-merge everything on day one.

- **Primary fix:** On the “secondary” photo(s), **remove the detection boxes** (and thus collection entries) for pins that belong to the overlap, keeping the **canonical** instance on the photo that should “own” that region.
- **Optional:** **Crop** the board image so pins that were removed from the data are no longer visible—stronger visually, but touches assets (reversible workflow should favor **box removal first**).
- **UX:** **Review + accept** only—no silent deletes. Consider scoping as **Settings / Advanced** or **Labs** until defaults feel safe.

**Implementation tiers (time vs payoff):**

- **v2 (proportionate):** **Manual or semi-guided** flow: user picks **two boards** (or a “same wall session”) and marks **which photo is secondary**, then **multi-selects pins/boxes to remove** (or region-based selection later). No requirement for automatic overlap detection in the first version.
- **Enhancement:** **Cheap hints** only if they help—e.g. boards imported within **N minutes**, or user-flagged **“same wall”** grouping—then run **visual duplicate suggestions** (embeddings) **restricted to that group** to speed review. Still not proof of geometric overlap.
- **v3 (heavier):** **Geometry** (feature matching / homography) to **paint overlapping regions** and suggest redundant boxes—higher engineering and QA cost; defer until manual workflows prove the need.

**Explicit non-goal for early versions:** Full **cloud** embedding catalogs, PinPics-scale retrieval, or **automatic** merge without confirmation.

---

## More ideas (placeholder)

_Add additional bullets here as you go._

- **eBay batch / pricing resilience:** **implemented** in **PinPricingStudyMVP** (`ebay_api.py` + `run_visual_baseline_pipeline.py` flags / `EBAY_*` env). See **`project_context_cursor.md`** → **eBay Browse batch pricing (implemented)** and the same file’s **eBay Browse + proxy** notes for quota coupling with the Render keyword proxy.

- **ClickToCollect → priced JSON in-app (post–Option 1):** Optional small **HTTPS bridge** (or hosted service) that runs the **same** Python pipeline server-side and returns **`candidates.json`** for merge into Labs sessions; **app never holds eBay root credentials**. Until then, **Option 1** (MacBook pipeline + import folder with JSON + `crops/`) remains the supported path for Lexi + Steve (see **`project_context_cursor.md`** → **ClickToCollect — value pricing handoff**).
