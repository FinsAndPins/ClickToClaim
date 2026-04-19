# Future development

Ideas and planned enhancements for Click To Request (and related tools). Not committed to a release date.

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

## More ideas (placeholder)

_Add additional bullets here as you go._

- **eBay batch / pricing resilience:** **implemented** in **PinPricingStudyMVP** (`ebay_api.py` + `run_visual_baseline_pipeline.py` flags / `EBAY_*` env). See **`project_context_cursor.md`** → **eBay Browse batch pricing (implemented)** and the same file’s **eBay Browse + proxy** notes for quota coupling with the Render keyword proxy.
