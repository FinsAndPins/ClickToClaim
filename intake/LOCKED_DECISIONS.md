# Collection intake — locked decisions (v1)

Planning conversation (Aug 2026). Implementation lives in `/intake`.

| Topic | Decision |
|--------|----------|
| Goal | Seller self-upload + on-site offer/payment desk. Not cloud pricing in v1. |
| Pricing | Mac watcher / CTM / CTP. Card stores overlay URL + harness total. |
| Offer to seller | One dollar amount for everything in their photos. No pin count, no comps. |
| Helpers (staff only) | Harness total, 30/40/50/60%. |
| Contact | Name + email + PayPal G&S required. Instagram optional. No seller accounts. |
| Consent | Checkbox + Privacy/Terms page. |
| Moderation | One cloud vendor: **Google Cloud Vision SafeSearch**. Reject → delete image, alert with identity + reason codes only. Second vendor later if pin boards false-positive. |
| Retention | Crops always (when we have them). Board originals kept; future toggle (30 days / received / declined). |
| Offer link | Reusable 7 days. Reissue same $ without repricing. No expiry nags. |
| Decline | Optional why + optional “what would have worked.” Keep pricing data. |
| Pay | After Accept, before they ship. PayPal G&S **manual** in v1. Email + Ready to pay. API later. |
| Ship | Seller’s postage. Show ship-to after Accept. Tracking optional. |
| Statuses | Submitted → Pricing → Offer sent → Accepted → Paid → Waiting for package → Received → Done (+ Declined / Withdrawn) |
| Staff | Steve + Lexi via **steve.fierstein@gmail.com** and **finsandpins@gmail.com**. Cloudflare Access. |
| URLs | `sell.finsandpins.shop` (not a path on the Shopify shop). |
| Email | From `offer@finsandpins.shop`. Alerts to `finsandpins@gmail.com`. |
| Ship-to | Fins and Pins, LLC, 15049 Canopy Cover Dr, Winter Garden, FL 34787 |
| Hosting vs shop | Separate app. Shopify is outbound store only. |

Later (not v1): cloud RF-DETR + eBay pricing, PayPal API, auto labels, Cindy Access.
