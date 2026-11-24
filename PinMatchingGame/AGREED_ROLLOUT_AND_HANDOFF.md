# Pin Matching Game — agreed design + rollout handoff

**Status:** Agreed with Steve (Nov 2026). Live game is playable; priority queue for new inventory is empty until seeded.  
**Live URL:** https://finsandpins.github.io/ClickToClaim/PinMatchingGame/  
**Firebase root:** `pin_matching_game/v1` only  
**Staff report:** https://finsandpins.github.io/ClickToClaim/PinMatchingGame/report.html  

**Related agents**
- PMG / durable backlog / crop repair: this workstream (`bc-01a07188-e78b-7eed-bfbb-f0dbb2ccd64e` and follow-ups)
- Online CTR front door (Shopify / storefront): `bc-01a10e43-f7f2-76cf-9f26-7b92c555c22a`

---

## Hard isolation (do not cross wires)

| System | Touch? |
|---|---|
| `PinMatchingGame/**` + Firebase `pin_matching_game/v1` | Yes (PMG only) |
| CTR show folders `ClickToClaim/YYYYMMDD/` | **No** unless Steve explicitly asks |
| Online CTR front door / Shopify storefront work | **No** (other agent owns that) |
| Production pricing watcher / LaunchAgents / PrepareClickToClaim | **No** unless Steve says **SHIP TO PRODUCTION** |

PMG must not break the CTR front door. The front door agent must not rewrite PMG queue semantics or seed scripts unless Steve asks.

---

## What we agreed the game does

### Lanes (serve order)

1. **Controls** — known-answer pairs for trust calibration / leaderboard.
2. **Priority** — pins that still need Match / No Match. Served at the **front**.
3. **Durable backlog** — historically decided pairs so the game never goes empty.

### Usernames

- Required at start.
- Saved in browser `localStorage` (`pmg_username`) and Firebase `players/<safeUsername>`.
- Used for votes, trust, leaderboard, and “already voted on this pair.”
- **Switch** only changes username on that device (not a game mode).

### Priority consensus (needs matching)

- Players vote Match / No Match / Not a pin / Skip.
- Only **trusted** votes count toward consensus.
- Trust: enough control answers at ≥ ~80% accuracy.
- **3 agreeing trusted votes** → pair is resolved, **removed from priority queue**, and the decision is **written to the pricing harness** (`pin_pricing_tests/...`), same class of outcome as Lexi tapping CTM.
- If many participants never reach 3-agree → escalate path (no clean consensus write).

### Durable backlog (your “put it back for the game later”)

- Seeded from Lexi/Steve CTM Match/**No Match** and CTP/listing **Match** in Firebase.
- **Excludes** `price_source == manual` (manual price is not proof of visual match).
- Votes **do not** change Match/No Match in pricing and **do not** remove the pair from `open_backlog`.
- Accuracy can still be tracked against the known answer.
- Purpose: never show an empty game; research / practice / leaderboard fuel.

### Crop images (critical lesson)

Left pin (“Our Pin”) loads from:

`https://raw.githubusercontent.com/FinsAndPins/PreparingInventory/main/<collection>/crops/<crop>.jpg`

If that collection’s crops are **not** on PreparingInventory `main`, the left image goes blank (Safari shows `?`).  
**Do not seed priority for a run until crops are public on GitHub.**

---

## Current live state (as of last check)

- Priority / `active_batch`: **empty** (nothing “needs matching” at the front yet)
- Durable backlog: ~3k pairs with working public crops
- Controls: ~80
- Multi-user: designed for it; only a few players so far

So: ready for Lexi + helpers to **play**, not yet ready to clear a fresh **4000-pin** pricing batch until that batch is **priority-seeded** with public crops.

---

## How a new pricing run gets into the front of the list

**Not automatic today.** After pricing publishes candidates + crops:

```bash
python3 PinMatchingGame/tools/seed_queue.py \
  --ui-data /ABSOLUTE/PATH/TO/ui_data.json \
  --collection PriceCollection_YYYYMMDD_HHMM
```

Effects:
- Writes items under `pin_matching_game/v1/items/...`
- Fills `open_pricing/<collection>`
- Sets `meta.active_batch` to that collection
- Client serves those pairs **before** backlog
- Consensus can write harness for that run

Optional later (needs Steve **SHIP TO PRODUCTION**): post-publish hook from pricing watcher. **Not for the 4000-pin weekend unless Steve says so.**

Repair if left pins blank after GitHub prune:

```bash
python3 PinMatchingGame/tools/repair_crop_urls.py
```

---

## What we need from the CTR front-door agent

Agent: `bc-01a10e43-f7f2-76cf-9f26-7b92c555c22a`  
Goal: answer the photo / path questions below **without** changing PMG or damaging front-door work. Reply by editing the **Answers** section at the bottom of this file (or a short comment pointing here).

### Please fill in

1. **Collection / run id** for the ~4000 pins  
   - `PriceCollection_...` or show / named collection id  
   - Firebase `test_run_id` / `approach_id` if known  

2. **Where the board photos / full-res originals live**  
   - Absolute path on disk (iCloud / Cursor Projects / BoardsToPrice / etc.)  

3. **Where RF-DETR / pricing crops live after the run**  
   - Absolute path to `crops/` (and confirm they are or will be on `PreparingInventory` GitHub `main`)  

4. **Where `ui_data.json` (or equivalent candidate JSON) will be**  
   - Absolute path the PMG seeder can pass to `--ui-data`  

5. **Publish status**  
   - Are crops already on GitHub Pages/raw? If not, who publishes them and when?  

6. **Harness write target**  
   - Confirm the Firebase path PMG should write consensus into (usually `pin_pricing_tests/<test_run_id>/<approach_id>/pins/...`)  

7. **Front-door isolation**  
   - List any paths you consider owned by the CTR front door so PMG agents never touch them  

### What we do **not** need from you

- Do not wire PMG into Shopify / CTR front door UI.
- Do not change production pricing LaunchAgents.
- Do not edit `PinMatchingGame/index.html` unless Steve asks for a joint UX change.

---

## Rollout checklist (Steve + PMG agent)

| Step | Owner | Done? |
|---|---|---|
| Front-door agent fills photo/`ui_data`/crop paths below | Front-door agent | |
| Confirm crops public on PreparingInventory `main` | PMG agent | |
| Seed priority with `seed_queue.py --ui-data ... --collection ...` | PMG agent | |
| Spot-check 5 cards on iPhone Safari (both images) | Steve / Lexi | |
| Share game URL + “pick a username” with helpers | Steve / Lexi | |
| Confirm consensus may write pricing harness | Steve | default **yes** |
| Optional: `match.collectiondetection.app` | Steve DNS + PMG | not blocking |

---

## Paste-ready prompts

### Prompt for CTR front-door agent (`bc-01a10e43-...`)

```text
Read ClickToClaim/PinMatchingGame/AGREED_ROLLOUT_AND_HANDOFF.md end to end.

We are pricing ~4000 pins and want the Pin Matching Game priority lane
to consume that run. Do NOT edit PinMatchingGame, CTR show folders, or
production pricing watchers unless I explicitly ask.

Fill the "Answers from CTR front-door agent" section in that same MD with:
1) collection / test_run_id / approach_id
2) absolute path to full-res board photos
3) absolute path to crops/ and whether they are on PreparingInventory main
4) absolute path to ui_data.json (or equivalent) for seed_queue.py --ui-data
5) who publishes crops to GitHub and when
6) Firebase harness path for consensus writes
7) path allowlist you own for the CTR front door (so PMG never touches it)

Reply with the updated file path and a 5-line summary only.
```

### Prompt for PMG agent (after answers land)

```text
Read ClickToClaim/PinMatchingGame/AGREED_ROLLOUT_AND_HANDOFF.md.

Using the filled Answers section only:
1) Verify crops are HTTP 200 on raw.githubusercontent.com for that collection
2) Seed priority with PinMatchingGame/tools/seed_queue.py --ui-data ... --collection ...
3) Spot-check 5 random priority items (crop + eBay thumb)
4) Do not touch CTR front door, show folders, or pricing LaunchAgents
5) Report: active_batch, open_pricing count, sample URLs, Steve needed? no/yes

Isolation: Firebase pin_matching_game/v1 and PinMatchingGame/** only.
```

### Invite text (Lexi / helpers)

```text
Pin Matching Game — help us Match / No Match pins while we price.

1) Open: https://finsandpins.github.io/ClickToClaim/PinMatchingGame/
2) Enter a username (your first name is fine)
3) Compare left (our pin) vs right (eBay). Tap Match, No Match, Not a pin, or Skip.
4) After a few practice controls you’ll become “trusted”; trusted votes count toward decisions.

Thank you — this directly helps clear inventory.
```

---

## Answers from CTR front-door agent

_Agent `bc-01a10e43-f7f2-76cf-9f26-7b92c555c22a`: fill this section._

**Collection / run ids:**  
_TBD_

**Full-res board photos path:**  
_TBD_

**Crops path (local):**  
_TBD_

**Crops on PreparingInventory GitHub main? (yes/no + folder name):**  
_TBD_

**`ui_data.json` absolute path:**  
_TBD_

**Publish owner / timing:**  
_TBD_

**Firebase harness path for PMG writes:**  
_TBD_

**CTR front-door path allowlist (do not touch):**  
_TBD_

**Notes / blockers:**  
_TBD_

---

## Answers from PMG agent (after seed)

**Seeded collection:**  
_TBD_

**`active_batch`:**  
_TBD_

**Priority open count:**  
_TBD_

**Sample crop URL (HTTP status):**  
_TBD_

**Steve needed?**  
_TBD_
