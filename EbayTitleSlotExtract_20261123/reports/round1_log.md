# Round 1 — LLM title slot extract (dev_50)

**Date:** 2026-11-24 (America/New_York)
**Data:** Firebase `test_PriceCollection_20261121_2225__build_20261123_fullres_visual_baseline` titles (same run behind whatnot_upload_20261123_buynow.csv)
**Prompt:** `prompts/extract_v1.txt` (frozen for this round)
**Model:** agent_extract_v1 (Cursor LLM pass; Gemini/OpenAI key not yet in env)
**N:** 50 / 50 ok

## Self-check
- Quarantine pattern leak into `description_candidate`: 0 (after description sanitizer strips Mystery/Chaser/LE#/year)

## Next
1. Steve fills `data/gold_dev_template.json` (or review CSV) for set/maker/park + quarantine.
2. `python3 scripts/score_predictions.py --split dev --pred reports/extract_dev_llm.json`
3. Gate: quarantine_leak_rate == 0 on labeled rows before touching holdout.
4. Optional A/B: bind GEMINI_API_KEY and re-run `scripts/run_extract.py --split dev --model gemini`.

## Not done
- Holdout sealed
- No Whatnot CSV / production wiring
