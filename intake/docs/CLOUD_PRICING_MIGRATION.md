# Cloud pricing migration (not v1)

v1 still prices on the **Mac** (watcher → CTM/CTP → paste overlay URL). This note is so we can move detection + eBay pricing later **without** putting secrets on the public intake site.

## Do not do this

- Do **not** run RF-DETR inside the public Cloudflare Worker (`sell.finsandpins.shop`)
- Do **not** put eBay OAuth / Browse keys, model weights, or Roboflow tokens on that Worker
- Do **not** give the internet a public “detect this image” URL

Workers are fine for upload, moderation, offers, and email. They are a bad place for RF-DETR (no GPU, tight CPU/memory, wrong security boundary).

## Target shape (when we do it)

```
Seller → Intake Worker (Cloudflare)
         temp R2 → Google Vision → clean R2 (originals)
         authenticated job → Pricing service (private)
                              RF-DETR + crops + eBay
                              write overlay / harness URL
         staff dashboard already has overlay + % helpers
```

**Pricing service** should be:

| Piece | Recommendation | Why |
|--------|----------------|-----|
| Cloud | **Google Cloud** (Cloud Run first) | Matches Vision + your Google preference; Secret Manager is solid |
| Ingress | **No public URL** | Only the intake Worker (or a queue) may call it |
| Secrets | **Secret Manager** | eBay, any model tokens — never wrangler.toml, never git |
| Weights | **Private GCS bucket** | RF-DETR checkpoint; not in ClickToClaim |
| Queue | Cloud Tasks / Pub/Sub **or** Cloudflare Queue → pull | Retry, don’t block seller upload |
| Harness host | Private (Cloudflare Access), not public GitHub Pages | Same Access allowlist as intake admin |

CPU Cloud Run may be enough if Mac RF-DETR is already CPU. Add GPU only if latency is painful.

## Secret inventory (move these off the Mac, not onto the intake Worker)

| Secret | Lives today | Future |
|--------|-------------|--------|
| Google Vision API key | (new) Worker secret | Stay on **intake** Worker only |
| Resend API key | Worker secret | Intake Worker only |
| eBay Browse / OAuth | Mac scripts / iCloud | **Pricing service** Secret Manager |
| RF-DETR weights / Core ML / ONNX | Mac | Private GCS, mounted to Cloud Run |
| Roboflow (if still used) | Mac | Pricing service only, or retire |
| Cloudflare Access | — | Intake admin + future harness |

Intake Worker env should never contain `EBAY_*`.

## v1 → v2 cutover

1. Keep Mac path working (this PR).
2. After deploy: Vision key + Resend + DNS.
3. New repo or `intake/pricing-service/` (later): Cloud Run that accepts `{collectionId}` and reads originals from R2 via a **scoped** token (read-only, that prefix only).
4. Write `pricing_jobs` rows (table already in `schema.sql`) and set `overlay_url` / `harness_total_cents` on the collection when done.
5. Email Steve/Lexi the harness link instead of “download and drop in the watcher.”
6. Only then turn off the Mac watcher for **intake** collections (show CTR pipeline can stay Mac as long as you want).

## Security rules to keep

- Moderation still happens **before** any pricing job sees bytes
- Pricing service identity: Google service account; Worker uses a short-lived token or a Cloudflare Queue the service pulls
- Logs: collection ID + pin counts, not raw seller PayPal, not image bytes
- Failed jobs retry; staff see `pricing_jobs.status = failed` without exposing eBay payloads to the seller site

## Effort (honest)

This is a **second product** (private inference + your existing Python/CTP scripts). Intake v1 does not depend on it. When you’re home we can spike Cloud Run with one board folder **after** sell.finsandpins.shop is live.
