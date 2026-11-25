# Shared approach — eBay title → keep slots (for Shopify / Whatnot / other agents)

**Status:** Round-1 experiment proven useful on 50 titles from the 20261123 pricing run.  
**Repo path:** `EbayTitleSlotExtract_20261123/` on ClickToClaim `main`.  
**Do not** wire into production pricing watchers or PrepareClickToClaim unless Steve says **SHIP TO PRODUCTION**.

---

## What this does (and does not)

| Owns | Does **not** own |
|---|---|
| Rest of useful listing text: **set**, **maker**, **park/event** | **Character** and **movie/franchise** (Script A / existing character pipeline) |
| Drop / quarantine of dangerous tokens | Prices, Shopify inventory IDs, image crops |
| Text **LLM** on the matched eBay **title** only | VLM / looking at the pin photo |

Input is the matched listing title (same source as CTM/CTP `selected_candidate.title` / listing title). No pin image required.

---

## Output buckets

| Bucket | Fields | Goes into customer-facing title/description? |
|---|---|---|
| **keep** | `set`, `maker`, `park_or_event` | **yes** (combine with Script A character/movie) |
| **quarantine** | `le_size`, `is_chaser`, `is_mystery`, `year` | **never** |
| **drop** | fluff + physical/channel stamps | **never** |

### Hard excludes (current list)

Never put these in keep or in the assembled description string:

- **LE size** (e.g. LE 300, LE 1500) and year tokens
- **Chaser**, **Mystery** as flags (also strip those words from description even if they appear inside a set name)
- **AP** (Artist Proof), **PP** (Pre-Production / Proof) — back stamps on a specific physical pin
- **Cast Exclusive** / **Cast Member Exclusive** / **CME** — cast channel; our pin may not be that copy
- Chooser / sales fluff: you choose, pick, free shipping, rare, HTF, NIB, opened, New/box, seller SKUs, etc.

Wrong keep fact is worse than empty.

---

## Assembled description candidate

Order: `set` + `maker` + `park_or_event` (dedupe identical tokens; strip excludes).

Examples from Round 1:

| eBay title (short) | `description_candidate` |
|---|---|
| … Parking Pass Blind Box … R-2007 | Parking Pass Blind Box |
| WDI … aDorbs! … LE 400 | Adorbs WDI |
| 2025 … Reflections … AP LE 1500 | Reflections |
| … WDW Tiana's Bayou … LE 550 YOU CHOOSE | Tiana's Bayou Attraction Puzzle WDW |
| WDI/MOG aDorbs! … Cast Exclusive … LE 300 | Adorbs WDI/MOG |

Character/movie are added by Script A separately (e.g. `Character · Maker · Set` or whatever the Shopify title template is).

---

## Frozen prompt

Use `prompts/extract_v1.txt` in this folder (or copy it into the Shopify project). Prefer a cheap text model (Gemini Flash / GPT-4o-mini). Temperature 0. JSON only.

Runner reference: `scripts/run_extract.py`  
Sanitizer + scorer: description must have **quarantine/exclude leak rate = 0**.

---

## Data / review artifacts

| File | Use |
|---|---|
| `reports/review_dev.csv` | Human review — columns lead with `ebay_title`, `description_candidate` |
| `reports/extract_dev_llm.json` | Full predictions |
| `data/dev_50.json` / `holdout_50.json` | Stratified sample; holdout sealed until scorer frozen |
| `prompts/extract_v1.txt` | Frozen extract prompt |

Source pricing run for the pilot:  
`test_PriceCollection_20261121_2225__build_20261123_fullres_visual_baseline`

---

## Paste-ready prompt for Shopify agent

Copy everything in the block below into the Shopify agent chat (`bc-01a10e43-f7f2-76cf-9f26-7b92c555c22a` or successor):

```
Read and follow ClickToClaim repo file:
EbayTitleSlotExtract_20261123/SHARED_TITLE_SLOT_APPROACH.md
Also use the frozen prompt at:
EbayTitleSlotExtract_20261123/prompts/extract_v1.txt

Goal: For our ~3000-pin Shopify upload, build customer-facing titles/descriptions from matched eBay listing TITLES using this text-LLM slot approach (not VLM).

Hard rules:
1. Do NOT invent character or movie — reuse Script A / existing character+movie fields we already have.
2. Extract only keep slots: set, maker, park_or_event from the eBay title text.
3. NEVER put into Shopify title/description: LE size, year, Chaser, Mystery, AP, PP, Cast Exclusive / Cast Member Exclusive / CME, you-choose/picker fluff, seller SKUs.
4. Wrong fact worse than empty. Prefer omit over guessing.
5. Do not change production pricing watchers, PrepareClickToClaim, or ClickToClaim show folders unless I explicitly say SHIP TO PRODUCTION.
6. New work only under your Shopify project folder (or a new experiment folder). Do not edit EbayTitleSlotExtract_20261123 except to read it.

DoD:
- One row per pin with: ebay_title, script_a_character, script_a_movie, keep fields, description_candidate (or Shopify title built from character + keep), drop/quarantine fields.
- Quarantine/exclude leak rate into description_candidate = 0 (spot-check AP/PP/Cast Exclusive/LE#).
- Sample 20 rows for my review before writing all ~3000.
- Paste verification: counts, 5 example titles before/after, leak count.

If the Shopify title template differs from Whatnot, say how you mapped keep slots into that template — do not silently invent a new format.
```

---

## Other exclude words Steve may want next

Not yet enforced as hard excludes (except where noted). Worth reviewing on a 20-pin sample before locking:

| Candidate | Why |
|---|---|
| **LR** / Limited Release | Channel/edition label; similar to AP — often not on our copy |
| **Artist Proof** / **Preproduction** / **Proof** / **Sample** spelled out | Same as AP/PP |
| **Fantasy** / **Fantasy Pin** | Not official Disney; may be wrong for store policy |
| **Opened** / **loose** / **no box** | Condition of seller’s pin |
| **In Hands** / **Ready to ship** | Seller logistics |
| **Booster** / **Blind Bag** vs Blind Box | Confirm whether you want product-line words kept |
| Park acronyms on chooser lots | Title may list many parks; prefer omit if ambiguous |
| Numeric pin / SKU codes (`#55282`, `130930`, `R-2007`) | Seller inventory — already usually dropped |
| **DEC** / **WDCS** / **TWDCS** when used as collection codes | Keep only if you want them as maker; otherwise drop |
| **BoxLunch** as retailer | Sometimes retailer, not maker — decide keep vs drop |
| Anniversary counts (`25th`, `60th`) | Useful set signal vs noisy — taste call |

Do **not** exclude real makers (WDI, MOG, DSSH, Loungefly, PALM, …) or real set names (Adorbs, Stamp, Reflections, …) unless a sample shows systematic wrong matches.
