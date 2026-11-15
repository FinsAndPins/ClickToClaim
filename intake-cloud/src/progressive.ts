/**
 * Progressive cloud intake: moderate + promote + detect while the seller fills the form.
 * Lexi notify stays off. Production sellmycollection Worker is untouched.
 */
import type { Bindings } from "./types";
import { moderateImage } from "./moderation";
import { ensureJpegBytes } from "./cloud_price";
import { jpegNameFromOriginal, looksHeic } from "./reencode";

export type TempPhotoRow = {
  id: string;
  session_id: string;
  r2_key: string;
  original_filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
};

function nowIso() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function asciiMeta(value: string, max = 180): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function ensureDraftCollection(
  env: Bindings,
  sessionId: string
): Promise<{ collectionId: string; boxToken: string }> {
  const session = await env.DB.prepare(
    `SELECT id, collection_id, seller_name, seller_email FROM upload_sessions WHERE id = ?`
  )
    .bind(sessionId)
    .first<{ id: string; collection_id: string | null; seller_name: string; seller_email: string }>();
  if (!session) throw new Error("session_missing");
  if (session.collection_id) {
    const tok = await env.DB.prepare(`SELECT box_review_token FROM collections WHERE id = ?`)
      .bind(session.collection_id)
      .first<{ box_review_token: string | null }>();
    if (tok?.box_review_token) {
      return { collectionId: session.collection_id, boxToken: tok.box_review_token };
    }
    const boxToken = id();
    await env.DB.prepare(
      `UPDATE collections SET box_review_token = COALESCE(box_review_token, ?), updated_at = ? WHERE id = ?`
    )
      .bind(boxToken, nowIso(), session.collection_id)
      .run();
    return { collectionId: session.collection_id, boxToken };
  }

  const collectionId = id();
  const boxToken = id();
  const created = nowIso();
  await env.DB.prepare(
    `INSERT INTO collections (
      id, status, seller_name, seller_email, paypal_gs_email, instagram, accepted_terms_at,
      asking_cents, seller_notes, delivery_method, photo_count, box_review_token, created_at, updated_at,
      internal_note
    ) VALUES (?, 'uploading', ?, ?, ?, NULL, ?, NULL, NULL, NULL, 0, ?, ?, ?, ?)`
  )
    .bind(
      collectionId,
      session.seller_name || "Uploading…",
      session.seller_email || "draft@intake-cloud.local",
      session.seller_email || "draft@intake-cloud.local",
      created,
      boxToken,
      created,
      created,
      "Draft: photos ingesting while seller fills contact form"
    )
    .run();
  await env.DB.prepare(`UPDATE upload_sessions SET collection_id = ? WHERE id = ?`)
    .bind(collectionId, sessionId)
    .run();
  return { collectionId, boxToken };
}

/**
 * Moderate one temp photo, promote into the draft collection `photos` table, delete temp.
 * Returns ok:false if SafeSearch rejects (temp deleted).
 */
export async function moderateAndPromoteTempPhoto(
  env: Bindings,
  sessionId: string,
  photo: TempPhotoRow
): Promise<{ ok: true; collectionId: string } | { ok: false; codes: string[] }> {
  const obj = await env.BUCKET.get(photo.r2_key);
  if (!obj) {
    await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE id = ? AND session_id = ?`)
      .bind(photo.id, sessionId)
      .run();
    return { ok: false, codes: ["missing_object"] };
  }
  const buf = await obj.arrayBuffer();
  const result = await moderateImage(env, buf, photo.content_type || "image/jpeg");
  if (!result.ok) {
    try {
      await env.BUCKET.delete(photo.r2_key);
    } catch {
      /* ignore */
    }
    await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE id = ? AND session_id = ?`)
      .bind(photo.id, sessionId)
      .run();
    return { ok: false, codes: result.codes };
  }

  const { collectionId } = await ensureDraftCollection(env, sessionId);
  const existing = await env.DB.prepare(`SELECT id FROM photos WHERE id = ?`).bind(photo.id).first();
  if (existing) {
    await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE id = ? AND session_id = ?`)
      .bind(photo.id, sessionId)
      .run();
    return { ok: true, collectionId };
  }

  const re = await ensureJpegBytes(
    env,
    buf,
    photo.content_type || "image/jpeg",
    photo.original_filename || "photo.jpg"
  );
  if (!re.ok) {
    // Do not store raw HEIC (Cloud Run / Vision need JPEG). Drop temp; seller can re-add.
    try {
      await env.BUCKET.delete(photo.r2_key);
    } catch {
      /* ignore */
    }
    await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE id = ? AND session_id = ?`)
      .bind(photo.id, sessionId)
      .run();
    const heic = looksHeic(photo.content_type || "", photo.original_filename);
    return { ok: false, codes: [heic ? "heic_convert_failed" : `reencode_${re.reason}`] };
  }
  const storeBytes = re.bytes;
  const storeType = re.contentType;
  const storeName = re.filename || jpegNameFromOriginal(photo.original_filename);
  const digest = await crypto.subtle.digest("SHA-256", storeBytes);
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const destKey = `o_${photo.id}`;
  const created = nowIso();
  await env.BUCKET.put(destKey, storeBytes, {
    httpMetadata: { contentType: storeType },
    customMetadata: {
      collectionId,
      photoId: photo.id,
      kind: "original",
      timestamp: created,
      sha256: sha,
      early: "1",
      reencoded: "jpeg",
      reencode_reason: "",
    },
  });
  await env.DB.prepare(
    `INSERT INTO photos (id, collection_id, kind, r2_key, original_filename, content_type, size_bytes, sha256, moderation_status, created_at)
     VALUES (?, ?, 'original', ?, ?, ?, ?, ?, 'passed', ?)`
  )
    .bind(
      photo.id,
      collectionId,
      destKey,
      storeName,
      storeType,
      storeBytes.byteLength,
      sha,
      created
    )
    .run();
  try {
    await env.BUCKET.delete(photo.r2_key);
  } catch {
    /* ignore */
  }
  await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE id = ? AND session_id = ?`)
    .bind(photo.id, sessionId)
    .run();

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM photos WHERE collection_id = ?`
  )
    .bind(collectionId)
    .first<{ n: number }>();
  const n = Number(countRow?.n || 0);
  await env.DB.prepare(
    `UPDATE collections SET cover_photo_id = COALESCE(cover_photo_id, ?), photo_count = ?, updated_at = ? WHERE id = ?`
  )
    .bind(photo.id, n, nowIso(), collectionId)
    .run();

  return { ok: true, collectionId };
}

/** Schedule detect ~3s after last promote so multi-board picks batch together. */
export async function scheduleEarlyDetect(
  env: Bindings,
  sessionId: string,
  collectionId: string,
  runDetect: (collectionId: string, actor: string) => Promise<void>
): Promise<void> {
  const due = Date.now() + 3000;
  try {
    await env.DB.prepare(`UPDATE upload_sessions SET early_detect_due_ms = ? WHERE id = ?`)
      .bind(due, sessionId)
      .run();
  } catch {
    // Column may not exist until migrate; still attempt detect once.
  }
  await sleep(3100);
  try {
    const row = await env.DB.prepare(
      `SELECT early_detect_due_ms, collection_id, finish_started_at FROM upload_sessions WHERE id = ?`
    )
      .bind(sessionId)
      .first<{
        early_detect_due_ms: number | null;
        collection_id: string | null;
        finish_started_at: string | null;
      }>();
    if (row && row.early_detect_due_ms != null && Number(row.early_detect_due_ms) !== due) {
      return; // newer upload rescheduled
    }
  } catch {
    /* proceed */
  }
  await maybeStartOrRefreshDetect(env, collectionId, "early_upload", runDetect);
}

export async function maybeStartOrRefreshDetect(
  env: Bindings,
  collectionId: string,
  actor: string,
  runDetect: (collectionId: string, actor: string) => Promise<void>
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT id, mac_handoff_status, photo_count FROM collections WHERE id = ?`
  )
    .bind(collectionId)
    .first<{ id: string; mac_handoff_status: string | null; photo_count: number }>();
  if (!row || Number(row.photo_count || 0) < 1) return;

  const status = row.mac_handoff_status || "";
  if (status === "cloud_running" || status === "cloud_confirming" || status === "cloud_done") {
    return;
  }
  // Re-detect when more boards landed after an earlier awaiting_boxes job.
  if (status === "cloud_awaiting_boxes") {
    const photoN = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM photos WHERE collection_id = ?`
    )
      .bind(collectionId)
      .first<{ n: number }>();
    const stored = Number(photoN?.n || 0);
    // Folder is cloud:<job_id>; we don't store board count on the collection, so always refresh
    // when still uploading (status uploading) — finish path calls this with force via queued.
    const coll = await env.DB.prepare(`SELECT status FROM collections WHERE id = ?`)
      .bind(collectionId)
      .first<{ status: string }>();
    if (coll?.status === "uploading" && stored > 0) {
      await env.DB.prepare(
        `UPDATE collections SET mac_handoff_status = 'cloud_queued', mac_handoff_at = ?, updated_at = ? WHERE id = ?`
      )
        .bind(nowIso(), nowIso(), collectionId)
        .run();
      await runDetect(collectionId, actor);
      return;
    }
    return;
  }

  await env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'cloud_queued', mac_handoff_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(nowIso(), nowIso(), collectionId)
    .run();
  await runDetect(collectionId, actor);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function purgeAbandonedDraft(
  env: Bindings,
  collectionId: string
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT id, status, seller_email FROM collections WHERE id = ?`
  )
    .bind(collectionId)
    .first<{ id: string; status: string; seller_email: string }>();
  if (!row) return;
  if (row.status !== "uploading" && row.seller_email !== "draft@intake-cloud.local") return;

  const photos = await env.DB.prepare(`SELECT id, r2_key FROM photos WHERE collection_id = ?`)
    .bind(collectionId)
    .all<{ id: string; r2_key: string }>();
  for (const p of photos.results || []) {
    try {
      await env.BUCKET.delete(p.r2_key);
    } catch {
      /* ignore */
    }
    await env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(p.id).run();
  }
  await env.DB.prepare(`DELETE FROM collections WHERE id = ?`).bind(collectionId).run();
}
