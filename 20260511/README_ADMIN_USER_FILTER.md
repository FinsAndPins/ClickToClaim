# Admin user filter (`20260511`)

**Shipped 2026-05-11** — commit **`8953696`** on **`ClickToClaim`** `main`.

## Purpose

Exclude specific Firebase **user keys** from **reports** and from **admin-only** pin overlays on **`index.html`**, without deleting RTDB data (e.g. one user clicking hundreds of pins).

## Files

| File | Role |
|------|------|
| `js/user_filter.js` | `collectUniqueUsers`, `filterClaims`, `filterUsersOnPin`, `localStorage` read/write |
| `reports.html` | User checkboxes + **Select all**; all sections use filtered claims |
| `index.html` | When `isAdmin`, overlay / stats use filtered view; public unchanged |

## Storage

- **Key:** `ctr_user_filter_excluded_keys_20260511`
- **Value:** JSON array of **excluded** Firebase child keys under each pin (same keys as `claims/.../<pinKey>/<thisKey>`).

**Checked** in the UI = user is **included**. Unchecked = **excluded**.

## Testing

- Prefer **https://finsandpins.github.io/ClickToClaim/20260511/** (or your usual host) with normal Firebase auth — not **`file://`**, which often shows empty data.
- **Reports** and **admin index** on the **same browser** share **`localStorage`**.

## Future template tweak

Consider moving checkboxes **into** the existing Section 1 user table (same logic; less duplicate UI). See **`FUTURE.md`** → Session log — 2026-05-11.

## Related (Whatnot / pricing alignment)

What we learned about **bulk CSV**, **`pin_match_review.html`** pitfalls (same URL twice), and **locking CTR ↔ pricing** with one detector / `pin_id` is in the Cursor Projects playbook:  
**`Whatnot show 20260511/WHATNOT_CTR_PLAYBOOK.md`** (includes a **show-day session addendum** after deploy).
