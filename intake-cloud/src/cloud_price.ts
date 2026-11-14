/**
 * Bridge: Intake cloud-lab Worker → private Cloud Run pricing.
 * eBay keys and RF-DETR stay on GCP. This module only forwards board JPEGs.
 * Lexi notify must stay off (NOTIFY_LEXI=0).
 */

import type { Bindings } from "./types";

export type CloudPriceResult = {
  ok: boolean;
  job_id?: string;
  harness_path?: string;
  pin_count?: number;
  priced_count?: number;
  elapsed_sec?: number;
  error?: string;
};

type PhotoBlob = {
  filename: string;
  bytes: ArrayBuffer;
  contentType: string;
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

/**
 * One-shot price (current admin "Get Offer Faster").
 * Cloud Run now prefetches eBay for the first prefetch_n pins before finishing the rest
 * (same Match-window idea as iOS), then builds the harness.
 */
export async function runCloudPriceCollection(
  env: Bindings,
  photos: PhotoBlob[],
  opts?: { pool_n?: number; min_conf?: number; prefetch_n?: number }
): Promise<CloudPriceResult> {
  const base = priceBase(env);
  const key = invokeKey(env);
  if (!base || !key) {
    return { ok: false, error: "CLOUD_PRICE_URL / CLOUD_PRICE_INVOKE_KEY not configured" };
  }
  if (String(env.NOTIFY_LEXI || "0") === "1") {
    return { ok: false, error: "NOTIFY_LEXI must stay 0 on cloud lab" };
  }
  if (!photos.length) {
    return { ok: false, error: "No photos to price" };
  }

  const form = new FormData();
  form.append("pool_n", String(opts?.pool_n ?? 20));
  form.append("min_conf", String(opts?.min_conf ?? 0.25));
  form.append("prefetch_n", String(opts?.prefetch_n ?? CLOUD_PREFETCH_N));
  appendBoardFiles(form, photos);

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
 */
export async function runCloudDetectAndPrefetch(
  env: Bindings,
  photos: PhotoBlob[],
  opts?: { pool_n?: number; min_conf?: number; prefetch_n?: number }
): Promise<CloudPrefetchResult> {
  const base = priceBase(env);
  const key = invokeKey(env);
  if (!base || !key) {
    return { ok: false, error: "CLOUD_PRICE_URL / CLOUD_PRICE_INVOKE_KEY not configured" };
  }
  if (String(env.NOTIFY_LEXI || "0") === "1") {
    return { ok: false, error: "NOTIFY_LEXI must stay 0 on cloud lab" };
  }
  if (!photos.length) {
    return { ok: false, error: "No photos to price" };
  }

  const form = new FormData();
  form.append("pool_n", String(opts?.pool_n ?? 20));
  form.append("min_conf", String(opts?.min_conf ?? 0.25));
  form.append("prefetch_n", String(opts?.prefetch_n ?? CLOUD_PREFETCH_N));
  appendBoardFiles(form, photos);

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
    prefetch_n: Number(body.prefetch_n || CLOUD_PREFETCH_N),
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
    body: JSON.stringify(boards && boards.length ? { boards } : {}),
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
  };
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
  // Rewrite asset URLs to go through this Worker proxy
  const proxied = html.replace(
    /\/jobs\/[^/"']+\/file\/testing_ui_visual_baseline\//g,
    `/api/cloud/jobs/${encodeURIComponent(jobId)}/file/testing_ui_visual_baseline/`
  );
  return new Response(proxied, {
    status: res.status,
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
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
}
