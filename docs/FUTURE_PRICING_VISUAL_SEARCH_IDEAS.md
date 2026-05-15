# Future Pricing Visual Search Ideas

- **CLIP / deep embeddings (assist only):** Use as an optional re-rank or assist signal; offline eval on joined Firebase + PriceCollection samples showed promise versus custom dHash, but keep usage gated with thresholds and review, never blind auto-approve.
- **VNFeaturePrint / Apple Vision alignment:** Keep a native-aligned path available if the stack favors on-device execution and Apple Vision consistency across tooling.
- **Fusion policy:** Combine dHash + CLIP disagreement + score margin; trigger only when Lexi scrolled or confidence is low, and keep a human-in-loop decision step.
- **Input quality improvements:** Prefer larger listing thumbnails, run multi-crop comparisons (center + detail), and tune cache strategy so higher-quality inputs do not stall workflow.
- **Scale validation:** Time the full joinable dataset on target hardware and stratify performance/quality when candidate counts vary widely by item.
- **Classical extras (low priority):** Imagehash variants and histogram features are still available, but eval showed limited incremental gain versus custom dHash unless fused with other signals.
- **Safety metrics before production:** Track broke-good regressions, hit rate on the scrolled subset, and clicks-saved simulations before enabling live policy changes.
- **Detailed eval reference:** Full tables and run-level numbers remain in the iCloud eval folder `PinPricingRerankEval_20260512` (no table copy needed here).
