# Future: CTR leftover roll-forward + productizing Script A/B

**Status:** Plan / product notes only. Do **not** implement yet (Steve 2026-09-28 evening).  
**Related:** Script A/B Whatnot flow; live show CSV analysis; deferred BIN requester notify.

## Internal cadence (Fins & Pins)

### Intent

Each CTR show has two sections:

1. **New boards** (front of manifest): need detect + pricing + Script A VLM.  
2. **Leftover boards** (back of manifest): copied from the **prior show’s new section only**, with **sold overlays** from Whatnot sales, keeping existing `crop_stem` / pricing / crop URLs.

Do **not** consolidate leftover pins onto newly photographed boards (that forces reprice and breaks stem joins).

### Today’s special case (20260928 → next show)

As far as CTR was concerned, all boards were “new” because pricing was re-run. Only **boards 1–42** should roll into the next CTR leftover section. Boards 43–66 were already prior leftovers and should not roll again under this cadence.

Going forward, each show should record (config or short note Steve provides):

- `new_board_range` (e.g. 1–30)  
- `leftover_board_range` (e.g. 31–72)  
- `leftover_source_show` + source new-board range  

Only the **new** range rolls to the next show’s leftover section.

### Shop sales between shows

Pins stay in the Whatnot shop and can sell before the next CTR. Before leftover pack / Script A for the next show, download a **fresh Whatnot sales/shipments report** (in addition to the live-show export) and union sold stems so those pins are marked sold / excluded from the CSV.

### Username / `Requested by:` on leftover pins (open product choice)

When a leftover pin appears in the next show’s Whatnot CSV:

| Policy | Behavior |
|---|---|
| **A. Current show only** | Only Thursday CTR clickers |
| **B. Merge prior + current** | Union handles from prior show claims/CSV and new CTR claims; dedupe |
| **C. Prior only until new clicks** | Carry prior names until someone clicks in the new show |

**Lean recommendation:** **B (merge, dedupe, cap length)** for leftovers. Prior clickers are still warm leads; new clickers matter too. Script B near showtime refreshes current-show claims and re-merges with a saved prior-request snapshot for leftover stems. New boards stay current-show-only.

### Script A/B shape (when built)

- Dual pricing source: new run + prior run; VLM only new stems; reuse prior character map for leftovers.  
- Keep leftover `crop_stem` and board filenames stable; board **numbers** come from next manifest order.  
- Exclude sold stems from live + interim shop reports.

---

## Productization (other sellers, fee later)

Script A/B (characters after pricing; username refresh near showtime) and leftover roll-forward could be offered to other resellers with **simple customization**, not a bespoke agent every week.

### Principles

- One repeatable pipeline; seller fills a small config (show id, board ranges, pricing run ids, brand strings).  
- No requirement that they use Fins & Pins Firebase project long-term (multi-tenant later).  
- Clear success definition: CSV row contract + image URL checks (same as WhatnotUploadRunner lessons).

### Leftover roll-forward as a product feature

Sellers need a **simple way to define which boards roll** and how sold is applied, e.g. a show config block:

```json
{
  "show_id": "20261002",
  "new_boards": { "from": 1, "to": 30 },
  "leftover_from": {
    "show_id": "20260928",
    "boards": { "from": 1, "to": 42 },
    "sales_reports": [
      "live-export.csv",
      "shop-sales-since-show.csv"
    ]
  }
}
```

**How we might do that (sketch only):**

1. **Config UI or YAML/JSON** the seller edits once per show (board ranges + paths to sales CSVs).  
2. **Roll-forward tool** reads prior CTR `boards/` for that range, builds sold-stem set from all listed sales files (Board/Pin or crop stem), writes next show leftover pack + sold mask.  
3. **CTR builder** appends leftover boards after new boards; marks sold pins unclaimable.  
4. **Script A (mixed)** merges pricing sources per config; seller does not hand-edit stems.  
5. Optional: preset “only roll boards tagged new in prior show” so they do not re-roll leftovers forever.

That is the productized version of what Fins & Pins wants internally: declare ranges + drop sales files, get a correct next CTR + CSV without moving pins on foam boards.

### Other customization knobs (later)

- Title prefix / RELY ON PHOTO text  
- Price rounding rules  
- Offerable true/false  
- Character VLM on/off for leftovers  
- `Requested by:` policy: current / merge / prior  

---

## Do not do yet

- No production CTR/pricing watcher changes.  
- No Script A/B dual-source implementation until Steve asks for the next-show build.  
- No multi-tenant billing/auth work until product direction is firm.
