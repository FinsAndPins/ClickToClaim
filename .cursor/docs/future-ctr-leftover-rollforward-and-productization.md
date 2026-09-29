# Future: CTR leftover roll-forward + productizing Script A/B

**Status:** Plan locked for next show; **do not implement until Steve says go** after new photos + marketplace sales CSV.  
**Related:** Script A/B Whatnot flow; live show CSV analysis; nest-suppress trial 20261001; deferred BIN requester notify.

---

## RESUME HERE (bookmark)

Paste this into a new agent / next chat when ready:

> Resume CTR leftover roll-forward for show **20261001**. Read `.cursor/docs/future-ctr-leftover-rollforward-and-productization.md` (Locked decisions). Do not implement until I drop new board count + marketplace sales CSV in Cursor Projects and say go. Leftovers = 20260928 boards **1–42** only; no detect/pricing/nest-suppress on leftovers; merge Requested-by from 20260928 claims + 20261001 claims; sold = live export ∪ shop sales CSV; one-generation only (no third CTR; BIN clone OK).

Also mirrored under Cursor Projects:  
`Show20260928_Whatnot/RESUME_leftover_rollforward_20261001.md`

---

## Locked decisions (2026-09-28 night)

| Topic | Decision |
|---|---|
| Next show id | **20261001** |
| New board count | TBD tomorrow afternoon (when photos done) |
| Roll set from 20260928 | Boards **1–42 only** (not 43–66) |
| Requested by (usernames) | **Merge:** all clickers from 20260928 CTR (including after Script B / after 1:30pm) **plus** new clickers on 20261001. Dedupe. New boards = 20261001 claims only. |
| CTR post-show | 20260928 is in post-show (no more clicks). Use full Firebase `claims/20260928` (or export) as the prior-username snapshot. |
| Click rules next CTR | Unsold leftover pins **clickable**. **NaP** and **sold** not clickable. |
| Sales inputs | Live show export (have) + **marketplace/shop sales CSV** in Cursor Projects before build |
| Lexi reprice leftovers | Not expected; Steve will say if that changes → keep Monday prices |
| Nest-suppress / detect / pricing | **New boards only.** Leftover boards 1–42 keep **current box coordinates**; no RF-DETR, no nest-suppress, no reprice on leftovers |
| One-generation rule | Roll into **next show only**, not a third CTR. Further sell-through via **clone listings into Buy Now / shop**, not another CTR pass (may revisit) |
| Implement now? | **No.** Sequence below. |

### Recommended sequence (agree)

1. Finish / count **new** board photos (tomorrow afternoon).  
2. Download latest **marketplace/shop** Whatnot sales CSV → Cursor Projects.  
3. Finalize plan with board count + sold union.  
4. **Then** say go: build leftover pack + drop new photos to CTR watcher (or staged build).  
5. Price **only** new boards; mixed Script A later.

Do **not** drop new photos into the CTR watcher for 20261001 until leftover pack + sold mask plan is finalized (avoids a half-built show).

---

## Internal cadence (Fins & Pins)

### Intent

Each CTR show has two sections:

1. **New boards** (front of manifest): need detect (+ optional nest-suppress) + pricing + Script A VLM.  
2. **Leftover boards** (back of manifest): copied from the **prior show’s new section only**, with **sold overlays** from Whatnot sales, keeping existing `crop_stem` / pricing / crop URLs / box JSON.

Do **not** consolidate leftover pins onto newly photographed boards (that forces reprice and breaks stem joins).

### 20260928 → 20261001

- Source leftovers: **20260928 boards 1–42**.  
- 43–66 stay out of next CTR (BIN/shop clone path if still selling).  
- Record on 20261001 when built: `new_board_range`, `leftover_board_range`, `leftover_source_show=20260928`, `leftover_source_boards=1-42`.

### Shop sales between shows

Union sold stems from:

1. Live show export (e.g. `live-01065a3c-….csv`)  
2. Later marketplace/shop shipments/sales CSV in Cursor Projects  

Mark sold on CTR leftovers; exclude from Whatnot leftover CSV rows.

### Username / `Requested by:` (locked: merge)

For leftover stems in the next CSV: union handles from prior show claims + current show claims; dedupe; cap length if needed. Capture **full** 20260928 claims after post-show (includes late clicks after 1:30pm / after Script B).

### Script A/B shape (when built)

- Dual pricing source: new run + Monday run; VLM only new stems; reuse Monday character map for leftovers.  
- Keep leftover `crop_stem` and board filenames stable; board **numbers** from 20261001 manifest order.  
- No object detection / nest-suppress / pricing pipeline on leftover boards.

### Attention / revenue note (Steve)

Hypothesis under test: more CTR pins may not raise revenue, only time-on-show. Prefer one leftover generation in CTR, then BIN/shop for further sell-through. Revisit if data says otherwise.

---

## Productization (other sellers, fee later)

Script A/B and leftover roll-forward could be offered to other resellers with **simple customization**.

### Principles

- Repeatable pipeline; seller fills config (show id, board ranges, pricing run ids, brand strings).  
- Clear success definition: CSV contract + image URL checks.

### Leftover roll-forward as a product feature

Example seller config:

```json
{
  "show_id": "20261001",
  "new_boards": { "from": 1, "to": 30 },
  "leftover_from": {
    "show_id": "20260928",
    "boards": { "from": 1, "to": 42 },
    "sales_reports": [
      "live-export.csv",
      "shop-sales-since-show.csv"
    ],
    "requested_by_policy": "merge_prior_and_current"
  }
}
```

**How we might do that (sketch only):**

1. Config UI or JSON the seller edits per show.  
2. Roll-forward tool: prior CTR boards in range + sold set from all sales files → leftover pack + sold mask.  
3. CTR builder appends leftovers after new boards; NaP/sold unclaimable.  
4. Script A mixed merge per config.  
5. Preset: only roll boards tagged “new” in prior show (one-generation default).

---

## Still open (nice to confirm later, not blocking bookmark)

- Exact filename pattern Steve will use for shop sales CSV.  
- Whether 20261001 nest-suppress trial LaunchAgent stays swapped in for **new** boards only (trial detect path).  
- BIN clone workflow for boards 43–66 / unsold after one CTR leftover pass (process, not code yet).

## Do not do yet

- No leftover pack build until new board count + shop sales CSV + explicit go.  
- No production pricing watcher changes.  
- No multi-tenant billing/auth.


---

## Auto-detect leftovers by prior CTR filename (idea, 2026-09-28)

Steve ask: can the pipeline infer leftover vs new so he does not have to declare board ranges?

**Yes, mostly.** Treat a dropped board as leftover if its **board stem** (`IMG_0440`, etc.) already exists in the **immediately prior CTR** `boards/manifest` (or boards folder). Then:

- Skip RF-DETR / nest-suppress / pricing for that stem.  
- Copy prior box JSON + crop_stem join as-is.  
- Apply sold overlay from live + shop sales CSVs keyed by crop_stem / Board+Pin.  
- Everything else in the drop = new (run detect + price).

### Caveats

- **Filename stability:** leftovers must keep the same `IMG_####` names when re-dropped or copied into the next show. Renaming breaks auto-detect.  
- **Which prior show?** Default = previous dated CTR folder (or `leftover_source_show` override if two shows overlap).  
- **First-run vs second-run leftovers:** If 20260928 boards 43–66 were already leftovers, their stems also appear in an older CTR. Auto-detect alone cannot know “only roll one generation into CTR.” Need either: (a) only compare to **immediate prior** show and only roll stems that were in that show’s **new** section (requires tagging new stems at build time), or (b) a simple allow/deny list. Practical hybrid: auto-detect “seen in prior CTR” for skip-OD/pricing, plus a stored `new_stems_20260928.json` so only those stems are eligible to appear as CTR leftovers next time.  
- **Empty / wrong prior:** fail closed (treat as new and warn) rather than silently skip pricing.

### Productization

Seller config can default to `leftover_detect: prior_ctr_filenames` with optional `only_stems_tagged_new_in_prior: true`.

---

## Whatnot “Clone” tag for BIN/shop roll-forward (idea, 2026-09-28)

CTR leftover lane ≠ Whatnot inactive→next show clone lane.

Steve’s Whatnot flow: after a show, Buy Now goes inactive; filter by upload date; add to next show (Whatnot excludes already sold). Hard part: distinguishing **second-chance leftovers** (e.g. Mon 43–66 / items not getting another CTR pass) from **new** listings uploaded the same day.

**Locked (Steve 2026-09-28):** put **`fpclone`** in **Description** (not Title; not SKU) at Script A/CSV build time for the BIN/second-chance cohort only.

Then after the show: filter inactive by upload date **and** description contains `fpclone`, clone only those into the next show. Steve verified inactive search matches Description; SKU is not a reliable/visible search field; BoardNN works in Buy Now but not Sold.

### Thoughts

- **Good:** matches how Whatnot UI filtering works; no extra spreadsheet.  
- **Title stays clean** (`Board NN Pin N RELY ON PHOTO`); ops token lives in Description.  
- **`fpclone`** is distinctive enough to avoid accidental matches on normal words like “clone.”  
- **Do not** put `fpclone` on first-run boards that will appear in next CTR leftovers (1–42 lane); only on the cohort you will **not** put in CTR again.  
- Script A config: `bin_clone_tag: "fpclone"` for `bin_only_board_range`.

