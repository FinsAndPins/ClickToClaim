/**
 * Bridge: Intake cloud-lab Worker → private Cloud Run pricing.
 * eBay keys and RF-DETR stay on GCP. Prefer source_urls (R2 proxy) so bodies stay under Cloud Run's ~32MB cap.
 * Lexi notify must stay off (NOTIFY_LEXI=0).
 */

import type { Bindings } from "./types";
import { jpegNameFromOriginal, looksHeic, reencodeToJpeg, type ReencodeResult } from "./reencode";

export type CloudPriceResult = {
  ok: boolean;
  job_id?: string;
  harness_path?: string;
  pin_count?: number;
  priced_count?: number;
  elapsed_sec?: number;
  error?: string;
  match_ready?: boolean;
  remaining_deferred?: boolean;
};

export type PhotoBlob = {
  filename: string;
  bytes: ArrayBuffer;
  contentType: string;
};

/** Board reference for URL-pull detect (Cloud Run fetches each JPEG). */
export type PhotoSourceUrl = {
  filename: string;
  url: string;
};

function invokeKey(env: Bindings): string {
  return String(env.CLOUD_PRICE_INVOKE_KEY || "").trim();
}

function priceBase(env: Bindings): string {
  return String(env.CLOUD_PRICE_URL || "").replace(/\/$/, "");
}

export function cloudPricingConfigured(env: Bindings): boolean {
  return Boolean(priceBase(env) && invokeKey(env));
}

/** iOS CollectionValueRemoteConfig.matchWindowN default. */
export const CLOUD_PREFETCH_N = 20;

function appendBoardFiles(form: FormData, photos: PhotoBlob[]) {
  photos.forEach((p, idx) => {
    const name = p.filename.match(/^IMG_\d+\.(jpe?g|png|webp)$/i)
      ? p.filename
      : `IMG_${String(idx + 1).padStart(4, "0")}.JPG`;
    form.append(
      "files",
      new Blob([p.bytes], { type: p.contentType || "image/jpeg" }),
      name
    );
  });
}

async function parseCloudJson(res: Response): Promise<{ ok: boolean; body: Record<string, unknown>; error?: string }> {
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, body: {}, error: `Cloud Run HTTP ${res.status}: ${text.slice(0, 400)}` };
  }
  if (!res.ok || body.ok === false) {
    return {
      ok: false,
      body,
      error: String(body.error || body.detail || `HTTP ${res.status}: ${text.slice(0, 400)}`),
    };
  }
  return { ok: true, body };
}

function guardLab(env: Bindings, sources: unknown[]): string | null {
  if (!priceBase(env) || !invokeKey(env)) {
    return "CLOUD_PRICE_URL / CLOUD_PRICE_INVOKE_KEY not configured";
  }
  if (String(env.NOTIFY_LEXI || "0") === "1") {
    return "NOTIFY_LEXI must stay 0 on cloud lab";
  }
  if (!sources.length) {
    return "No photos to price";
  }
  return null;
}

/**
 * One-shot price (admin "Get Offer Faster").
 * Prefer sourceUrls so Cloud Run pulls from the Worker R2 proxy (no 32MB multipart).
 */
export async function runCloudPriceCollection(
  env: Bindings,
  photos: PhotoBlob[] | PhotoSourceUrl[],
  opts?: { pool_n?: number; min_conf?: number; prefetch_n?: number }
): Promise<CloudPriceResult> {
  const blocked = guardLab(env, photos);
  if (blocked) return { ok: false, error: blocked };

  const base = priceBase(env);
  const key = invokeKey(env);
  const form = new FormData();
  form.append("pool_n", String(opts?.pool_n ?? 20));
  form.append("min_conf", String(opts?.min_conf ?? 0.25));
  form.append("prefetch_n", String(opts?.prefetch_n ?? CLOUD_PREFETCH_N));

  const asUrls = photos as PhotoSourceUrl[];
  if (asUrls[0] && typeof asUrls[0].url === "string") {
    form.append(
      "source_urls",
      JSON.stringify(
        asUrls.map((p) => ({
          filename: p.filename,
          url: p.url,
        }))
      )
    );
  } else {
    appendBoardFiles(form, photos as PhotoBlob[]);
  }

  const res = await fetch(`${base}/price-collection`, {
    method: "POST",
    headers: {
      "X-Intake-Cloud-Key": key,
    },
    body: form,
  });
  const parsed = await parseCloudJson(res);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const body = parsed.body;
  return {
    ok: true,
    job_id: String(body.job_id || ""),
    harness_path: String(body.harness_url || ""),
    pin_count: Number(body.pin_count || 0),
    priced_count: Number(body.priced_count || 0),
    elapsed_sec: Number(body.elapsed_sec || 0),
  };
}

export type CloudPrefetchResult = CloudPriceResult & {
  status?: string;
  prefetch_n?: number;
  prefetch_priced?: number;
  boards?: unknown[];
  confirm_url?: string;
};

/**
 * Phase 1: detect all boxes + eBay for first N pins (iOS celebration prefetch).
 * Leaves job in awaiting_box_confirm. Call confirmCloudBoxes next.
 * Prefer sourceUrls (R2 proxy) for multi-board collections.
 */
export async function runCloudDetectAndPrefetch(
  env: Bindings,
  photos: PhotoBlob[] | PhotoSourceUrl[],
  opts?: {
    pool_n?: number;
    min_conf?: number;
    prefetch_n?: number;
    collection_id?: string;
    callback_url?: string;
  }
): Promise<CloudPrefetchResult> {
  const blocked = guardLab(env, photos);
  if (blocked) return { ok: false, error: blocked };

  const base = priceBase(env);
  const key = invokeKey(env);
  const form = new FormData();
  form.append("pool_n", String(opts?.pool_n ?? 20));
  form.append("min_conf", String(opts?.min_conf ?? 0.25));
  form.append("prefetch_n", String(opts?.prefetch_n ?? CLOUD_PREFETCH_N));
  if (opts?.collection_id) form.append("collection_id", opts.collection_id);
  if (opts?.callback_url) form.append("callback_url", opts.callback_url);

  const asUrls = photos as PhotoSourceUrl[];
  if (asUrls[0] && typeof asUrls[0].url === "string") {
    form.append(
      "source_urls",
      JSON.stringify(
        asUrls.map((p) => ({
          filename: p.filename,
          url: p.url,
        }))
      )
    );
  } else {
    appendBoardFiles(form, photos as PhotoBlob[]);
  }

  const res = await fetch(`${base}/detect-and-prefetch`, {
    method: "POST",
    headers: { "X-Intake-Cloud-Key": key },
    body: form,
  });
  const parsed = await parseCloudJson(res);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const body = parsed.body;
  return {
    ok: true,
    job_id: String(body.job_id || ""),
    status: String(body.status || "awaiting_box_confirm"),
    pin_count: Number(body.pin_count || 0),
    priced_count: Number(body.prefetch_priced || 0),
    prefetch_n: Number(body.prefetch_n != null ? body.prefetch_n : CLOUD_PREFETCH_N),
    prefetch_priced: Number(body.prefetch_priced || 0),
    elapsed_sec: Number(body.elapsed_sec || 0),
    boards: Array.isArray(body.boards) ? body.boards : [],
    confirm_url: String(body.confirm_url || ""),
  };
}

/**
 * Phase 2: confirm boxes (or confirm-as-detected with empty body).
 * Only reprices added/moved boxes; reuses prefetch candidates for unchanged pins.
 */
export async function confirmCloudBoxes(
  env: Bindings,
  jobId: string,
  boards?: unknown[]
): Promise<CloudPriceResult & { delta?: unknown }> {
  const base = priceBase(env);
  const key = invokeKey(env);
  if (!base || !key) {
    return { ok: false, error: "CLOUD_PRICE_URL / CLOUD_PRICE_INVOKE_KEY not configured" };
  }
  if (String(env.NOTIFY_LEXI || "0") === "1") {
    return { ok: false, error: "NOTIFY_LEXI must stay 0 on cloud lab" };
  }

  const res = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}/confirm-boxes`, {
    method: "POST",
    headers: {
      "X-Intake-Cloud-Key": key,
      "content-type": "application/json",
    },
    // defer_remaining: open Match ASAP; Cloud Run finishes other pins in background
    body: JSON.stringify(
      boards && boards.length
        ? { boards, defer_remaining: true }
        : { defer_remaining: true }
    ),
  });
  const parsed = await parseCloudJson(res);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const body = parsed.body;
  return {
    ok: true,
    job_id: String(body.job_id || jobId),
    harness_path: String(body.harness_url || ""),
    pin_count: Number(body.pin_count || 0),
    priced_count: Number(body.priced_count || 0),
    elapsed_sec: Number(body.elapsed_sec || 0),
    delta: body.delta,
    match_ready: body.match_ready !== false,
    remaining_deferred: Boolean(body.remaining_deferred),
  };
}

/**
 * Point Mac-shaped harness HTML at this Worker’s staff file proxy so CTM/CTP/assets
 * load same-origin (Cloud Run injects its own /jobs/.../file base which browsers cannot auth).
 */
export function rewriteCloudHarnessHtml(html: string, jobId: string): string {
  const fileBase = `/api/cloud/jobs/${encodeURIComponent(jobId)}/file/`;
  const uiBase = `${fileBase}testing_ui_visual_baseline/`;
  let out = html;
  // Absolute Cloud Run (or mistaken host+/api/cloud) bases → Worker relative base.
  out = out.replace(
    /<base\s+href=["'][^"']*\/(?:jobs|api\/cloud\/jobs)\/[^/"']+\/file\/testing_ui_visual_baseline\/["']\s*\/?>/gi,
    `<base href="${uiBase}">`
  );
  if (!/<base\s/i.test(out) && /<head>/i.test(out)) {
    out = out.replace(/<head>/i, `<head>\n  <base href="${uiBase}">`);
  }
  // Absolute Cloud Run / mistaken host URLs → Worker proxy.
  out = out.replace(
    /https?:\/\/[^"'/\s]+\/(?:jobs|api\/cloud\/jobs)\/[^/"']+\/file\//g,
    fileBase
  );
  // Bare /jobs/.../file/ only (do not rematch inside /api/cloud/jobs/...).
  out = out.replace(/(?<!\/api\/cloud)\/jobs\/[^/"']+\/file\//g, fileBase);
  // Normalize any already-proxied job file roots to this job id.
  out = out.replace(/\/api\/cloud\/jobs\/[^/"']+\/file\//g, fileBase);
  return out;
}

export async function fetchCloudHarnessHtml(env: Bindings, jobId: string): Promise<Response> {
  const base = priceBase(env);
  const key = invokeKey(env);
  if (!base || !key) {
    return new Response("Cloud pricing not configured", { status: 503 });
  }
  const res = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}/harness`, {
    headers: { "X-Intake-Cloud-Key": key },
  });
  const html = await res.text();
  if (!res.ok) {
    return new Response(html, {
      status: res.status,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return new Response(rewriteCloudHarnessHtml(html, jobId), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function fetchCloudJobFile(env: Bindings, jobId: string, filePath: string): Promise<Response> {
  const base = priceBase(env);
  const key = invokeKey(env);
  if (!base || !key) {
    return new Response("Cloud pricing not configured", { status: 503 });
  }
  const res = await fetch(
    `${base}/jobs/${encodeURIComponent(jobId)}/file/${filePath.replace(/^\/+/, "")}`,
    { headers: { "X-Intake-Cloud-Key": key } }
  );
  const lower = filePath.toLowerCase();
  if (res.ok && (lower.endsWith(".html") || lower.endsWith(".htm"))) {
    const rewritten = rewriteCloudHarnessHtml(await res.text(), jobId);
    return new Response(rewritten, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, max-age=60",
      },
    });
  }
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
}

export async function fetchCloudJobJson(
  env: Bindings,
  jobId: string,
  filePath: string
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  const res = await fetchCloudJobFile(env, jobId, filePath);
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Cloud job file HTTP ${res.status}: ${text.slice(0, 300)}` };
  }
  try {
    return { ok: true, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { ok: false, error: `Invalid JSON at ${filePath}` };
  }
}

/**
 * Normalize upload bytes to JPEG for storage.
 * - Already JPEG: store as-is (fast). Full jsquash reencode of ~7MB iPhone boards
 *   OOMs/slows Worker finish; Cloud Run `_downscale_jpeg_bytes` still does EXIF transpose.
 * - HEIC: Cloud Run `/convert-to-jpeg` (Mac intake uses sips; Workers cannot decode HEIC).
 * - PNG/WebP: local reencode, then Cloud Run if needed.
 * Never returns raw HEIC.
 */
export async function ensureJpegBytes(
  env: Bindings,
  bytes: ArrayBuffer,
  contentType: string,
  originalFilename: string | null | undefined
): Promise<ReencodeResult> {
  const type = (contentType || "").toLowerCase();
  const name = originalFilename || "photo.jpg";
  const buf = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes);

  if (looksHeic(type, name)) {
    const converted = await convertImageViaCloudRun(env, buf, name);
    if (!converted.ok) {
      return { ok: false, reason: `heic_convert_failed:${converted.error.slice(0, 160)}` };
    }
    return {
      ok: true,
      bytes: converted.bytes,
      contentType: "image/jpeg",
      filename: jpegNameFromOriginal(name),
    };
  }

  // Skip Worker reencode for JPEG: finish stays fast; Cloud Run bakes orientation.
  if (type.includes("jpeg") || type.includes("jpg") || /\.jpe?g$/i.test(name)) {
    return {
      ok: true,
      bytes: buf,
      contentType: "image/jpeg",
      filename: jpegNameFromOriginal(name),
    };
  }

  const local = await reencodeToJpeg(bytes, contentType, name);
  if (local.ok) return local;

  const converted = await convertImageViaCloudRun(env, buf, name);
  if (!converted.ok) {
    return { ok: false, reason: `reencode_failed:${local.reason};${converted.error.slice(0, 120)}` };
  }
  return {
    ok: true,
    bytes: converted.bytes,
    contentType: "image/jpeg",
    filename: jpegNameFromOriginal(name),
  };
}

/**
 * Convert HEIC/HEIF (or other Pillow-readable bytes) to JPEG via Cloud Run.
 * Mirrors Mac intake handoff `sips` for the cloud lab (Workers cannot decode HEIC).
 */
export async function convertImageViaCloudRun(
  env: Bindings,
  bytes: ArrayBuffer | Uint8Array,
  filename: string,
  opts?: { maxEdge?: number }
): Promise<{ ok: true; bytes: Uint8Array; contentType: "image/jpeg" } | { ok: false; error: string }> {
  const base = priceBase(env);
  const key = invokeKey(env);
  if (!base || !key) {
    return { ok: false, error: "CLOUD_PRICE_URL / CLOUD_PRICE_INVOKE_KEY not configured" };
  }
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const headers: Record<string, string> = {
    "X-Intake-Cloud-Key": key,
    "content-type": "application/octet-stream",
    "x-filename": filename || "photo.heic",
  };
  if (opts?.maxEdge && opts.maxEdge > 0) {
    headers["x-max-edge"] = String(Math.round(opts.maxEdge));
  }
  try {
    const res = await fetch(`${base}/convert-to-jpeg`, {
      method: "POST",
      headers,
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `convert-to-jpeg HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    const out = new Uint8Array(await res.arrayBuffer());
    if (out.byteLength < 100) {
      return { ok: false, error: "convert-to-jpeg returned empty body" };
    }
    return { ok: true, bytes: out, contentType: "image/jpeg" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * After detect-only (prefetch_n=0), queue Match-window eBay on the existing job.
 * Cloud Run 0.9.6+ POST /jobs/{id}/start-prefetch.
 */
export async function kickStartPrefetch(
  env: Bindings,
  jobId: string,
  prefetchN: number = CLOUD_PREFETCH_N
): Promise<{ ok: boolean; error?: string; queued?: boolean }> {
  const base = priceBase(env);
  const key = invokeKey(env);
  if (!base || !key) {
    return { ok: false, error: "CLOUD_PRICE_URL / CLOUD_PRICE_INVOKE_KEY not configured" };
  }
  try {
    const res = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}/start-prefetch`, {
      method: "POST",
      headers: {
        "X-Intake-Cloud-Key": key,
        "content-type": "application/json",
      },
      body: JSON.stringify({ prefetch_n: Math.max(1, Math.round(prefetchN)) }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `start-prefetch HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true, queued: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Re-kick deferred eBay when Confirm's Cloud Run BackgroundTask died. */
export async function kickFinishRemaining(
  env: Bindings,
  jobId: string
): Promise<{ ok: boolean; error?: string }> {
  const base = priceBase(env);
  const key = invokeKey(env);
  if (!base || !key) {
    return { ok: false, error: "CLOUD_PRICE_URL / CLOUD_PRICE_INVOKE_KEY not configured" };
  }
  try {
    const res = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}/finish-remaining`, {
      method: "POST",
      headers: { "X-Intake-Cloud-Key": key },
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `finish-remaining HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
