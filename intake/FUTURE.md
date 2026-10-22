# Sell My Collection — future development

Ideas **not** in v1 (invite-only upload + Mac pricing + firm offer desk).  
v1 decisions: `LOCKED_DECISIONS.md`. Deploy: `docs/HOME_DAY.md`.

---

## Seller box correction (CTR-style)

**Requested:** After detection, let the **seller** fix boxes themselves (same idea as CTR admin tools for Steve):

1. **Remove** — tap boxes that aren’t pins (false positives).  
2. **Add / adjust** — drag to draw or resize boxes for missed pins.

**Why:** Less Lexi/Steve cleanup before pricing; better crops → better offers.

**Depends on (rough order):**

- Detection available in a seller-reachable path (today: Mac only; later: private cloud detector — see `docs/CLOUD_PRICING_MIGRATION.md`).  
- Mobile-friendly box UI (tap remove, drag add/resize).  
- Corrected boxes become the source of truth for crops + pricing (not raw detector output).

**Not in v1:** Sellers only upload board photos; they never see boxes.

---

## Other later items (already noted elsewhere)

- Private cloud RF-DETR + eBay pricing (`docs/CLOUD_PRICING_MIGRATION.md`)  
- PayPal G&S API (vs manual pay after Accept)  
- Auto shipping labels (vs seller’s own postage)  
- Second moderation vendor if Vision false-positives on pin boards  
- Cindy Access; public launch (drop invite gate)  
- Large non-US buy as an **internal** exception only (not advertised)

Add new ideas under a dated heading below.

---

## Idea log

| When | Idea | Notes |
|------|------|--------|
| 2026-09-05 | Seller fix boxes (tap remove, drag add) | Like CTR; post-v1 |
