# Cloud pricing migration (zero physical infrastructure)

**Status:** Plan only (not built). v1 intake still prices on a Mac after upload.

**Goal:** No MacBook and no Mac mini required for collection intake pricing, while keeping the RF-DETR model and other pricing assets private.

Seller intake (upload, Vision, offers, email, admin) is already on Cloudflare. The gap is everything after a successful finish: download → detect → eBay → harness → Lexi notify → overlay on admin.

## Do not do this

- Do **not** run RF-DETR inside the public Cloudflare Worker (`sellmycollection.finsandpins.shop`)
- Do **not** put eBay OAuth / Browse keys, model weights, or Roboflow tokens on that Worker
- Do **not** give the internet a public “detect this image” URL

Workers are fine for upload, moderation, offers, and email. They are a bad place for RF-DETR (no GPU, tight CPU/memory, wrong security boundary).

## Already cloud vs still on a Mac

### Already cloud

- Sell My Collection Worker (upload, Vision, D1/R2, offers, email, admin)
- Auto-queue marker after a successful finish (`mac_handoff_status = queued`)

### Still on a physical Mac today

1. Intake handoff helper downloads queued photos into `CollectionsToPrice/`
2. Named Collections pricing watcher: RF-DETR, eBay, CTM/CTP, publish, Lexi text
3. Overlay linker finds the published harness and sets Open pricing on admin
4. Staff Pull total (Firebase) and PayPal G&S stay human for now

Laptop closed or LaunchAgents stopped → sellers can still upload; pricing stalls.

## Target shape (no hardware)

```
Seller → Intake Worker (Cloudflare; keep as-is)
         temp R2 → Google Vision → clean R2 (originals)
         authenticated job → private Pricing service
                              RF-DETR + crops + eBay
                              publish harness (Access-gated)
                              write overlay / job status back to Intake
                              notify Lexi (email or SMS; not Mac Messages)
```

**Pricing service** should be:

| Piece | Recommendation | Why |
|--------|----------------|-----|
| Cloud | **Google Cloud** (Cloud Run first) | Matches Vision; Secret Manager is solid |
| Ingress | **No public URL** | Only the intake Worker (or a queue) may call it |
| Secrets | **Secret Manager** | eBay, notify tokens; never wrangler.toml, never git |
| Weights | **Private GCS bucket** | RF-DETR checkpoint; not in ClickToClaim; not public R2 |
| Queue | Cloud Tasks / Pub/Sub **or** Cloudflare Queue → pull | Retry; do not block seller upload |
| Harness host | Private (Cloudflare Access) | Same allowlist as intake admin; not a wide-open Pages folder if comps leak matters |

CPU Cloud Run may be enough if Mac RF-DETR is already CPU. Add GPU only if latency is painful.

## Security model (non-negotiable)

| Boundary | What lives there |
|----------|------------------|
| **Public** | Intake Worker, seller uploads, Vision, offers |
| **Private** | RF-DETR weights (GCS), eBay keys, detect+price compute (Cloud Run, no public URL) |
| **Bridge** | Authenticated job only; originals by collection prefix; moderation **before** pricing sees bytes |

Also:

- Pricing service identity: Google service account; Worker uses a short-lived token or a queue the service pulls
- Logs: collection ID + pin counts, not raw seller PayPal, not image bytes
- Failed jobs retry; staff see `pricing_jobs.status = failed` without exposing eBay payloads to the seller site
- Intake Worker env must never contain `EBAY_*`

## Secret inventory (off the Mac, not onto the public Worker)

| Secret / asset | Lives today | Future |
|----------------|-------------|--------|
| Google Vision API key | Intake Worker secret | Stay on **intake** Worker only |
| Resend API key | Intake Worker secret | Intake Worker only |
| eBay Browse / OAuth | Mac scripts / iCloud | **Pricing service** Secret Manager |
| RF-DETR weights / Core ML / ONNX | Mac | Private GCS, available to Cloud Run |
| Roboflow (if still used) | Mac | Pricing service only, or retire |
| Lexi notify (today: Mac iMessage) | Mac Messages | Email and/or Twilio SMS from cloud |
| Cloudflare Access | Intake admin | Intake admin + future harness |
| Mac handoff token | Mac + Worker | Replace with cloud job auth; retire handoff token after cutover |

## What Steve needs to do

Account, money, and irreversible choices. Agents should not invent these.

1. **Pick cloud account:** Google Cloud project you own (billing on). Cloud Run + Secret Manager + GCS is the default.
2. **Approve spend envelope:** rough monthly cap (CPU Run first; GPU only if needed).
3. **Confirm scope:** intake-only first (recommended), or also BoardsToPrice + CTR detect later. Intake-only gets Sell My Collection off the Mac; other pipelines can wait.
4. **Place secrets:** eBay Browse/OAuth, any Roboflow (or retire), notify credentials. You paste into Secret Manager (or approve a guided put). Never into git or the public Worker.
5. **Approve private harness hosting:** Cloudflare Access in front of harness URLs (same allowlist as intake admin), or another private host.
6. **Approve Lexi notify:** email-first (easiest) or SMS (Twilio). Cloud cannot use Mac Messages.app.
7. **Approve cutover:** when Mac LaunchAgents for **intake** may be turned off for real (after one live collection succeeds end-to-end on cloud).
8. **After cutover:** leave the machine off; only touch billing, Access users, and secret rotation when needed.

Optional: enable GCP audit logs on the pricing service account; restrict who can download the GCS model bucket (you + CI service account only).

## What the agent needs to do

Build the private path beside production. Do **not** rewire Application Support / Named Collections / BoardsToPrice watchers until Steve says **SHIP TO PRODUCTION** for cutover.

1. Inventory the Mac intake path into a checklist (handoff, HEIC/`sips`, RF-DETR, crop, eBay, CTM/CTP publish, Lexi notify, overlay link-back, Pull total).
2. Scaffold a private pricing service in a new folder/repo (not the public Worker): Cloud Run entrypoint, health, auth (only Intake or queue may call).
3. Move model + assets into **private GCS**; document paths; never commit weights to ClickToClaim.
4. R2 read path: collection-scoped credential or signed object URLs. Service must not get bucket-wide keys exposed to the internet.
5. Port pricing scripts into that service (copy from PinPricingStudy / Named Collections paths; experiment isolation until cutover).
6. Job table + status: `pricing_jobs` (or equivalent) queued → running → done/failed; Intake admin shows state; retries without Steve.
7. Write-back: on success set `overlay_url` (and later harness total if desired); retire Mac overlay linker for intake.
8. Notify Lexi via the channel Steve picked.
9. Security pass: no public detect URL, no `EBAY_*` on Intake Worker, safe logs.
10. Shadow run: one staff/test collection on cloud while Mac path still works.
11. Cutover playbook: Intake enqueues cloud job instead of Mac handoff; leave Mac agents installed but idle until confident; then uninstall **intake** handoff only.
12. Docs: keep this file updated with live URLs, secret names, and rollback (“re-enable Mac handoff”).

## Suggested sequence

| Step | Owner | Outcome |
|------|--------|---------|
| A | Steve | GCP project + billing + “intake-only” + notify choice |
| B | Agent | Service scaffold + GCS model layout + job API design |
| C | Steve | Put eBay (+ notify) secrets in Secret Manager |
| D | Agent | First board E2E on Cloud Run (staff test) |
| E | Agent | Intake enqueue + overlay write-back (dual-path still on) |
| F | Steve | Approve cutover after Lexi prices one live cloud job |
| G | Agent | Ship cutover; Mac intake helpers idle; verify with laptop off |

## Cutover rules

1. Keep the Mac path working until shadow success.
2. New service accepts `{collectionId}` and reads originals from R2 via a **scoped** token (read-only, that prefix only).
3. Write `pricing_jobs` rows and set `overlay_url` / optionally `harness_total_cents` when done.
4. Notify Lexi with the harness link (no “download and drop in the watcher”).
5. Only then turn off Mac watchers for **intake** collections. Show CTR / BoardsToPrice can stay on a Mac until a later phase.
6. Rollback: re-enable Intake Mac handoff queue; cloud jobs can stay paused.

## Definition of done

- Seller submits → Steve’s MacBook is shut → Lexi gets a live pricing link
- Admin shows overlay without a Mac drop folder
- RF-DETR weights and eBay secrets never on the public intake Worker
- Intake Mac LaunchAgents can stay off without stalling new collections

## Effort (honest)

This is a **second product** (private inference + existing Python/CTP scripts + secrets + queue + cutover), not a flag flip. You trade laptop maintenance for cloud bills and one private service to own. Intake upload does not depend on it.

## Related

- Live intake: `sellmycollection.finsandpins.shop`
- Mac helper today: `Cursor Projects/IntakeToCollectionsToPrice/`
- Production isolation: `.cursor/rules/production-pricing-experiment-isolation.mdc` (cloud pricing work stays in a new folder until cutover ships)
