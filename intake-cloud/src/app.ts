import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings, CollectionRow, PhotoRow } from "./types";
import { html, escapeHtml } from "./html";
import { moderateImage, hasModerationProvider } from "./moderation";
import {
  sendEmail,
  staffEmails,
  offerEmail,
  readyToPayEmail,
  moderationAlertEmail,
  sellerPhotosRejectedEmail,
  finishIncompleteStaffEmail,
} from "./email";
import { purgeAbandonedDraft } from "./progressive";
import { centsToDollars, declinedWantedMore, offerHelpers, parseDollarsToCents, percentOfValue } from "./money";
import { addDaysIso, canStaffMove, KANBAN_COLUMNS, offerDueLabel, offerExpired, staffNextStatuses } from "./workflow";
import { requireStaff, requireMacOrStaff } from "./auth";
import { getCookie, setCookie } from "hono/cookie";
import { INVITE_COOKIE, inviteGateEnabled, presentedInviteMatches } from "./invite";
import {
  cloudPricingConfigured,
  confirmCloudBoxes,
  ensureJpegBytes,
  fetchCloudHarnessHtml,
  fetchCloudJobFile,
  fetchCloudJobJson,
  CLOUD_PREFETCH_N,
  kickFinishRemaining,
  kickStartPrefetch,
  runCloudDetectAndPrefetch,
  runCloudPriceCollection,
  type PhotoSourceUrl,
} from "./cloud_price";
import { buildZip, safeZipBaseName } from "./zip";
import { folderNameFromSeller } from "./reencode";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);

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

type UploadSessionSnap = {
  id: string;
  seller_name: string;
  seller_email: string;
  paypal_gs_email: string;
  instagram: string | null;
  asking_cents: number | null;
  seller_notes: string | null;
  delivery_method: string | null;
  accepted_terms_at: string;
  processing_consent_at?: string | null;
  finish_started_at?: string | null;
  collection_id?: string | null;
};

/** Max photos to moderate+store per waitUntil/cron tick (avoids Worker CPU kill mid-finish). */
const FINISH_PHOTOS_PER_TICK = 4;

type TempPhotoSnap = {
  id: string;
  r2_key: string;
  original_filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
};

async function rejectModerationAndNotify(
  env: Bindings,
  session: UploadSessionSnap,
  photos: TempPhotoSnap[],
  failedCodes: string[]
): Promise<void> {
  for (const p of photos) {
    try {
      await env.BUCKET.delete(p.r2_key);
    } catch {
      /* ignore */
    }
  }
  await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE session_id = ?`).bind(session.id).run();
  await env.DB.prepare(`DELETE FROM upload_sessions WHERE id = ?`).bind(session.id).run();
  const alertId = id();
  await env.DB.prepare(
    `INSERT INTO moderation_alerts (id, seller_name, seller_email, paypal_gs_email, reason_codes, attempted_photo_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      alertId,
      session.seller_name,
      session.seller_email,
      session.paypal_gs_email,
      failedCodes.join(","),
      photos.length,
      nowIso()
    )
    .run();
  await logEvent(env.DB, null, "system", "moderation_rejected", {
    seller_email: session.seller_email,
    codes: failedCodes,
    count: photos.length,
  });
  const staff = moderationAlertEmail({
    sellerName: session.seller_name,
    sellerEmail: session.seller_email,
    paypal: session.paypal_gs_email,
    codes: failedCodes,
    count: photos.length,
  });
  staff.to = staffEmails(env);
  const s1 = await sendEmail(env, staff);
  const seller = sellerPhotosRejectedEmail(session.seller_name);
  seller.to = [session.seller_email];
  const s2 = await sendEmail(env, seller);
  await logEvent(env.DB, null, "system", "moderation_emails", { staff: s1, seller: s2 });
}

async function alertFinishIncomplete(
  env: Bindings,
  opts: {
    collectionId: string | null;
    sellerName: string;
    sellerEmail: string;
    expected: number;
    stored: number;
    detail: string;
  }
): Promise<void> {
  if (!opts.collectionId) return;
  const already = await env.DB.prepare(
    `SELECT id FROM events WHERE collection_id = ? AND type = 'finish_incomplete_alerted' LIMIT 1`
  )
    .bind(opts.collectionId)
    .first();
  if (already) return;
  await logEvent(env.DB, opts.collectionId, "system", "finish_incomplete", {
    expected: opts.expected,
    stored: opts.stored,
    detail: opts.detail.slice(0, 300),
    seller_email: opts.sellerEmail,
  });
  const mail = finishIncompleteStaffEmail({
    sellerName: opts.sellerName,
    sellerEmail: opts.sellerEmail,
    collectionId: opts.collectionId,
    expected: opts.expected,
    stored: opts.stored,
    adminLink: adminUrl(env, opts.collectionId),
    detail: opts.detail,
  });
  mail.to = staffEmails(env);
  const sent = await sendEmail(env, mail);
  await logEvent(env.DB, opts.collectionId, "system", "finish_incomplete_alerted", { sent });
}

/** Finish path when progressive promote already stored every board during the form. */
async function finalizeEarlySubmission(
  env: Bindings,
  collectionId: string,
  actor: string
): Promise<void> {
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM photos WHERE collection_id = ?`
  )
    .bind(collectionId)
    .first<{ n: number }>();
  const n = Number(countRow?.n || 0);
  await env.DB.prepare(
    `UPDATE collections SET photo_count = ?, status = CASE WHEN status = 'uploading' THEN 'submitted' ELSE status END, updated_at = ? WHERE id = ?`
  )
    .bind(n, nowIso(), collectionId)
    .run();
  const alreadySubmitted = await env.DB.prepare(
    `SELECT id FROM events WHERE collection_id = ? AND type = 'submitted' LIMIT 1`
  )
    .bind(collectionId)
    .first();
  if (!alreadySubmitted) {
    await logEvent(env.DB, collectionId, actor, "submitted", {
      photo_count: n,
      progressive_early: true,
    });
  }
  const row = await env.DB.prepare(
    `SELECT id, seller_name, status, mac_handoff_status FROM collections WHERE id = ?`
  )
    .bind(collectionId)
    .first<{ id: string; seller_name: string; status: string; mac_handoff_status: string | null }>();
  if (!row) return;
  const status = row.mac_handoff_status || "";
  // Seller finish: no auto Cloud Run detect. Staff uses admin Detect (future: internal BoardsToPrice).
  if (!status || status === "cloud_failed") {
    await env.DB.prepare(
      `UPDATE collections SET status = CASE WHEN status IN ('uploading','submitted') THEN 'pricing' ELSE status END, updated_at = ?, internal_note = ? WHERE id = ?`
    )
      .bind(nowIso(), "Submitted. Staff will price (admin Detect or Mac when enabled).", collectionId)
      .run();
    await logEvent(env.DB, collectionId, actor, "submitted_awaiting_staff", {
      photo_count: n,
      notify_lexi: false,
    });
  }
  const sessionRows = await env.DB.prepare(
    `SELECT id FROM upload_sessions WHERE collection_id = ? AND finish_started_at IS NOT NULL`
  )
    .bind(collectionId)
    .all<{ id: string }>();
  for (const s of sessionRows.results || []) {
    await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE session_id = ?`).bind(s.id).run();
    await env.DB.prepare(`DELETE FROM upload_sessions WHERE id = ?`).bind(s.id).run();
  }
}

/**
 * Idempotent finish: moderate → store remaining photos in small ticks.
 * Cron resumes if waitUntil is killed. Auto-queues CollectionsToPrice only when complete.
 */
async function processSubmissionBackground(
  env: Bindings,
  session: UploadSessionSnap,
  photos: TempPhotoSnap[]
): Promise<void> {
  let collectionId: string | null = session.collection_id || null;
  let stored = 0;
  try {
    if (!photos.length) {
      if (collectionId) {
        await finalizeEarlySubmission(env, collectionId, session.seller_email);
        return;
      }
      await logEvent(env.DB, collectionId, "system", "async_finish_error", {
        session_id: session.id,
        error: "no_temp_photos",
      });
      return;
    }

    const created = nowIso();
    if (!collectionId) {
      collectionId = id();
      const boxToken = id();
      await env.DB.prepare(
        `INSERT INTO collections (
          id, status, seller_name, seller_email, paypal_gs_email, instagram, accepted_terms_at,
          asking_cents, seller_notes, delivery_method, photo_count, box_review_token, created_at, updated_at
        ) VALUES (?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          collectionId,
          session.seller_name,
          session.seller_email,
          session.paypal_gs_email,
          session.instagram,
          session.accepted_terms_at,
          session.asking_cents,
          session.seller_notes ?? null,
          session.delivery_method,
          photos.length,
          boxToken,
          created,
          created
        )
        .run();
      await env.DB.prepare(`UPDATE upload_sessions SET collection_id = ? WHERE id = ?`)
        .bind(collectionId, session.id)
        .run();
      session.collection_id = collectionId;
    } else {
      await ensureBoxReviewToken(env.DB, collectionId);
    }

    const already = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM photos WHERE collection_id = ?`
    )
      .bind(collectionId)
      .first<{ n: number }>();
    stored = Number(already?.n || 0);

    let cover: string | null = null;
    let missingTemps = 0;

    // Collect up to FINISH_PHOTOS_PER_TICK unfinished temps, then normalize+Vision in parallel
    // (serial Cloud Run downscales were the main "Saving your photos…" latency).
    type FinishCandidate = { p: (typeof photos)[number]; buf: ArrayBuffer };
    const batch: FinishCandidate[] = [];
    for (const p of photos) {
      const exists = await env.DB.prepare(`SELECT id FROM photos WHERE id = ?`).bind(p.id).first();
      if (exists) {
        if (!cover) cover = p.id;
        continue;
      }
      if (batch.length >= FINISH_PHOTOS_PER_TICK) break;
      const obj = await env.BUCKET.get(p.r2_key);
      if (!obj) {
        missingTemps += 1;
        continue;
      }
      batch.push({ p, buf: await obj.arrayBuffer() });
    }

    type NormOk = {
      p: (typeof photos)[number];
      storeBytes: Uint8Array;
      storeType: string;
      storeName: string;
    };
    const prepared = await Promise.all(
      batch.map(async ({ p, buf }) => {
        const re = await ensureJpegBytes(env, buf, p.content_type || "image/jpeg", p.original_filename);
        if (!re.ok) {
          return { kind: "normalize_fail" as const, p, reason: re.reason };
        }
        const storeBytes = re.bytes;
        const storeType = re.contentType;
        const storeName = re.filename;
        const result = await moderateImage(
          env,
          storeBytes.buffer.slice(storeBytes.byteOffset, storeBytes.byteOffset + storeBytes.byteLength) as ArrayBuffer,
          storeType
        );
        if (!result.ok) {
          return { kind: "mod_fail" as const, p, codes: result.codes };
        }
        return { kind: "ok" as const, p, storeBytes, storeType, storeName } satisfies NormOk & { kind: "ok" };
      })
    );

    for (const item of prepared) {
      if (item.kind === "normalize_fail") {
        await logEvent(env.DB, collectionId, session.seller_email || "system", "photo_normalize_failed", {
          photo_id: item.p.id,
          reason: item.reason,
        });
        continue;
      }
      if (item.kind === "mod_fail") {
        await rejectModerationAndNotify(env, session, photos, item.codes);
        await env.DB.prepare(
          `UPDATE collections SET status = 'withdrawn', internal_note = ?, updated_at = ? WHERE id = ?`
        )
          .bind(
            `Auto-withdrawn: moderation reject (${item.codes.join(",")}). ${stored}/${photos.length} stored before reject.`,
            nowIso(),
            collectionId
          )
          .run();
        return;
      }
      const { p, storeBytes, storeType, storeName } = item;
      const digest = await crypto.subtle.digest("SHA-256", storeBytes);
      const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const destKey = `o_${p.id}`;
      await env.BUCKET.put(destKey, storeBytes, {
        httpMetadata: { contentType: storeType },
        customMetadata: {
          collectionId,
          sellerEmail: asciiMeta(session.seller_email, 120),
          photoId: p.id,
          kind: "original",
          timestamp: created,
          sha256: sha,
          reencoded: "jpeg",
          reencode_reason: "",
        },
      });
      await env.BUCKET.delete(p.r2_key);
      await env.DB.prepare(
        `INSERT INTO photos (id, collection_id, kind, r2_key, original_filename, content_type, size_bytes, sha256, moderation_status, created_at)
         VALUES (?, ?, 'original', ?, ?, ?, ?, ?, 'passed', ?)`
      )
        .bind(
          p.id,
          collectionId,
          destKey,
          storeName,
          storeType,
          storeBytes.byteLength,
          sha,
          created
        )
        .run();
      await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE id = ? AND session_id = ?`)
        .bind(p.id, session.id)
        .run();
      stored += 1;
      if (!cover) cover = p.id;
      await env.DB.prepare(
        `UPDATE collections SET cover_photo_id = COALESCE(cover_photo_id, ?), updated_at = ? WHERE id = ?`
      )
        .bind(cover, nowIso(), collectionId)
        .run();
    }

    if (batch.length >= FINISH_PHOTOS_PER_TICK && stored < photos.length) {
      await logEvent(env.DB, collectionId, "system", "finish_tick_yield", {
        stored,
        expected: photos.length,
        tick: FINISH_PHOTOS_PER_TICK,
      });
      // Leave session for cron / next waitUntil tick. Do not hand off yet.
      return;
    }

    const recount = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM photos WHERE collection_id = ?`
    )
      .bind(collectionId)
      .first<{ n: number }>();
    stored = Number(recount?.n || 0);

    // Done when every finish-batch photo is in `photos`. Do not require temp-row count
    // (temps are deleted per photo; a prior bug waited for temps==0 before deleting them).
    if (stored >= photos.length && stored >= 1) {
      if (cover) {
        await env.DB.prepare(`UPDATE collections SET cover_photo_id = COALESCE(cover_photo_id, ?), photo_count = ? WHERE id = ?`)
          .bind(cover, stored, collectionId)
          .run();
      } else {
        await env.DB.prepare(`UPDATE collections SET photo_count = ? WHERE id = ?`)
          .bind(stored, collectionId)
          .run();
      }
      const alreadySubmitted = await env.DB.prepare(
        `SELECT id FROM events WHERE collection_id = ? AND type = 'submitted' LIMIT 1`
      )
        .bind(collectionId)
        .first();
      if (!alreadySubmitted) {
        await logEvent(env.DB, collectionId, session.seller_email, "submitted", {
          photo_count: stored,
          async_moderation: true,
          has_seller_notes: Boolean(session.seller_notes),
        });
      }
      const row = await env.DB.prepare(
        `SELECT id, seller_name, status, mac_handoff_status FROM collections WHERE id = ?`
      )
        .bind(collectionId)
        .first<{ id: string; seller_name: string; status: string; mac_handoff_status: string | null }>();
      if (
        row &&
        row.mac_handoff_status !== "cloud_queued" &&
        row.mac_handoff_status !== "cloud_running" &&
        row.mac_handoff_status !== "cloud_awaiting_boxes" &&
        row.mac_handoff_status !== "cloud_confirming" &&
        row.mac_handoff_status !== "cloud_done" &&
        row.mac_handoff_status !== "queued" &&
        row.mac_handoff_status !== "delivered"
      ) {
        // Seller path = non-cloud: store photos and wait for staff. No auto detect/BBE.
        await env.DB.prepare(
          `UPDATE collections SET status = CASE WHEN status = 'submitted' THEN 'pricing' ELSE status END, updated_at = ?, internal_note = ? WHERE id = ?`
        )
          .bind(nowIso(), "Submitted. Staff will price (admin Detect or Mac when enabled).", row.id)
          .run();
        await logEvent(env.DB, row.id, session.seller_email, "submitted_awaiting_staff", {
          photo_count: stored,
          notify_lexi: false,
        });
      } else if (row) {
        await finalizeEarlySubmission(env, row.id, session.seller_email);
        return;
      }
      await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE session_id = ?`).bind(session.id).run();
      await env.DB.prepare(`DELETE FROM upload_sessions WHERE id = ?`).bind(session.id).run();
      return;
    }

    // Still incomplete: keep session for cron. Alert only when temps are gone and we cannot progress.
    await env.DB.prepare(
      `UPDATE collections SET photo_count = ?, updated_at = ? WHERE id = ?`
    )
      .bind(photos.length, nowIso(), collectionId)
      .run();

    if (missingTemps > 0 && stored + missingTemps >= photos.length && stored < photos.length) {
      await env.DB.prepare(
        `UPDATE collections SET internal_note = ?, updated_at = ? WHERE id = ?`
      )
        .bind(
          `Finish stuck: ${stored}/${photos.length} stored; ${missingTemps} temp object(s) missing. Seller should re-submit missing boards.`,
          nowIso(),
          collectionId
        )
        .run();
      await alertFinishIncomplete(env, {
        collectionId,
        sellerName: session.seller_name,
        sellerEmail: session.seller_email,
        expected: photos.length,
        stored,
        detail: `${missingTemps} missing temp object(s); cannot auto-complete`,
      });
    }
  } catch (e) {
    const detail = String(e).slice(0, 300);
    await logEvent(env.DB, collectionId, "system", "async_finish_error", {
      session_id: session.id,
      seller_email: session.seller_email,
      stored,
      expected: photos.length,
      error: detail,
    });
    // Leave session for cron retry unless hard-withdrawn above.
  }
}

/** Cron/waitUntil backup: resume any claimed finish that never reached auto handoff. */
async function processPendingFinishes(env: Bindings): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT * FROM upload_sessions
     WHERE finish_started_at IS NOT NULL
     ORDER BY finish_started_at ASC
     LIMIT 5`
  ).all<UploadSessionSnap>();
  for (const session of rows.results || []) {
    const temps = await env.DB.prepare(
      `SELECT id, r2_key, original_filename, content_type, size_bytes FROM upload_temp_photos WHERE session_id = ? ORDER BY created_at`
    )
      .bind(session.id)
      .all<TempPhotoSnap>();
    const photos = temps.results || [];
    if (!photos.length) {
      // Temps already promoted; finish may have died before detect was queued.
      if (session.collection_id) {
        const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM photos WHERE collection_id = ?`)
          .bind(session.collection_id)
          .first<{ n: number }>();
        const expectedRow = await env.DB.prepare(
          `SELECT photo_count, seller_name, seller_email, status, mac_handoff_status FROM collections WHERE id = ?`
        )
          .bind(session.collection_id)
          .first<{
            photo_count: number;
            seller_name: string;
            seller_email: string;
            status: string;
            mac_handoff_status: string | null;
          }>();
        const stored = Number(n?.n || 0);
        if (expectedRow && stored < expectedRow.photo_count) {
          await alertFinishIncomplete(env, {
            collectionId: session.collection_id,
            sellerName: expectedRow.seller_name,
            sellerEmail: expectedRow.seller_email,
            expected: expectedRow.photo_count,
            stored,
            detail: "finish session has no remaining temp photos",
          });
        } else if (expectedRow && stored >= 1 && !expectedRow.mac_handoff_status) {
          await env.DB.prepare(
            `UPDATE collections SET status = CASE WHEN status IN ('uploading','submitted') THEN 'pricing' ELSE status END, updated_at = ?, internal_note = ? WHERE id = ?`
          )
            .bind(
              nowIso(),
              "Submitted. Staff will price (admin Detect or Mac when enabled).",
              session.collection_id
            )
            .run();
          await logEvent(env.DB, session.collection_id, session.seller_email || "system:cron", "submitted_awaiting_staff", {
            photo_count: stored,
            via: "cron_finish",
            notify_lexi: false,
          });
          await env.DB.prepare(`DELETE FROM upload_sessions WHERE id = ?`).bind(session.id).run();
        } else {
          await env.DB.prepare(`DELETE FROM upload_sessions WHERE id = ?`).bind(session.id).run();
        }
      } else {
        await env.DB.prepare(`DELETE FROM upload_sessions WHERE id = ?`).bind(session.id).run();
      }
      continue;
    }
    await processSubmissionBackground(env, session, photos);
  }
}

async function logEvent(
  db: D1Database,
  collectionId: string | null,
  actor: string,
  type: string,
  payload?: unknown
) {
  await db
    .prepare(
      `INSERT INTO events (id, collection_id, actor, type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id(), collectionId, actor, type, payload ? JSON.stringify(payload) : null, nowIso())
    .run();
}

/**
 * Cloud lab: queue GCP pricing instead of Mac CollectionsToPrice handoff.
 * Reuses mac_handoff_* columns as cloud job markers so we avoid a schema fork.
 * Status: cloud_queued | cloud_running | cloud_awaiting_boxes | cloud_confirming | cloud_done | cloud_failed
 * Folder: cloud:<job_id> once a Cloud Run job exists.
 */
async function queueMacHandoff(
  db: D1Database,
  row: { id: string; seller_name: string; status: string },
  actor: string,
  extra?: { auto?: boolean }
): Promise<string> {
  const folder = `cloud_pending:${folderNameFromSeller(row.seller_name, row.id)}`;
  const updated = nowIso();
  await db
    .prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_queued', mac_handoff_folder = ?, mac_handoff_at = ?, updated_at = ? WHERE id = ?`
    )
    .bind(folder, updated, updated, row.id)
    .run();
  if (row.status === "submitted") {
    await db
      .prepare(`UPDATE collections SET status = 'pricing', updated_at = ? WHERE id = ?`)
      .bind(updated, row.id)
      .run();
  }
  await logEvent(db, row.id, actor, "cloud_price_queued", {
    folder,
    auto: extra?.auto === true,
    notify_lexi: false,
  });
  return folder;
}

async function ensureBoxReviewToken(db: D1Database, collectionId: string): Promise<string> {
  const row = await db
    .prepare(`SELECT box_review_token FROM collections WHERE id = ?`)
    .bind(collectionId)
    .first<{ box_review_token: string | null }>();
  if (row?.box_review_token) return row.box_review_token;
  const token = id();
  await db.prepare(`UPDATE collections SET box_review_token = ?, updated_at = ? WHERE id = ? AND box_review_token IS NULL`)
    .bind(token, nowIso(), collectionId)
    .run();
  const again = await db
    .prepare(`SELECT box_review_token FROM collections WHERE id = ?`)
    .bind(collectionId)
    .first<{ box_review_token: string | null }>();
  return again?.box_review_token || token;
}

async function collectionByBoxToken(
  db: D1Database,
  token: string
): Promise<(CollectionRow & { mac_handoff_status: string | null; mac_handoff_folder: string | null }) | null> {
  return db
    .prepare(
      `SELECT id, status, seller_name, seller_email, paypal_gs_email, instagram, accepted_terms_at,
              cover_photo_id, overlay_url, harness_total_cents, offer_cents, offer_sent_at, offer_expires_at,
              offer_token, box_review_token, internal_note, decline_reason, decline_wanted_cents, decline_detail,
              tracking, photo_count, created_at, updated_at, mac_handoff_status, mac_handoff_folder
       FROM collections WHERE box_review_token = ?`
    )
    .bind(token)
    .first();
}

function cloudJobIdFromFolder(folder: string | null | undefined): string | null {
  const m = /^cloud:(.+)$/.exec(String(folder || ""));
  return m ? m[1] : null;
}

/**
 * Build Cloud Run source_urls so the service pulls JPEGs from this Worker (R2 proxy).
 * Avoids pushing ~6MB×N boards through Cloud Run's ~32MB request body limit.
 */
function loadCollectionPhotoSources(env: Bindings, collectionId: string, photoRows: { id: string; original_filename: string | null }[]): PhotoSourceUrl[] {
  const base = String(env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const out: PhotoSourceUrl[] = [];
  let i = 0;
  for (const p of photoRows) {
    i += 1;
    const rawName = (p.original_filename || `board_${i}.jpg`).replace(/[^\w.\-]+/g, "_");
    const filename = /^IMG_\d+\.(jpe?g|png|webp)$/i.test(rawName)
      ? rawName.replace(/\.(png|webp)$/i, ".JPG")
      : `IMG_${String(1000 + i).padStart(4, "0")}.JPG`;
    out.push({
      filename,
      url: `${base}/internal/cloud-run/photos/${encodeURIComponent(p.id)}`,
    });
  }
  return out;
}

async function loadCollectionPhotoRows(
  env: Bindings,
  collectionId: string
): Promise<{ id: string; original_filename: string | null }[]> {
  const photos = await env.DB.prepare(
    `SELECT id, original_filename FROM photos WHERE collection_id = ? ORDER BY created_at`
  )
    .bind(collectionId)
    .all<{ id: string; original_filename: string | null }>();
  return photos.results || [];
}

/**
 * After RF-DETR (+ Match-window prefetch): confirm-as-detected and finish eBay.
 * Board Box Editor is optional later; edits call the same confirm path with a delta.
 */
async function continuePricingAfterDetect(
  env: Bindings,
  collectionId: string,
  jobId: string,
  actor: string,
  opts?: { via?: string }
): Promise<boolean> {
  const claim = await env.DB.prepare(
    `UPDATE collections
     SET mac_handoff_status = 'cloud_confirming', mac_handoff_folder = ?, mac_handoff_at = ?, updated_at = ?,
         internal_note = ?
     WHERE id = ? AND mac_handoff_status IN ('cloud_running', 'cloud_awaiting_boxes')`
  )
    .bind(
      `cloud:${jobId}`,
      nowIso(),
      nowIso(),
      "Detect done. Finishing eBay pricing (Board Box Editor optional)…",
      collectionId
    )
    .run();
  if (!claim.meta.changes) {
    return false;
  }
  await saveConfirmPending(env, collectionId, jobId, undefined);
  await logEvent(env.DB, collectionId, actor, "cloud_auto_confirm_started", {
    job_id: jobId,
    via: opts?.via || "auto",
    notify_lexi: false,
  });
  const result = await confirmCloudBoxes(env, jobId);
  if (!result.ok) {
    await env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_failed', mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
    )
      .bind(nowIso(), nowIso(), `Auto-confirm failed: ${(result.error || "").slice(0, 240)}`, collectionId)
      .run();
    await logEvent(env.DB, collectionId, actor, "cloud_price_failed", {
      error: result.error,
      via: opts?.via || "auto",
    });
    return false;
  }
  const harnessLocal = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/collections/${collectionId}/cloud-harness`;
  await env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'cloud_done', mac_handoff_folder = ?, mac_handoff_at = ?, updated_at = ?, overlay_url = ?, internal_note = ? WHERE id = ?`
  )
    .bind(
      `cloud:${result.job_id || jobId}`,
      nowIso(),
      nowIso(),
      harnessLocal,
      result.remaining_deferred
        ? "Harness ready. Remaining eBay finishing in background. Edit boxes only if needed (delta reprice)."
        : "Harness ready. Edit boxes only if needed (delta reprice).",
      collectionId
    )
    .run();
  await clearConfirmPending(env, collectionId);
  await logEvent(env.DB, collectionId, actor, "cloud_price_done", {
    job_id: result.job_id || jobId,
    pin_count: result.pin_count,
    priced_count: result.priced_count,
    elapsed_sec: result.elapsed_sec,
    auto_confirm: true,
    remaining_deferred: result.remaining_deferred,
    via: opts?.via || "auto",
    notify_lexi: false,
  });
  return true;
}

/**
 * Staff Detect: RF-DETR + Match-window eBay, then auto-continue into full pricing.
 * prefetch_n=0 remains detect-only (legacy); staff Detect uses default CLOUD_PREFETCH_N.
 */
async function runCloudDetectForCollection(
  env: Bindings,
  collectionId: string,
  actor: string,
  opts?: { prefetch_n?: number }
): Promise<void> {
  if (!cloudPricingConfigured(env)) {
    await logEvent(env.DB, collectionId, actor, "cloud_price_failed", {
      error: "CLOUD_PRICE_URL / CLOUD_PRICE_INVOKE_KEY missing",
    });
    await env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_failed', mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
    )
      .bind(nowIso(), nowIso(), "Cloud pricing not configured on this Worker", collectionId)
      .run();
    return;
  }
  const prefetchN = opts?.prefetch_n != null ? opts.prefetch_n : CLOUD_PREFETCH_N;
  await env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'cloud_running', mac_handoff_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(nowIso(), nowIso(), collectionId)
    .run();

  const rows = await loadCollectionPhotoRows(env, collectionId);
  const sources = loadCollectionPhotoSources(env, collectionId, rows);
  const base = String(env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const result = await runCloudDetectAndPrefetch(env, sources, {
    pool_n: 20,
    min_conf: 0.25,
    prefetch_n: prefetchN,
    collection_id: collectionId,
    callback_url: `${base}/internal/cloud-run/detect-complete`,
  });
  if (!result.ok || !result.job_id) {
    await logEvent(env.DB, collectionId, actor, "cloud_price_failed", { error: result.error });
    await env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_failed', mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
    )
      .bind(nowIso(), nowIso(), `Cloud detect failed: ${(result.error || "").slice(0, 240)}`, collectionId)
      .run();
    return;
  }

  await env.DB.prepare(
    `UPDATE collections SET mac_handoff_folder = ?, mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
  )
    .bind(
      `cloud:${result.job_id}`,
      nowIso(),
      nowIso(),
      prefetchN <= 0
        ? `Detect-only (${result.pin_count || "?"} pins).`
        : `Detect OK (${result.pin_count || "?"} pins, ${result.prefetch_priced || "?"} prefetched). Continuing eBay…`,
      collectionId
    )
    .run();
  await logEvent(env.DB, collectionId, actor, "cloud_detect_ready", {
    job_id: result.job_id,
    pin_count: result.pin_count,
    prefetch_priced: result.prefetch_priced,
    prefetch_n: prefetchN,
    detect_only: prefetchN <= 0,
    notify_lexi: false,
  });

  // Detect-only stays parked; normal staff Detect auto-prices without requiring BBE.
  if (prefetchN <= 0) {
    await env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_awaiting_boxes', updated_at = ? WHERE id = ? AND mac_handoff_status = 'cloud_running'`
    )
      .bind(nowIso(), collectionId)
      .run();
    return;
  }
  await continuePricingAfterDetect(env, collectionId, result.job_id, actor, { via: "detect_sync" });
}

/** On Submit: if detect-only already ran, queue Match-window eBay without re-detect. */
async function ensureMatchWindowPrefetch(
  env: Bindings,
  collectionId: string,
  actor: string
): Promise<void> {
  const row = await env.DB.prepare(`SELECT mac_handoff_folder, mac_handoff_status FROM collections WHERE id = ?`)
    .bind(collectionId)
    .first<{ mac_handoff_folder: string | null; mac_handoff_status: string | null }>();
  const status = row?.mac_handoff_status || "";
  if (status !== "cloud_awaiting_boxes" && status !== "cloud_running") return;
  const jobId = cloudJobIdFromFolder(row?.mac_handoff_folder);
  if (!jobId) return;
  const st = await fetchCloudJobJson(env, jobId, "status.json");
  if (!st.ok) return;
  const priced = Number(st.body.prefetch_priced || 0);
  const want = CLOUD_PREFETCH_N;
  if (priced >= Math.min(3, want)) return; // already has a usable Match window
  const kick = await kickStartPrefetch(env, jobId, want);
  await logEvent(env.DB, collectionId, actor, "match_window_prefetch_kicked", {
    job_id: jobId,
    ok: kick.ok,
    error: kick.error || null,
    prior_priced: priced,
  });
  if (kick.ok) {
    await env.DB.prepare(
      `UPDATE collections SET updated_at = ?, internal_note = ? WHERE id = ?`
    )
      .bind(nowIso(), "Submit: Match-window eBay queued on existing detect job.", collectionId)
      .run();
  }
}

/** One-shot (skip box editor): detect + full eBay + harness. */
async function runCloudPricingForCollection(env: Bindings, collectionId: string, actor: string): Promise<void> {
  if (!cloudPricingConfigured(env)) {
    await logEvent(env.DB, collectionId, actor, "cloud_price_failed", {
      error: "CLOUD_PRICE_URL / CLOUD_PRICE_INVOKE_KEY missing",
    });
    await env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_failed', mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
    )
      .bind(nowIso(), nowIso(), "Cloud pricing not configured on this Worker", collectionId)
      .run();
    return;
  }
  await env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'cloud_running', mac_handoff_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(nowIso(), nowIso(), collectionId)
    .run();

  const rows = await loadCollectionPhotoRows(env, collectionId);
  const sources = loadCollectionPhotoSources(env, collectionId, rows);
  const result = await runCloudPriceCollection(env, sources, { pool_n: 20, min_conf: 0.25 });
  if (!result.ok || !result.job_id) {
    await logEvent(env.DB, collectionId, actor, "cloud_price_failed", { error: result.error });
    await env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_failed', mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
    )
      .bind(nowIso(), nowIso(), `Cloud pricing failed: ${(result.error || "").slice(0, 240)}`, collectionId)
      .run();
    return;
  }

  const harnessLocal = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/collections/${collectionId}/cloud-harness`;
  await env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'cloud_done', mac_handoff_folder = ?, mac_handoff_at = ?, updated_at = ?, overlay_url = ? WHERE id = ?`
  )
    .bind(`cloud:${result.job_id}`, nowIso(), nowIso(), harnessLocal, collectionId)
    .run();
  await logEvent(env.DB, collectionId, actor, "cloud_price_done", {
    job_id: result.job_id,
    pin_count: result.pin_count,
    priced_count: result.priced_count,
    elapsed_sec: result.elapsed_sec,
    notify_lexi: false,
    one_shot: true,
  });
}

function adminUrl(env: Bindings, collectionId: string) {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/collections/${collectionId}`;
}

function offerUrl(env: Bindings, token: string) {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/o/${token}`;
}

/** Staff: open PayPal checkout prefilled for Goods & Services to this seller. */
function paypalPayUrl(email: string, offerCents: number | null): string {
  const params = new URLSearchParams({
    cmd: "_xclick",
    business: email.trim(),
    currency_code: "USD",
    no_shipping: "1",
    item_name: "Fins & Pins pin collection",
  });
  if (offerCents != null && offerCents > 0) {
    params.set("amount", (offerCents / 100).toFixed(2));
  }
  return `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
}

async function loadCollectionPhotos(db: D1Database, collectionId: string): Promise<PhotoRow[]> {
  const photos = await db
    .prepare(`SELECT * FROM photos WHERE collection_id = ? ORDER BY created_at`)
    .bind(collectionId)
    .all<PhotoRow>();
  return photos.results || [];
}

/** Seller-facing gallery for offer / accept pages (token-gated image URLs). */
function offerPhotoGridHtml(token: string, photos: PhotoRow[]): string {
  if (!photos.length) return "";
  const imgs = photos
    .map(
      (p) =>
        `<a href="/o/${encodeURIComponent(token)}/photos/${encodeURIComponent(p.id)}" target="_blank" rel="noopener">
           <img src="/o/${encodeURIComponent(token)}/photos/${encodeURIComponent(p.id)}" alt="Board photo you uploaded" loading="lazy" />
         </a>`
    )
    .join("");
  return `<div class="offer-photos">
    <h2>Your uploaded photos</h2>
    <div class="photo-grid offer-photo-grid">${imgs}</div>
  </div>`;
}

/** Parse PriceCollection_* folder name from a PreparingInventory Pages CTM/CTP URL. */
function preparingInventoryFinalName(overlayUrl: string): string | null {
  const m = overlayUrl.match(/\/PreparingInventory\/(PriceCollection_[^/?#]+)\//i);
  return m ? m[1] : null;
}

function parseDisplayPriceCents(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw * 100);
  }
  if (typeof raw === "string") {
    return parseDollarsToCents(raw);
  }
  return null;
}

/**
 * Staff "Pull total from Firebase": sum display_price on pins Lexi has priced
 * (CTM Match / CTP / manual all write display_price on the harness).
 * Cloud lab: load ui_data from the Cloud Run job; Mac/Pages: PreparingInventory URL.
 */
async function pullHarnessTotalFromFirebase(
  overlayUrl: string,
  opts?: { env?: Bindings; jobId?: string | null }
): Promise<{
  ok: true;
  totalCents: number;
  priced: number;
  pinCount: number;
  testRunId: string;
} | { ok: false; error: string }> {
  let ui: {
    test_run_id?: string;
    approach_id?: string;
    global_pin_count?: number;
  } | null = null;

  if (opts?.env && opts.jobId) {
    const cloudUi = await fetchCloudJobJson(
      opts.env,
      opts.jobId,
      "testing_ui_visual_baseline/ui_data.json"
    );
    if (cloudUi.ok) {
      ui = cloudUi.body as typeof ui;
    } else {
      const alt = await fetchCloudJobJson(opts.env, opts.jobId, "mac_run/testing_ui_visual_baseline/ui_data.json");
      if (alt.ok) ui = alt.body as typeof ui;
      else {
        return { ok: false, error: `Could not load cloud harness ui_data.json: ${cloudUi.error}` };
      }
    }
  } else {
    const finalName = preparingInventoryFinalName(overlayUrl);
    if (!finalName) {
      return { ok: false, error: "Could not read the PriceCollection name from the overlay link." };
    }
    const uiDataUrl = `https://finsandpins.github.io/PreparingInventory/${finalName}/testing_ui_visual_baseline/ui_data.json`;
    try {
      const res = await fetch(uiDataUrl);
      if (!res.ok) {
        return { ok: false, error: `Could not load harness ui_data.json (HTTP ${res.status}).` };
      }
      ui = (await res.json()) as typeof ui;
    } catch {
      return { ok: false, error: "Could not load harness ui_data.json from GitHub Pages." };
    }
  }
  if (!ui) {
    return { ok: false, error: "Could not load harness ui_data.json." };
  }
  const testRunId = String(ui.test_run_id || "").trim();
  const approachId = String(ui.approach_id || "visual_baseline").trim() || "visual_baseline";
  if (!testRunId) {
    return { ok: false, error: "Harness ui_data.json is missing test_run_id." };
  }
  const pinsUrl = `https://fins-and-pins-click-to-claim-default-rtdb.firebaseio.com/pin_pricing_tests/${encodeURIComponent(testRunId)}/${encodeURIComponent(approachId)}/pins.json`;
  let pins: Record<string, unknown> | null;
  try {
    const res = await fetch(pinsUrl);
    if (!res.ok) {
      return { ok: false, error: `Firebase read failed (HTTP ${res.status}).` };
    }
    pins = (await res.json()) as Record<string, unknown> | null;
  } catch {
    return { ok: false, error: "Could not read pin prices from Firebase." };
  }
  if (!pins || typeof pins !== "object") {
    return {
      ok: false,
      error: "No Firebase prices yet. Open the overlay, finish CTM/CTP or manual prices, then pull again.",
    };
  }
  let totalCents = 0;
  let priced = 0;
  for (const v of Object.values(pins)) {
    if (!v || typeof v !== "object") continue;
    const cents = parseDisplayPriceCents((v as { display_price?: unknown }).display_price);
    if (cents == null) continue;
    totalCents += cents;
    priced += 1;
  }
  if (!priced) {
    return {
      ok: false,
      error: "Firebase has pin rows but no display_price values yet. Finish matching, then pull again.",
    };
  }
  const pinCount = Number(ui.global_pin_count) || Object.keys(pins).length;
  return { ok: true, totalCents, priced, pinCount, testRunId };
}

function strField(v: unknown): string {
  return String(v ?? "").trim();
}

async function readFinishIdentity(c: Context<{ Bindings: Bindings }>): Promise<{
  seller_name: string;
  seller_email: string;
  asking_raw: string;
  instagram: string | null;
  asking_cents: number | null;
  delivery_method: string;
  seller_notes: string | null;
  agree: boolean;
}> {
  const ct = (c.req.header("content-type") || "").toLowerCase();
  let raw: Record<string, unknown> = {};
  if (ct.includes("application/json")) {
    const parsed = await c.req.json().catch(() => ({}));
    raw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } else {
    try {
      const form = await c.req.parseBody();
      raw = form as Record<string, unknown>;
    } catch {
      raw = {};
    }
  }
  const notes = strField(raw.seller_notes) || strField(raw.notes);
  const agreeRaw = raw.agree;
  const agree =
    strField(agreeRaw) === "yes" ||
    agreeRaw === true ||
    strField(agreeRaw) === "true" ||
    strField(agreeRaw) === "on";
  const asking_raw = strField(raw.asking);
  return {
    seller_name: strField(raw.seller_name),
    seller_email: strField(raw.seller_email).toLowerCase(),
    asking_raw,
    instagram: strField(raw.instagram) || null,
    asking_cents: parseDollarsToCents(asking_raw),
    delivery_method: strField(raw.delivery) || strField(raw.delivery_method),
    seller_notes: notes ? notes.slice(0, 2000) : null,
    agree,
  };
}

function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

/** Build one error that names every blank / invalid required finish field. */
function finishIdentityError(opts: {
  seller_name: string;
  seller_email: string;
  asking_raw?: string;
  asking_cents: number | null;
  delivery_method: string;
  agree: boolean;
}): string | null {
  const missing: string[] = [];
  const other: string[] = [];
  if (!opts.seller_name) missing.push("Name");
  if (!opts.seller_email) missing.push("Email address");
  else if (!looksLikeEmail(opts.seller_email)) other.push("Email address looks invalid.");
  const askingBlank = !(opts.asking_raw || "").trim() && opts.asking_cents == null;
  if (askingBlank) missing.push("Price you have in mind");
  else if (opts.asking_cents == null) {
    other.push("Price must be greater than $0 (for example 1000, not 0).");
  }
  const deliveryOk =
    opts.delivery_method === "ship_us" || opts.delivery_method === "dropoff_florida";
  if (!deliveryOk) missing.push("How you'll get the pins to us");
  if (!opts.agree) missing.push("Privacy and terms checkbox");
  if (!missing.length && !other.length) return null;
  const parts: string[] = [];
  if (missing.length === 1) parts.push(`Please fill in: ${missing[0]}.`);
  else if (missing.length > 1) parts.push(`Please fill in: ${missing.join(", ")}.`);
  parts.push(...other);
  return parts.join(" ");
}

function inviteCookieOptions(env: Bindings) {
  return {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "Lax" as const,
    secure: (env.ENVIRONMENT || "").toLowerCase() === "production",
  };
}

function sellerHasInvite(c: Context<{ Bindings: Bindings }>): boolean {
  if (!inviteGateEnabled(c.env)) return true;
  const q = c.req.query("invite");
  if (presentedInviteMatches(c.env, q)) return true;
  return presentedInviteMatches(c.env, getCookie(c, INVITE_COOKIE));
}

function inviteGatePage(env: Bindings, err?: string) {
  const flash = err ? `<div class="flash err">${escapeHtml(err)}</div>` : "";
  return html(
    env,
    "Invite only",
    `${flash}
    <h1>Private preview</h1>
    <p class="lede">This page is invite-only while we try it out. If you have a code, enter it below.</p>
    <div class="card">
      <form method="post" action="/invite">
        <label>Invite code<input required name="code" autocomplete="off" /></label>
        <button type="submit">Continue</button>
      </form>
    </div>`
  );
}

export const app = new Hono<{ Bindings: Bindings }>();

const OPEN_PATHS = new Set(["/health", "/styles.css", "/invite", "/ctr-bg-canva.jpg", "/seller-home.js"]);

app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (
    path.startsWith("/admin") ||
    path.startsWith("/o/") ||
    path.startsWith("/boxes/") ||
    path.startsWith("/api/boxes/") ||
    path.startsWith("/api/cloud/") ||
    path.startsWith("/api/mac/") ||
    path.startsWith("/internal/cloud-run/") ||
    OPEN_PATHS.has(path)
  ) {
    // /boxes + /api/boxes use box_review_token; /api/cloud is staff-gated on the route;
    // /internal/cloud-run uses invoke key. /api/cloud must bypass invite so harness
    // assets (CTM/CTP/ui_data) load after "Open pricing overlay".
    return next();
  }
  const q = c.req.query("invite");
  if (q && presentedInviteMatches(c.env, q)) {
    setCookie(c, INVITE_COOKIE, q, inviteCookieOptions(c.env));
    if (path === "/" && q) {
      return c.redirect("/");
    }
    return next();
  }
  if (sellerHasInvite(c)) return next();
  if (path.startsWith("/api/")) {
    return c.json({ error: "Invite required" }, 403);
  }
  return inviteGatePage(c.env);
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "intake-cloud-lab",
    cloud_lab: String(c.env.CLOUD_LAB || "") === "1",
    cloud_price_configured: cloudPricingConfigured(c.env),
    notify_lexi: String(c.env.NOTIFY_LEXI || "0") === "1",
    mac_handoff: false,
    moderation: hasModerationProvider(c.env)
      ? "configured"
      : c.env.ENVIRONMENT === "development"
        ? "dev_pass"
        : "missing",
    email: c.env.RESEND_API_KEY ? "configured" : "missing",
  })
);

app.post("/invite", async (c) => {
  const form = await c.req.parseBody();
  const code = String(form.code || "").trim();
  if (!presentedInviteMatches(c.env, code)) {
    return inviteGatePage(c.env, "That code didn’t work.");
  }
  setCookie(c, INVITE_COOKIE, code, inviteCookieOptions(c.env));
  return c.redirect("/");
});


app.get("/styles.css", async (c) => {
  const res = await c.env.ASSETS.fetch(new URL("/styles.css", c.req.url));
  return res;
});

app.get("/ctr-bg-canva.jpg", async (c) => {
  const res = await c.env.ASSETS.fetch(new URL("/ctr-bg-canva.jpg", c.req.url));
  if (res.status === 404) return c.notFound();
  return res;
});

app.get("/seller-home.js", async (c) => {
  const res = await c.env.ASSETS.fetch(new URL("/seller-home.js", c.req.url));
  if (res.status === 404) return c.notFound();
  const headers = new Headers(res.headers);
  headers.set("content-type", "application/javascript; charset=utf-8");
  headers.set("cache-control", "no-store, max-age=0");
  return new Response(res.body, { status: res.status, headers });
});

app.get("/", (c) => {
  const err = c.req.query("err");
  const ok = c.req.query("ok");
  const flash = err
    ? `<div class="flash err">${escapeHtml(err)}</div>`
    : ok
      ? `<div class="flash ok">${escapeHtml(ok)}</div>`
      : "";
  const maxPhotos = Number(c.env.MAX_PHOTOS || 100);
  const maxBytes = Number(c.env.MAX_PHOTO_BYTES || 15728640);
  return html(
    c.env,
    "Sell my collection",
    `${flash}
    <h1 class="welcome">Welcome to the website of Fins and Pins!</h1>
    <p class="welcome-next">The easiest way to sell your collection</p>
    <p class="lede">We pay reasonable prices for authentic Disney pins! Simply upload photos of the boards you want to sell and we’ll email you our best offer for everything in those photos within 24-48 business hours. Currently we only buy collections that ship within the United States, or that you drop off with us in person at a pin event in Florida. Thank you for your understanding</p>
    <p class="steps-overview">Two steps. Photos first, then a short form while they upload.</p>
    <div class="card step-card" id="step1">
      <p class="step-kicker">Step 1 of 2</p>
      <h2>Upload board photos</h2>
      <ul class="legal">
        <li>One board (or one clear group of pins) per photo.</li>
        <li>Fill the frame with the pins. Straight-on is better than a steep angle.</li>
        <li>Use even light. Avoid heavy glare on cellophane if you can.</li>
        <li>Don’t include people, faces, or anything that isn’t the pins.</li>
      </ul>
      <p class="hint">Up to ${maxPhotos} photos, ${Math.round(maxBytes / 1024 / 1024)}&nbsp;MB each. Upload starts as soon as you pick files.</p>
      <div class="choose-wrap">
        <input id="files" class="choose-input" type="file" accept="image/*" multiple />
        <label for="files" class="choose-btn">Choose board photos</label>
      </div>
      <div class="upload-status" id="uploadStatus">Choose board photos to get started.</div>
      <div class="thumbs" id="thumbs"></div>
    </div>
    <div class="card step-card is-locked" id="step2" aria-hidden="true">
      <p class="step-kicker">Step 2 of 2</p>
      <h2>Contact information</h2>
      <p class="almost" id="almostDone" hidden>You’re almost done. Fill this in while your photos upload.</p>
      <form id="contactForm" novalidate>
        <fieldset class="contact-fields" id="contactFields">
          <label>Name (required)<input required type="text" name="seller_name" autocomplete="name" /></label>
          <label>Email address (required)<input required type="email" name="seller_email" autocomplete="email" /></label>
          <p class="hint">We'll send the offer to this address. Use the link in that email to accept or decline.</p>
          <label>Price you have in mind (required)
            <input required type="text" name="asking" inputmode="decimal" placeholder="$" autocomplete="off" />
          </label>
          <label>Notes <span class="hint">(optional)</span>
            <textarea name="seller_notes" maxlength="2000" placeholder="AP / PP, extras, anything not obvious in the photos"></textarea>
          </label>
          <p class="hint">Please tell us anything that’s not obvious in the photos, for example AP / PP.</p>
          <label>Instagram <span class="hint">(optional)</span><input type="text" name="instagram" placeholder="@you" autocomplete="username" /></label>
          <fieldset class="delivery">
            <legend>How will you get the pins to us?</legend>
            <label class="agree">
              <input required type="radio" name="delivery" value="ship_us" />
              <span>I will ship within the United States (USPS, UPS, or similar).</span>
            </label>
            <p class="or-line">or</p>
            <label class="agree">
              <input required type="radio" name="delivery" value="dropoff_florida" />
              <span>I will drop off with Fins and Pins at a pin event in person in Florida.</span>
            </label>
          </fieldset>
          <label class="agree">
            <input required type="checkbox" name="agree" value="yes" />
            <span>I agree to the <a href="/privacy">privacy and terms</a>. Photos you pick are held briefly so they can upload while you fill this form. They are not a submitted collection until you tap Submit. Rejected files are not stored. If we buy the collection, we may keep board photos and pin detections for our research.</span>
          </label>
          <div class="flash err form-err" id="formErr" hidden></div>
          <div class="row">
            <button id="submitAll" type="submit" disabled>Submit collection</button>
          </div>
        </fieldset>
      </form>
    </div>
    <script>window.INTAKE = ${JSON.stringify({ maxPhotos, maxBytes })};</script>
    <script src="/seller-home.js?v=20261116simple"></script>`
  );
});

app.get("/privacy", (c) => {
  return html(
    c.env,
    "Privacy and terms",
    `<h1>Privacy and terms</h1>
    <div class="card legal">
      <p>We're Fins and Pins. We buy authentic Disney pin collections that ship within the United States, or that you drop off with us in person at a pin event in Florida. Upload photos of the boards you want to sell. We'll email you our best offer for everything in those photos, usually within 24 hours. There is no minimum number of pins or photos.</p>
      <h2>What you send us</h2>
      <p>Your name, email, the price you have in mind, optional notes (for example AP / PP), optional Instagram, how you'll get the pins to us, and board photos. If you accept an offer, we ask for a PayPal Goods and Services email so we can pay you.</p>
      <h2>Photo checks</h2>
      <p>You pick photos first. We hold those files briefly so they can upload while you fill in your contact information. They are not a submitted collection until you tap Submit. After you submit, every photo is checked by automated safety filters. You see a confirmation right away. If a photo doesn't pass, it is deleted and we email you. If you leave without submitting, leftover files are deleted. We may also email ourselves your name, email, and a reason code (not the image) so we know a submission was blocked.</p>
      <h2>What we keep</h2>
      <p>Photos that pass may be kept as board photos and as pin detections. We keep detections for our research. We keep board photos for now. We may later delete board photos after a set time, after we receive a collection, or after an offer is declined.</p>
      <h2>Offers</h2>
      <p>We send one total offer for everything in the photos you uploaded. You can accept or decline with the link in that email. Declining is fine. No pressure. If you tell us why you declined, we use that to learn.</p>
      <h2>Getting pins to us and payment</h2>
      <p>You choose either: ship within the United States (USPS, UPS, or similar), or drop off with Fins and Pins at a pin event in person in Florida. If you accept, we pay PayPal Goods and Services first. If you chose shipping, you then ship to us in Florida using your own postage, and we show our ship-to address after you accept. If you chose drop-off, we'll coordinate the Florida event handoff after you accept.</p>
      <h2>How we email you</h2>
      <p>We only email about your offer, using the address you enter. Use the link in that email to accept or decline. If a photo fails automated safety checks, we email you and delete those files.</p>
    </div>`
  );
});

app.post("/api/upload-sessions", async (c) => {
  try {
    const sessionId = id();
    const created = nowIso();
    const exp = new Date(Date.now() + 40 * 60 * 1000).toISOString();
    // accepted_terms_at filled at Submit (privacy checkbox). Upload may start before that.
    await c.env.DB.prepare(
      `INSERT INTO upload_sessions (id, seller_name, seller_email, paypal_gs_email, instagram, asking_cents, delivery_method, accepted_terms_at, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(sessionId, "", "", "", null, null, null, "", created, exp)
      .run();
    await logEvent(c.env.DB, null, "seller", "photo_session_started", { sessionId });
    return c.json({ ok: true, sessionId });
  } catch (e) {
    console.error("upload_session_create_failed", e);
    return c.json({ error: "Could not start upload. Please try again." }, 500);
  }
});

app.post("/api/submissions", async (c) => {
  try {
    const form = await c.req.parseBody();
    const seller_name = String(form.seller_name || "").trim();
    const seller_email = String(form.seller_email || "").trim().toLowerCase();
    const instagram = String(form.instagram || "").trim() || null;
    const asking_raw = String(form.asking || "");
    const asking_cents = parseDollarsToCents(asking_raw);
    const delivery = String(form.delivery || "").trim();
    const agree = String(form.agree || "") === "yes";
    const identityErr = finishIdentityError({
      seller_name,
      seller_email,
      asking_raw,
      asking_cents,
      delivery_method: delivery,
      agree,
    });
    if (identityErr) {
      return c.redirect("/?err=" + encodeURIComponent(identityErr));
    }
    const paypal_gs_email = seller_email;
    const sessionId = id();
    const created = nowIso();
    const exp = new Date(Date.now() + 40 * 60 * 1000).toISOString();
    await c.env.DB.prepare(
      `INSERT INTO upload_sessions (id, seller_name, seller_email, paypal_gs_email, instagram, asking_cents, delivery_method, accepted_terms_at, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sessionId,
        seller_name,
        seller_email,
        paypal_gs_email,
        instagram,
        asking_cents,
        delivery,
        created,
        created,
        exp
      )
      .run();
    await logEvent(c.env.DB, null, seller_email, "session_started", { sessionId, delivery });
    return c.redirect(`/upload/${sessionId}`);
  } catch (e) {
    console.error("submissions_create_failed", e);
    return c.redirect(
      "/?err=" + encodeURIComponent("Something went wrong starting your upload. Please try again.")
    );
  }
});

app.get("/upload/:sessionId", async (c) => {
  const session = await c.env.DB.prepare(`SELECT * FROM upload_sessions WHERE id = ?`)
    .bind(c.req.param("sessionId"))
    .first<{ id: string; expires_at: string }>();
  if (!session) return html(c.env, "Not found", `<div class="flash err">Upload session not found.</div>`);
  if (new Date(session.expires_at) < new Date()) {
    return html(c.env, "Expired", `<div class="flash err">That upload session expired. Please start again.</div><p><a class="btn" href="/">Start over</a></p>`);
  }
  const maxPhotos = Number(c.env.MAX_PHOTOS || 100);
  const maxBytes = Number(c.env.MAX_PHOTO_BYTES || 15728640);
  return html(
    c.env,
    "Upload photos",
    `<h1>Upload board photos</h1>
    <p class="lede">Up to ${maxPhotos} photos, ${Math.round(maxBytes / 1024 / 1024)}&nbsp;MB each. After you submit, we run automated safety filters in the background. If a photo doesn’t pass, we’ll email you and those files are not kept.</p>
    <div class="card">
      <h2>How to shoot a board</h2>
      <ul class="legal">
        <li>One board (or one clear group of pins) per photo.</li>
        <li>Fill the frame with the pins. Straight-on is better than a steep angle.</li>
        <li>Use even light. Avoid heavy glare on cellophane if you can.</li>
        <li>Don’t include people, faces, or anything that isn’t the pins.</li>
      </ul>
      <div class="choose-wrap">
        <input id="files" class="choose-input" type="file" accept="image/*" multiple />
        <label for="files" class="choose-btn">Choose board photos</label>
      </div>
      <p class="hint">Upload starts when you tap Submit.</p>
      <div class="progress" id="status"></div>
      <div class="row">
        <button id="go" type="button">Submit photos</button>
      </div>
    </div>
    <script>
      const sessionId = ${JSON.stringify(c.req.param("sessionId"))};
      const maxPhotos = ${maxPhotos};
      const maxBytes = ${maxBytes};
      const filesEl = document.getElementById('files');
      const status = document.getElementById('status');
      const go = document.getElementById('go');
      async function readJson(res) {
        const text = await res.text();
        try { return text ? JSON.parse(text) : {}; }
        catch (_) {
          throw new Error(res.ok
            ? 'Unexpected response from server.'
            : ('Something went wrong (HTTP ' + res.status + '). Please try again.'));
        }
      }
      go.onclick = async () => {
        const files = Array.from(filesEl.files || []);
        if (!files.length) { status.textContent = 'Choose at least one photo.'; return; }
        if (files.length > maxPhotos) { status.textContent = 'Please choose at most ' + maxPhotos + ' photos.'; return; }
        go.disabled = true;
        try {
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (f.size > maxBytes) throw new Error(f.name + ' is over the size limit.');
            status.textContent = 'Uploading ' + (i+1) + ' of ' + files.length + '…';
            const body = new FormData();
            body.append('photo', f);
            const res = await fetch('/api/submissions/' + sessionId + '/photos', { method: 'POST', body });
            const data = await readJson(res);
            if (!res.ok) throw new Error(data.error || 'Upload failed');
          }
          status.textContent = 'Finishing…';
          const fin = await fetch('/api/submissions/' + sessionId + '/finish', { method: 'POST' });
          const data = await readJson(fin);
          if (!fin.ok) throw new Error(data.error || 'Could not finish');
          status.textContent = 'Done. Thanks…';
          location.href = (data.thanks_url || data.next_url || '/thanks');
        } catch (e) {
          status.textContent = (e && e.message) ? e.message : String(e);
          go.disabled = false;
        }
      };
    </script>`
  );
});

app.get("/api/submissions/:sessionId/photos", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const session = await c.env.DB.prepare(
      `SELECT id, finish_started_at, expires_at FROM upload_sessions WHERE id = ?`
    )
      .bind(sessionId)
      .first<{ id: string; finish_started_at: string | null; expires_at: string }>();
    if (!session) return c.json({ error: "Session not found" }, 404);
    if (session.finish_started_at) {
      return c.json({ error: "This upload was already submitted." }, 410);
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      return c.json({ error: "Session expired. Please start again." }, 410);
    }
    const temps = await c.env.DB.prepare(
      `SELECT id, original_filename, content_type, size_bytes, created_at
       FROM upload_temp_photos WHERE session_id = ? ORDER BY created_at`
    )
      .bind(sessionId)
      .all<{
        id: string;
        original_filename: string;
        content_type: string;
        size_bytes: number;
        created_at: string;
      }>();
    return c.json({
      ok: true,
      sessionId,
      photos: (temps.results || []).map((p) => ({
        photoId: p.id,
        filename: p.original_filename,
        contentType: p.content_type,
        sizeBytes: p.size_bytes,
        previewUrl: `/api/submissions/${sessionId}/photos/${p.id}`,
      })),
    });
  } catch (e) {
    console.error("photo_list_failed", e);
    return c.json({ error: "Could not load photos." }, 500);
  }
});

app.get("/api/submissions/:sessionId/photos/:photoId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const photoId = c.req.param("photoId");
    const row = await c.env.DB.prepare(
      `SELECT r2_key, content_type FROM upload_temp_photos WHERE id = ? AND session_id = ?`
    )
      .bind(photoId, sessionId)
      .first<{ r2_key: string; content_type: string }>();
    if (!row) return c.json({ error: "Photo not found" }, 404);
    const obj = await c.env.BUCKET.get(row.r2_key);
    if (!obj) return c.json({ error: "Photo not found" }, 404);
    return new Response(obj.body, {
      headers: {
        "content-type": row.content_type || "image/jpeg",
        "cache-control": "private, max-age=300",
      },
    });
  } catch (e) {
    console.error("temp_photo_get_failed", e);
    return c.json({ error: "Could not load photo." }, 500);
  }
});

app.post("/api/submissions/:sessionId/photos", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const session = await c.env.DB.prepare(`SELECT * FROM upload_sessions WHERE id = ?`)
      .bind(sessionId)
      .first<UploadSessionSnap>();
    if (!session) return c.json({ error: "Session not found" }, 404);
    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM upload_temp_photos WHERE session_id = ?`
    )
      .bind(sessionId)
      .first<{ n: number }>();
    const maxPhotos = Number(c.env.MAX_PHOTOS || 100);
    if ((countRow?.n || 0) >= maxPhotos) return c.json({ error: "Photo limit reached" }, 400);

    const body = await c.req.parseBody();
    const file = body.photo;
    if (!(file instanceof File)) return c.json({ error: "Missing photo" }, 400);
    const maxBytes = Number(c.env.MAX_PHOTO_BYTES || 15728640);
    if (file.size > maxBytes) return c.json({ error: "File too large" }, 400);
    const type = (file.type || "image/jpeg").toLowerCase();
    if (!ALLOWED_TYPES.has(type) && !file.name.toLowerCase().match(/\.(jpe?g|png|webp|heic|heif)$/)) {
      return c.json({ error: "Please upload a photo file" }, 400);
    }
    const photoId = id();
    const key = `t_${sessionId}_${photoId}`;
    const bytes = await file.arrayBuffer();
    const safeName = asciiMeta(file.name || "photo.jpg") || "photo.jpg";
    try {
      await c.env.BUCKET.put(key, bytes, {
        httpMetadata: { contentType: file.type || "image/jpeg" },
        customMetadata: {
          sessionId: asciiMeta(sessionId, 80),
          temp: "1",
          originalFilename: safeName,
        },
      });
    } catch (e) {
      console.error("photo_r2_put_failed", e);
      return c.json({ error: "Could not store that photo. Please try JPEG and submit again." }, 500);
    }
    await c.env.DB.prepare(
      `INSERT INTO upload_temp_photos (id, session_id, r2_key, original_filename, content_type, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(photoId, sessionId, key, safeName, file.type || "image/jpeg", file.size, nowIso())
      .run();
    const exp = new Date(Date.now() + 40 * 60 * 1000).toISOString();
    await c.env.DB.prepare(`UPDATE upload_sessions SET expires_at = ? WHERE id = ?`).bind(exp, sessionId).run();
    // Temps only until Submit (same as non-cloud). No progressive detect on the seller path.
    return c.json({ ok: true, photoId });
  } catch (e) {
    console.error("photo_upload_failed", e);
    return c.json({ error: "Upload failed. Please try again." }, 500);
  }
});

app.delete("/api/submissions/:sessionId/photos/:photoId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const photoId = c.req.param("photoId");
    const session = await c.env.DB.prepare(`SELECT id FROM upload_sessions WHERE id = ?`).bind(sessionId).first();
    if (!session) return c.json({ error: "Session not found" }, 404);
    const photo = await c.env.DB.prepare(
      `SELECT r2_key FROM upload_temp_photos WHERE id = ? AND session_id = ?`
    )
      .bind(photoId, sessionId)
      .first<{ r2_key: string }>();
    if (!photo) return c.json({ error: "Photo not found" }, 404);
    try {
      await c.env.BUCKET.delete(photo.r2_key);
    } catch {
      /* ignore */
    }
    await c.env.DB.prepare(`DELETE FROM upload_temp_photos WHERE id = ? AND session_id = ?`)
      .bind(photoId, sessionId)
      .run();
    return c.json({ ok: true });
  } catch (e) {
    console.error("photo_delete_failed", e);
    return c.json({ error: "Could not remove that photo." }, 500);
  }
});

app.post("/api/submissions/:sessionId/finish", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const session = await c.env.DB.prepare(
      `SELECT * FROM upload_sessions WHERE id = ?`
    )
      .bind(sessionId)
      .first<UploadSessionSnap>();
    if (!session) return c.json({ error: "Session not found" }, 404);

    const ident = await readFinishIdentity(c);
    const seller_name = ident.seller_name || session.seller_name;
    const seller_email = ident.seller_email || session.seller_email;
    const instagram = ident.instagram || session.instagram;
    const asking_raw = ident.asking_raw || (session.asking_cents != null ? String(session.asking_cents / 100) : "");
    const asking_cents = ident.asking_cents ?? session.asking_cents;
    const delivery_method = ident.delivery_method || session.delivery_method;
    const seller_notes = ident.seller_notes || session.seller_notes;
    const agree = ident.agree || Boolean(session.seller_email && session.accepted_terms_at);
    const identityErr = finishIdentityError({
      seller_name,
      seller_email,
      asking_raw,
      asking_cents,
      delivery_method: delivery_method || "",
      agree,
    });
    if (identityErr) return c.json({ error: identityErr }, 400);

    const temps = await c.env.DB.prepare(
      `SELECT * FROM upload_temp_photos WHERE session_id = ?`
    )
      .bind(sessionId)
      .all<TempPhotoSnap>();
    const photos = temps.results || [];
    let earlyPhotoCount = 0;
    if (session.collection_id) {
      const early = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM photos WHERE collection_id = ?`
      )
        .bind(session.collection_id)
        .first<{ n: number }>();
      earlyPhotoCount = Number(early?.n || 0);
    }
    if (!photos.length && earlyPhotoCount < 1) {
      return c.json({ error: "Please upload at least one photo" }, 400);
    }

    if (c.env.ENVIRONMENT === "production" && !hasModerationProvider(c.env)) {
      return c.json({ error: "Uploads are paused until content moderation is configured." }, 503);
    }

    const snap: UploadSessionSnap = {
      ...session,
      seller_name,
      seller_email,
      paypal_gs_email: seller_email,
      instagram,
      asking_cents,
      seller_notes,
      delivery_method,
      accepted_terms_at: session.seller_email ? session.accepted_terms_at : nowIso(),
    };

    // Claim without deleting: temp photos still reference this session (FK).
    if (session.finish_started_at) {
      const existingId = session.collection_id;
      if (existingId) {
        const token = await ensureBoxReviewToken(c.env.DB, existingId);
        return c.json({
          ok: true,
          accepted: true,
          collection_id: existingId,
          thanks_url: "/thanks",
          next_url: "/thanks",
        });
      }
      return c.json({ ok: true, accepted: true });
    }
    const claimedAt = nowIso();
    // Large finishes (20+ boards) need headroom; do not let the 40m session TTL wipe temps mid-job.
    const finishExpires = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    // Create collection before waitUntil. Seller lands on /thanks (non-cloud workflow).
    // box_review_token kept for staff/debug / future internal tool only.
    let collectionId = session.collection_id || null;
    let boxToken: string | null = null;
    if (!collectionId) {
      collectionId = id();
      boxToken = id();
      try {
        await c.env.DB.prepare(
          `INSERT INTO collections (
            id, status, seller_name, seller_email, paypal_gs_email, instagram, accepted_terms_at,
            asking_cents, seller_notes, delivery_method, photo_count, box_review_token, created_at, updated_at
          ) VALUES (?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            collectionId,
            snap.seller_name,
            snap.seller_email,
            snap.paypal_gs_email,
            snap.instagram,
            snap.accepted_terms_at,
            snap.asking_cents,
            snap.seller_notes ?? null,
            snap.delivery_method,
            Math.max(photos.length, earlyPhotoCount),
            boxToken,
            claimedAt,
            claimedAt
          )
          .run();
      } catch (insErr) {
        console.error("finish_collection_insert_failed", insErr);
        return c.json({ error: "Could not finish. Please try again." }, 500);
      }
    } else {
      boxToken = await ensureBoxReviewToken(c.env.DB, collectionId);
      await c.env.DB.prepare(
        `UPDATE collections SET
          seller_name = ?, seller_email = ?, paypal_gs_email = ?, instagram = ?,
          accepted_terms_at = ?, asking_cents = ?, seller_notes = ?, delivery_method = ?,
          status = CASE WHEN status = 'uploading' THEN 'submitted' ELSE status END,
          photo_count = CASE WHEN photo_count < ? THEN ? ELSE photo_count END,
          internal_note = NULL,
          updated_at = ?
         WHERE id = ?`
      )
        .bind(
          snap.seller_name,
          snap.seller_email,
          snap.paypal_gs_email,
          snap.instagram,
          snap.accepted_terms_at,
          snap.asking_cents,
          snap.seller_notes ?? null,
          snap.delivery_method,
          Math.max(photos.length, earlyPhotoCount),
          Math.max(photos.length, earlyPhotoCount),
          claimedAt,
          collectionId
        )
        .run();
    }
    snap.collection_id = collectionId;

    try {
      const claim = await c.env.DB.prepare(
        `UPDATE upload_sessions SET
          seller_name = ?, seller_email = ?, paypal_gs_email = ?, instagram = ?,
          asking_cents = ?, seller_notes = ?, delivery_method = ?, accepted_terms_at = ?,
          finish_started_at = ?, expires_at = ?, collection_id = ?
         WHERE id = ? AND finish_started_at IS NULL`
      )
        .bind(
          snap.seller_name,
          snap.seller_email,
          snap.paypal_gs_email,
          snap.instagram,
          snap.asking_cents,
          snap.seller_notes ?? null,
          snap.delivery_method,
          snap.accepted_terms_at,
          claimedAt,
          finishExpires,
          collectionId,
          sessionId
        )
        .run();
      if (!claim.meta.changes) {
        const token = boxToken || (await ensureBoxReviewToken(c.env.DB, collectionId));
        return c.json({
          ok: true,
          accepted: true,
          collection_id: collectionId,
          thanks_url: "/thanks",
          next_url: "/thanks",
        });
      }
    } catch (claimErr) {
      console.error("finish_claim_failed", claimErr);
      return c.json({ error: "Could not finish. Please try again." }, 500);
    }

    // Waiting page returns immediately. Finish + detect run under waitUntil; cron resumes if needed.
    // Offer-only email (same as production): no upload receipt.
    const background = (async () => {
      if (photos.length) {
        await processSubmissionBackground(c.env, snap, photos);
      } else {
        // Rare: leftover early-promote collection from a prior build. Mark awaiting staff; no auto detect.
        await finalizeEarlySubmission(c.env, collectionId!, snap.seller_email);
      }
    })();
    try {
      c.executionCtx.waitUntil(background);
    } catch (err) {
      console.error("waitUntil_failed", err);
      // Session stays claimed; processPendingFinishes on cron will resume.
    }

    return c.json({
      ok: true,
      accepted: true,
      collection_id: collectionId,
      thanks_url: "/thanks",
      next_url: "/thanks",
    });
  } catch (e) {
    console.error("finish_failed", e);
    return c.json({ error: "Could not finish. Please try again." }, 500);
  }
});

app.get("/thanks", (c) => {
  return html(
    c.env,
    "Thanks",
    `<h1>We have your photos</h1>
    <div class="card">
      <p>Thanks. We’ll review your boards and email your offer, usually within 24-48 business hours.</p>
      <p class="hint">We still run a quick automated safety check in the background. If a photo doesn’t pass, we’ll email you and those files are not kept.</p>
    </div>`
  );
});

/** Seller waiting room → Board Box Editor (token auth; no staff login). */
app.get("/boxes/:token", async (c) => {
  const token = c.req.param("token");
  const row = await collectionByBoxToken(c.env.DB, token);
  if (!row) {
    return html(c.env, "Not found", `<div class="flash err">This review link isn’t valid.</div>`);
  }
  const status = row.mac_handoff_status || "";
  // Confirm accepted: send sellers to Match (Opening Match polls). Do not show "Thanks" yet.
  if (status === "cloud_confirming") {
    return c.redirect(`/boxes/${encodeURIComponent(token)}/match`);
  }
  const done = c.req.query("done") === "1" || status === "cloud_done";
  if (done) {
    return html(
      c.env,
      "Thanks",
      `<h1>Thanks. We’re finishing your offer</h1>
      <div class="card">
        <p>Your pin boxes are locked in. We’re wrapping up pricing and will email <strong>${escapeHtml(row.seller_email)}</strong> when the offer is ready.</p>
        <p class="hint">You can close this tab.</p>
      </div>`
    );
  }
  if (status === "cloud_failed") {
    return html(
      c.env,
      "Almost there",
      `<h1>We’re still working on your boards</h1>
      <div class="card">
        <p>Something stalled while finding pins. We’ve got your photos. Refresh in a minute, or wait for our email.</p>
        <p><a class="btn" href="/boxes/${encodeURIComponent(token)}">Try again</a></p>
      </div>`
    );
  }
  if (status === "cloud_awaiting_boxes") {
    return c.redirect(`/boxes/${encodeURIComponent(token)}/editor`);
  }
  // iOS-style import “movie”: full-screen boards + box trace while detect runs.
  const asset = await c.env.ASSETS.fetch(new URL("/import-waiting.html", c.req.url));
  if (asset.status === 404) {
    return html(
      c.env,
      "Finding pins",
      `<h1>Finding pins on your boards…</h1>
       <div class="card"><p id="waitStatus" class="hint">Working…</p></div>
       <script>
         (async function poll() {
           const res = await fetch("/api/boxes/${encodeURIComponent(token)}/status", { cache: "no-store" });
           const data = await res.json().catch(() => ({}));
           if (data.ready) location.replace("/boxes/${encodeURIComponent(token)}/editor");
           else setTimeout(poll, 2000);
         })();
       </script>`
    );
  }
  let htmlText = await asset.text();
  htmlText = htmlText.replace(
    "window.__BOX_TOKEN__",
    JSON.stringify(token)
  );
  // Also ensure query token works if script runs before replace (baked const).
  htmlText = htmlText.replace(
    'const token = (window.__BOX_TOKEN__ || new URLSearchParams(location.search).get("token") || "").trim();',
    `const token = (${JSON.stringify(token)} || new URLSearchParams(location.search).get("token") || "").trim();`
  );
  return new Response(htmlText, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
});

app.get("/boxes/:token/editor", async (c) => {
  const token = c.req.param("token");
  const row = await collectionByBoxToken(c.env.DB, token);
  if (!row) return c.text("Review link not found", 404);
  if (row.mac_handoff_status === "cloud_confirming") {
    return c.redirect(`/boxes/${encodeURIComponent(token)}/match`);
  }
  if (row.mac_handoff_status === "cloud_done") {
    return c.redirect(`/boxes/${encodeURIComponent(token)}?done=1`);
  }
  if (row.mac_handoff_status !== "cloud_awaiting_boxes") {
    return c.redirect(`/boxes/${encodeURIComponent(token)}`);
  }
  const asset = await c.env.ASSETS.fetch(new URL("/cloud-board-box-editor.html", c.req.url));
  if (asset.status === 404) return c.text("Board Box Editor asset missing", 500);
  let htmlText = await asset.text();
  htmlText = htmlText
    .replace(
      'const collectionId = (params.get("collection") || "").trim();',
      `const collectionId = (params.get("collection") || "${row.id}").trim() || "${row.id}";`
    )
    .replace(
      'const boxReviewToken = (params.get("token") || "").trim();',
      `const boxReviewToken = (params.get("token") || "${token}").trim() || "${token}";`
    );
  return new Response(htmlText, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
});

app.get("/api/boxes/:token/status", async (c) => {
  let row = await collectionByBoxToken(c.env.DB, c.req.param("token"));
  if (!row) return c.json({ ok: false, error: "Not found" }, 404);
  let status = row.mac_handoff_status || "";
  const failed = status === "cloud_failed";
  let phase = status || "saving";
  let pinCount: number | null = null;
  let boardsDone: number | null = null;
  let boardsTotal: number | null = null;
  const photoCount = Number(row.photo_count || 0);
  // "submitted" exists while finish is still storing boards; do not say Finding pins yet.
  let label =
    status === "cloud_running" || status === "cloud_queued"
      ? "Finding pins…"
      : status === "cloud_awaiting_boxes"
        ? "Boxes ready"
        : status === "cloud_confirming"
          ? "Opening Match…"
          : status === "cloud_done"
            ? "Match ready"
            : photoCount > 0 && (status === "pricing" || status === "uploading")
              ? "Finding pins…"
              : "Saving your photos…";

  const jobId = cloudJobIdFromFolder(row.mac_handoff_folder);
  if (
    jobId &&
    (status === "cloud_running" ||
      status === "cloud_awaiting_boxes" ||
      status === "cloud_confirming" ||
      status === "cloud_done")
  ) {
    const st = await fetchCloudJobJson(c.env, jobId, "status.json");
    if (st.ok) {
      phase = String(st.body.phase || st.body.status || phase);
      if (typeof st.body.pin_count === "number") pinCount = st.body.pin_count;
      if (typeof st.body.boards_done === "number") boardsDone = st.body.boards_done;
      if (typeof st.body.boards_total === "number") boardsTotal = st.body.boards_total;
      if (phase === "detecting") label = "Finding pins…";
      else if (phase === "board_ready") {
        label =
          boardsDone != null && boardsTotal != null
            ? `Board ${boardsDone} of ${boardsTotal} ready`
            : "First boards ready…";
      } else if (phase === "prefetching") label = "Pins found · starting prices…";
      else if (phase === "detect_ready" || phase === "awaiting_box_confirm") label = "Boxes ready";
      else if (phase === "confirming") label = "Applying box edits…";
      else if (phase === "match_ready" || phase === "done" || phase === "done_partial") label = "Match ready";
      else if (phase === "finishing_remaining") label = "Match ready · more pins loading…";

      // Detect callback / waitUntil died: Cloud Run already has boxes but D1 still cloud_running.
      const boxReadyPhases = new Set([
        "board_ready",
        "detect_ready",
        "awaiting_box_confirm",
        "prefetch_ready",
        "prefetching",
      ]);
      if (status === "cloud_running" && boxReadyPhases.has(phase)) {
        await c.env.DB.prepare(
          `UPDATE collections SET mac_handoff_status = 'cloud_awaiting_boxes', mac_handoff_at = ?, updated_at = ?, internal_note = COALESCE(internal_note, ?) WHERE id = ? AND mac_handoff_status = 'cloud_running'`
        )
          .bind(nowIso(), nowIso(), "Boxes ready (status heal).", row.id)
          .run();
        status = "cloud_awaiting_boxes";
        label = "Boxes ready";
        row = { ...row, mac_handoff_status: "cloud_awaiting_boxes" };
      }

      // waitUntil after seller Confirm often dies before D1 flips to cloud_done.
      // If Cloud Run already has Match, heal so /boxes/:token/match stops spinning.
      const matchPhases = new Set(["match_ready", "finishing_remaining", "done", "done_partial"]);
      if (status === "cloud_confirming" && matchPhases.has(phase)) {
        const harnessLocal = `${c.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/collections/${row.id}/cloud-harness`;
        await c.env.DB.prepare(
          `UPDATE collections SET mac_handoff_status = 'cloud_done', mac_handoff_at = ?, updated_at = ?, overlay_url = COALESCE(NULLIF(overlay_url, ''), ?), internal_note = ? WHERE id = ? AND mac_handoff_status = 'cloud_confirming'`
        )
          .bind(
            nowIso(),
            nowIso(),
            harnessLocal,
            phase === "finishing_remaining"
              ? "Match ready. Remaining eBay finishing in background."
              : "Match ready.",
            row.id
          )
          .run();
        status = "cloud_done";
        label = phase === "finishing_remaining" ? "Match ready · more pins loading…" : "Match ready";
        row = { ...row, mac_handoff_status: "cloud_done" };
      }
    }
  }

  const ready = status === "cloud_awaiting_boxes";

  return c.json({
    ok: true,
    status,
    phase,
    ready,
    failed,
    label,
    pin_count: pinCount,
    boards_done: boardsDone,
    boards_total: boardsTotal,
    collection_id: row.id,
    photo_count: photoCount,
  });
});

app.get("/api/boxes/:token/photos", async (c) => {
  const row = await collectionByBoxToken(c.env.DB, c.req.param("token"));
  if (!row) return c.json({ ok: false, error: "Not found" }, 404);
  const photos = await c.env.DB.prepare(
    `SELECT id, original_filename FROM photos WHERE collection_id = ? ORDER BY created_at`
  )
    .bind(row.id)
    .all<{ id: string; original_filename: string | null }>();
  const token = c.req.param("token");
  return c.json({
    ok: true,
    photos: (photos.results || []).map((p, i) => ({
      id: p.id,
      filename: p.original_filename || `board_${i + 1}.jpg`,
      url: `/api/boxes/${encodeURIComponent(token)}/photos/${encodeURIComponent(p.id)}`,
    })),
  });
});

app.get("/api/boxes/:token/photos/:photoId", async (c) => {
  const row = await collectionByBoxToken(c.env.DB, c.req.param("token"));
  if (!row) return c.text("Not found", 404);
  const photo = await c.env.DB.prepare(
    `SELECT r2_key, content_type FROM photos WHERE id = ? AND collection_id = ?`
  )
    .bind(c.req.param("photoId"), row.id)
    .first<{ r2_key: string; content_type: string | null }>();
  if (!photo) return c.text("Not found", 404);
  const obj = await c.env.BUCKET.get(photo.r2_key);
  if (!obj) return c.text("Not found", 404);
  return new Response(obj.body, {
    headers: {
      "content-type": photo.content_type || "image/jpeg",
      "cache-control": "private, max-age=300",
    },
  });
});

app.get("/api/boxes/:token/session", async (c) => {
  const row = await collectionByBoxToken(c.env.DB, c.req.param("token"));
  if (!row) return c.json({ ok: false, error: "Not found" }, 404);
  const jobId = cloudJobIdFromFolder(row.mac_handoff_folder);
  if (!jobId) return c.json({ ok: false, error: "No cloud job yet" }, 404);
  const prefetch = await fetchCloudJobJson(c.env, jobId, "prefetch.json");
  if (!prefetch.ok) return c.json({ ok: false, error: prefetch.error }, 502);
  return c.json({
    ok: true,
    collection_id: row.id,
    job_id: jobId,
    status: row.mac_handoff_status,
    boards: prefetch.body.boards || [],
    pin_count: prefetch.body.pin_count,
    prefetch_priced: prefetch.body.prefetch_priced,
    boards_done: prefetch.body.boards_done,
    boards_total: prefetch.body.boards_total,
    phase: prefetch.body.phase,
    seller: true,
  });
});

app.get("/api/boxes/:token/file/*", async (c) => {
  const row = await collectionByBoxToken(c.env.DB, c.req.param("token"));
  if (!row) return c.text("Not found", 404);
  const jobId = cloudJobIdFromFolder(row.mac_handoff_folder);
  if (!jobId) return c.text("No job", 404);
  const prefix = `/api/boxes/${c.req.param("token")}/file/`;
  const filePath = c.req.path.slice(prefix.length);
  if (!filePath || filePath.includes("..")) return c.text("Invalid path", 400);
  // Sellers only need board rasters for the editor (not full harness dumps).
  if (!filePath.startsWith("boards/")) return c.text("Forbidden", 403);
  return fetchCloudJobFile(c.env, jobId, filePath);
});

app.post("/api/boxes/:token/confirm", async (c) => {
  const token = c.req.param("token");
  const row = await collectionByBoxToken(c.env.DB, token);
  if (!row) return c.json({ ok: false, error: "Not found" }, 404);
  const jobId = cloudJobIdFromFolder(row.mac_handoff_folder);
  if (!jobId) return c.json({ ok: false, error: "No cloud job" }, 404);
  if (row.mac_handoff_status !== "cloud_awaiting_boxes" && row.mac_handoff_status !== "cloud_confirming") {
    return c.json({ ok: false, error: `Unexpected status ${row.mac_handoff_status}` }, 409);
  }
  const body = (await c.req.json().catch(() => ({}))) as { boards?: unknown[] };
  await c.env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'cloud_confirming', mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
  )
    .bind(nowIso(), nowIso(), "Confirm accepted. Building Match harness…", row.id)
    .run();

  const matchLocal = `/boxes/${encodeURIComponent(token)}/match`;
  const harnessLocal = `${c.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/collections/${row.id}/cloud-harness`;
  const boardsPayload = body.boards;
  // Persist boards so cron can retry Confirm if waitUntil dies before Cloud Run.
  await saveConfirmPending(c.env, row.id, jobId, Array.isArray(boardsPayload) ? boardsPayload : undefined);

  // Return immediately (avoids browser "Load failed"). Match page polls until harness exists.
  const run = async () => {
    const result = await confirmCloudBoxes(c.env, jobId, boardsPayload);
    if (!result.ok) {
      await c.env.DB.prepare(
        `UPDATE collections SET mac_handoff_status = 'cloud_failed', mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
      )
        .bind(nowIso(), nowIso(), `Confirm failed: ${(result.error || "").slice(0, 240)}`, row.id)
        .run();
      await logEvent(c.env.DB, row.id, row.seller_email, "cloud_price_failed", { error: result.error, via: "seller" });
      return;
    }
    await c.env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_done', mac_handoff_folder = ?, mac_handoff_at = ?, updated_at = ?, overlay_url = ?, internal_note = ? WHERE id = ?`
    )
      .bind(
        `cloud:${result.job_id || jobId}`,
        nowIso(),
        nowIso(),
        harnessLocal,
        result.remaining_deferred
          ? `Match ready (${result.priced_count || "?"} priced). Remaining eBay finishing in background.`
          : `Confirm done (${result.priced_count || "?"} priced).`,
        row.id
      )
      .run();
    await clearConfirmPending(c.env, row.id);
    // Do not kick finish-remaining here: Cloud Run already scheduled it on confirm.
    // Cron healStuckCloudJobs re-kicks only if still stuck after ~90s (avoids double eBay).
    await logEvent(c.env.DB, row.id, row.seller_email, "cloud_price_done", {
      job_id: result.job_id || jobId,
      pin_count: result.pin_count,
      priced_count: result.priced_count,
      elapsed_sec: result.elapsed_sec,
      remaining_deferred: result.remaining_deferred,
      via: "seller_box_editor",
      notify_lexi: false,
    });
  };
  try {
    c.executionCtx.waitUntil(run());
  } catch {
    await run();
  }

  return c.json({
    ok: true,
    accepted: true,
    pending: true,
    job_id: jobId,
    match_ready: false,
    match_url: matchLocal,
    next_url: matchLocal,
  });
});

/**
 * Rewrite Cloud Run absolute file URLs + inject <base> so CTM/CTP assets load
 * through the seller token proxy (not the invoke-key Cloud Run host).
 */
function rewriteSellerMatchFileHtml(htmlText: string, token: string): string {
  const matchFileBase = `/api/boxes/${encodeURIComponent(token)}/match-file/testing_ui_visual_baseline/`;
  let out = htmlText
    .replace(
      /https?:\/\/[^"'/\s]+\/(?:jobs\/[^/"']+\/file\/|api\/cloud\/jobs\/[^/"']+\/file\/)testing_ui_visual_baseline\//g,
      matchFileBase
    )
    .replace(/\/api\/cloud\/jobs\/[^/"']+\/file\/testing_ui_visual_baseline\//g, matchFileBase)
    .replace(/\/jobs\/[^/"']+\/file\/testing_ui_visual_baseline\//g, matchFileBase);
  if (!/<base\s/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>\n<base href="${matchFileBase}">`);
  }
  return out;
}

/**
 * Seller Match serves ClickToMatch v2 (new_ctm.html), then CTP v2 via relative
 * new_ctp.html?filter=no_match (same flow as PreparingInventory Mac harness).
 */
function rewriteSellerCtmV2Html(htmlText: string, token: string): string {
  let out = rewriteSellerMatchFileHtml(htmlText, token);
  // Deferred eBay: skip pins with no listing thumb so CTM v2 is not a blank right pane.
  if (out.includes("const queue = PINS.filter(p => !SKIP_MS.includes(p.ms));")) {
    out = out.replace(
      "const queue = PINS.filter(p => !SKIP_MS.includes(p.ms));",
      "const queue = PINS.filter(p => !SKIP_MS.includes(p.ms) && p.thumb);"
    );
  } else if (
    /const queue = PINS\.filter\(p => !SKIP_MS\.includes\(p\.ms\)\);/.test(out) &&
    !out.includes("&& p.thumb")
  ) {
    out = out.replace(
      /const queue = PINS\.filter\(p => !SKIP_MS\.includes\(p\.ms\)\);/,
      "const queue = PINS.filter(p => !SKIP_MS.includes(p.ms) && p.thumb);"
    );
  }
  // Soft-reload once when deferred eBay finishes so newly priced pins join the queue.
  // If the filtered queue is empty (all remaining pins still pricing), show a calm wait note.
  const reloadPoll = `<script>(function(){var t=${JSON.stringify(token)};var k="ctm_reloaded_"+t;try{if(typeof queue!=="undefined"&&!queue.length){var n=document.createElement("div");n.setAttribute("style","position:sticky;top:48px;z-index:9998;background:#1e3a5f;color:#fff;padding:10px 14px;font:600 14px/1.35 system-ui,sans-serif");n.textContent="More pins are still loading. This page refreshes when they are ready.";document.body.insertBefore(n,document.body.firstChild)}}catch(e){}if(sessionStorage.getItem(k))return;var n=0,saw=false;function tick(){n++;if(n>150)return;fetch("/api/boxes/"+encodeURIComponent(t)+"/status",{cache:"no-store"}).then(function(r){return r.json()}).then(function(d){var p=String(d.phase||"");if(p==="finishing_remaining"||p==="match_ready")saw=true;if(saw&&(p==="done"||p==="done_partial")){sessionStorage.setItem(k,"1");location.reload();return}setTimeout(tick,4000)}).catch(function(){setTimeout(tick,5000)})}setTimeout(tick,8000)})();</script>`;
  if (out.includes("</body>")) {
    out = out.replace(/<\/body>/i, `${reloadPoll}</body>`);
  } else {
    out += reloadPoll;
  }
  return out;
}

function confirmPendingKey(collectionId: string): string {
  return `confirm_pending/${collectionId}.json`;
}

async function saveConfirmPending(
  env: Bindings,
  collectionId: string,
  jobId: string,
  boards: unknown[] | undefined
): Promise<void> {
  await env.BUCKET.put(
    confirmPendingKey(collectionId),
    JSON.stringify({ job_id: jobId, boards: boards || null, at: nowIso() }),
    { httpMetadata: { contentType: "application/json" } }
  );
}

async function loadConfirmPending(
  env: Bindings,
  collectionId: string
): Promise<{ job_id: string; boards: unknown[] | null } | null> {
  const obj = await env.BUCKET.get(confirmPendingKey(collectionId));
  if (!obj) return null;
  try {
    const parsed = JSON.parse(await obj.text()) as { job_id?: string; boards?: unknown[] | null };
    if (!parsed.job_id) return null;
    return { job_id: parsed.job_id, boards: Array.isArray(parsed.boards) ? parsed.boards : null };
  } catch {
    return null;
  }
}

async function clearConfirmPending(env: Bindings, collectionId: string): Promise<void> {
  try {
    await env.BUCKET.delete(confirmPendingKey(collectionId));
  } catch {
    /* ignore */
  }
}

async function recentlyLogged(
  db: D1Database,
  collectionId: string,
  type: string,
  withinMs: number
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT created_at FROM events WHERE collection_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(collectionId, type)
    .first<{ created_at: string }>();
  if (!row?.created_at) return false;
  const t = Date.parse(row.created_at);
  return Number.isFinite(t) && Date.now() - t < withinMs;
}

/** Re-kick deferred eBay / retry Confirm when waitUntil or Cloud Run background died. */
async function healStuckCloudJobs(env: Bindings): Promise<void> {
  if (!cloudPricingConfigured(env)) return;
  const rows = await env.DB.prepare(
    `SELECT id, mac_handoff_folder, mac_handoff_status, mac_handoff_at, seller_email
     FROM collections
     WHERE mac_handoff_status IN ('cloud_running', 'cloud_awaiting_boxes', 'cloud_confirming', 'cloud_done')
     ORDER BY updated_at DESC
     LIMIT 20`
  ).all<{
    id: string;
    mac_handoff_folder: string | null;
    mac_handoff_status: string | null;
    mac_handoff_at: string | null;
    seller_email: string;
  }>();

  for (const row of rows.results || []) {
    const jobId = cloudJobIdFromFolder(row.mac_handoff_folder);
    if (!jobId) continue;
    const handoffAgeMs = row.mac_handoff_at ? Date.now() - Date.parse(row.mac_handoff_at) : 0;
    const st = await fetchCloudJobJson(env, jobId, "status.json");
    if (!st.ok) continue;
    const phase = String(st.body.phase || st.body.status || "");
    const remainingDeferred = Boolean(st.body.remaining_deferred);

    // Detect finished: auto-continue eBay (BBE is optional; do not park on awaiting_boxes).
    const detectDonePhases = new Set(["awaiting_box_confirm", "prefetch_ready"]);
    if (
      (row.mac_handoff_status === "cloud_running" || row.mac_handoff_status === "cloud_awaiting_boxes") &&
      handoffAgeMs > 20_000 &&
      detectDonePhases.has(phase)
    ) {
      if (await recentlyLogged(env.DB, row.id, "cloud_auto_confirm_started", 120_000)) continue;
      await continuePricingAfterDetect(env, row.id, jobId, row.seller_email || "system:cron", {
        via: "cron_heal",
      });
      continue;
    }

    // Still detecting / prefetching: keep running status with a progress note.
    const inProgressPhases = new Set(["board_ready", "detect_ready", "prefetching", "detecting"]);
    if (
      row.mac_handoff_status === "cloud_running" &&
      handoffAgeMs > 60_000 &&
      inProgressPhases.has(phase)
    ) {
      if (await recentlyLogged(env.DB, row.id, "cloud_detect_progress_healed", 180_000)) continue;
      await env.DB.prepare(
        `UPDATE collections SET updated_at = ?, internal_note = ? WHERE id = ? AND mac_handoff_status = 'cloud_running'`
      )
        .bind(nowIso(), `Detect/prefetch still running (phase ${phase}).`, row.id)
        .run();
      await logEvent(env.DB, row.id, row.seller_email || "system:cron", "cloud_detect_progress_healed", {
        job_id: jobId,
        phase,
      });
      continue;
    }

    // Confirm accepted in D1 but Cloud Run never got the POST (waitUntil died early).
    if (
      row.mac_handoff_status === "cloud_confirming" &&
      handoffAgeMs > 45_000 &&
      (phase === "awaiting_box_confirm" || phase === "detect_ready" || phase === "prefetch_ready")
    ) {
      if (await recentlyLogged(env.DB, row.id, "confirm_retried", 180_000)) continue;
      const pending = await loadConfirmPending(env, row.id);
      const boards = pending?.boards || undefined;
      await logEvent(env.DB, row.id, row.seller_email || "system:cron", "confirm_retried", {
        job_id: jobId,
        phase,
        has_boards: Boolean(boards?.length),
      });
      const result = await confirmCloudBoxes(env, jobId, boards);
      if (result.ok) {
        const harnessLocal = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/collections/${row.id}/cloud-harness`;
        await env.DB.prepare(
          `UPDATE collections SET mac_handoff_status = 'cloud_done', mac_handoff_at = ?, updated_at = ?, overlay_url = COALESCE(NULLIF(overlay_url, ''), ?), internal_note = ? WHERE id = ?`
        )
          .bind(
            nowIso(),
            nowIso(),
            harnessLocal,
            result.remaining_deferred
              ? "Match ready (confirm retried). Remaining eBay finishing in background."
              : "Match ready (confirm retried).",
            row.id
          )
          .run();
        await clearConfirmPending(env, row.id);
        // Cloud Run schedules finish-remaining on confirm; heal path below covers stuck jobs.
      }
      continue;
    }

    // Deferred eBay stuck after Match opened.
    // match_ready + remaining_deferred >90s ⇒ BackgroundTask never started (CPU throttle).
    // finishing_remaining >8m ⇒ likely hung mid-eBay (large collections need longer).
    // remaining_failed ⇒ explicit bg failure; re-kick soon.
    const stuckDeferred =
      (phase === "match_ready" && remainingDeferred && handoffAgeMs > 90_000) ||
      (phase === "finishing_remaining" && handoffAgeMs > 480_000) ||
      (phase === "remaining_failed" && handoffAgeMs > 30_000);
    if (!stuckDeferred) continue;
    if (await recentlyLogged(env.DB, row.id, "finish_remaining_kicked", 180_000)) continue;
    const kick = await kickFinishRemaining(env, jobId);
    await logEvent(env.DB, row.id, row.seller_email || "system:cron", "finish_remaining_kicked", {
      job_id: jobId,
      phase,
      ok: kick.ok,
      error: kick.error || null,
    });
    if (kick.ok) {
      await env.DB.prepare(
        `UPDATE collections SET updated_at = ?, internal_note = ? WHERE id = ?`
      )
        .bind(nowIso(), "Re-kicked remaining eBay (auto heal).", row.id)
        .run();
    }
  }
}

/** Seller Match / CTM harness (token auth). Prefetched pins are ready; rest fill in behind the scenes. */
app.get("/boxes/:token/match", async (c) => {
  const token = c.req.param("token");
  const row = await collectionByBoxToken(c.env.DB, token);
  if (!row) return c.text("Review link not found", 404);
  const jobId = cloudJobIdFromFolder(row.mac_handoff_folder);
  const status = row.mac_handoff_status || "";
  if (!jobId) {
    return html(
      c.env,
      "Match",
      `<h1>Match not ready yet</h1><div class="card"><p>Confirm boxes first, then Match opens here.</p>
       <p><a class="btn" href="/boxes/${encodeURIComponent(token)}/editor">Back to box editor</a></p></div>`
    );
  }
  if (status === "cloud_failed") {
    return html(
      c.env,
      "Match",
      `<h1>Confirm hit a snag</h1><div class="card"><p>${escapeHtml(row.internal_note || "Confirm failed.")}</p>
       <p><a class="btn" href="/boxes/${encodeURIComponent(token)}/editor">Back to box editor</a></p></div>`
    );
  }

  // Boxes not confirmed yet: never spin "Opening Match" (CTM 404 forever).
  if (status === "cloud_awaiting_boxes") {
    return c.redirect(`/boxes/${encodeURIComponent(token)}/editor`);
  }

  // CTM v2 (new_ctm.html), not Overlay index.html. Done banner → new_ctp.html?filter=no_match.
  const ctmRes = await fetchCloudJobFile(c.env, jobId, "testing_ui_visual_baseline/new_ctm.html");
  let htmlText = await ctmRes.text();
  if (ctmRes.ok) {
    htmlText = rewriteSellerCtmV2Html(htmlText, token);
    const banner = `<div style="position:sticky;top:0;z-index:9999;background:#0b6e4f;color:#fff;padding:10px 14px;font:600 14px/1.35 system-ui,sans-serif">
      ClickToMatch v2 · priced pins first. After Match, continue to ClickToPrice (no match).
      <a href="/boxes/${encodeURIComponent(token)}?done=1" style="color:#fff;margin-left:12px">Done</a>
    </div>`;
    if (htmlText.includes("<body")) {
      htmlText = htmlText.replace(/<body[^>]*>/i, (m) => `${m}\n${banner}`);
    } else {
      htmlText = banner + htmlText;
    }
    // Harness exists: don't leave D1 on cloud_confirming (Confirm waitUntil often dies).
    // Only heal confirming — never skip BBE by flipping awaiting_boxes → done.
    const harnessLocal = `${c.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/collections/${row.id}/cloud-harness`;
    await c.env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_done', mac_handoff_at = ?, updated_at = ?, overlay_url = COALESCE(NULLIF(overlay_url, ''), ?), internal_note = COALESCE(internal_note, ?) WHERE id = ? AND mac_handoff_status = 'cloud_confirming'`
    )
      .bind(nowIso(), nowIso(), harnessLocal, "Match ready (CTM v2).", row.id)
      .run();
    return new Response(htmlText, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (status === "cloud_confirming") {
    return html(
      c.env,
      "Opening Match",
      `<h1>Opening Match…</h1>
       <div class="card">
         <p>Applying your box edits, then Match for pins that are ready. Other pins keep loading in the background.</p>
         <p id="wait" class="hint">Working…</p>
         <p style="margin-top:12px"><a class="btn" href="/boxes/${encodeURIComponent(token)}/match">Try Match again</a></p>
       </div>
       <script>
         (async function poll() {
           try {
             const res = await fetch("/api/boxes/${encodeURIComponent(token)}/status", { cache: "no-store" });
             const data = await res.json().catch(() => ({}));
             const el = document.getElementById("wait");
             const phase = String(data.phase || "");
             const matchPhases = ["match_ready","finishing_remaining","done","done_partial"];
             if (data.status === "cloud_awaiting_boxes") {
               location.replace("/boxes/${encodeURIComponent(token)}/editor");
               return;
             }
             if (data.status === "cloud_done" || data.status === "cloud_failed" || matchPhases.indexOf(phase) >= 0) {
               location.replace("/boxes/${encodeURIComponent(token)}/match");
               return;
             }
             if (el) el.textContent = data.label || "Building Match harness…";
           } catch (_) {}
           setTimeout(poll, 1500);
         })();
       </script>`
    );
  }

  return html(
    c.env,
    "Match",
    `<h1>Building Match…</h1><div class="card"><p>Harness is still uploading. This page will refresh.</p>
     <p id="wait" class="hint">Working…</p></div>
     <script>setTimeout(() => location.replace("/boxes/${encodeURIComponent(token)}/match"), 2000);</script>`
  );
});

app.get("/api/boxes/:token/match-file/*", async (c) => {
  const row = await collectionByBoxToken(c.env.DB, c.req.param("token"));
  if (!row) return c.text("Not found", 404);
  const jobId = cloudJobIdFromFolder(row.mac_handoff_folder);
  if (!jobId) return c.text("No job", 404);
  const token = c.req.param("token");
  const prefix = `/api/boxes/${token}/match-file/`;
  const filePath = c.req.path.slice(prefix.length);
  if (!filePath || filePath.includes("..")) return c.text("Invalid path", 400);
  if (
    !(
      filePath.startsWith("testing_ui_visual_baseline/") ||
      filePath.startsWith("mac_run/") ||
      filePath.startsWith("crops/") ||
      filePath.startsWith("boards/")
    )
  ) {
    return c.text("Forbidden", 403);
  }
  const upstream = await fetchCloudJobFile(c.env, jobId, filePath);
  const lower = filePath.toLowerCase();
  if (upstream.ok && (lower.endsWith(".html") || lower.endsWith(".htm"))) {
    const rewritten = rewriteSellerMatchFileHtml(await upstream.text(), token);
    return new Response(rewritten, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return upstream;
});

app.get("/o/:token", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE offer_token = ?`)
    .bind(c.req.param("token"))
    .first<CollectionRow>();
  if (!row || row.offer_cents == null) {
    return html(c.env, "Offer", `<div class="flash err">This offer link isn’t valid.</div>`);
  }
  const expired = offerExpired(row.offer_expires_at) || row.status === "withdrawn";
  const amount = centsToDollars(row.offer_cents);
  const token = row.offer_token!;
  const photos = await loadCollectionPhotos(c.env.DB, row.id);
  const photoBlock = offerPhotoGridHtml(token, photos);
  if (row.status === "declined") {
    return html(
      c.env,
      "Declined",
      `<h1>Offer declined</h1><div class="card"><p>Thanks for letting us know. No pressure. We kept a record in case you want to talk later, but this link can’t accept anymore.</p></div>`
    );
  }
  if (row.status === "accepted" || row.status === "paid" || row.status === "waiting_for_package" || row.status === "received" || row.status === "done") {
    const ship =
      row.delivery_method === "dropoff_florida"
        ? `<h2>Drop off</h2><p>You chose to drop off with Fins and Pins at a pin event in person in Florida. We'll coordinate the handoff after payment.</p>
           <p class="hint">We pay via PayPal Goods &amp; Services after you accept.</p>`
        : `<h2>Ship to</h2><p><strong>${escapeHtml(c.env.SHIP_TO_NAME)}</strong><br>${escapeHtml(c.env.SHIP_TO_ADDRESS).replace(/\n/g, "<br>")}</p>
           <p class="hint">Please ship with USPS, UPS, or similar within the United States. We pay via PayPal Goods &amp; Services after you accept.</p>`;
    return html(
      c.env,
      "Accepted",
      `<h1>You accepted</h1>
      <div class="card">
        <p>Our offer for everything in the photos you uploaded:</p>
        <div class="offer-amt">${escapeHtml(amount)}</div>
        ${ship}
        ${photoBlock}
      </div>`
    );
  }
  if (expired || row.status !== "offer_sent") {
    return html(
      c.env,
      "Expired",
      `<h1>This offer link has expired</h1>
      <div class="card"><p>No pressure. If you’d still like to sell, email us and we can reissue the same offer without starting pricing over.</p></div>`
    );
  }
  return html(
    c.env,
    "Your offer",
    `<h1>Your offer</h1>
    <div class="card">
      <p>This is our best offer for <strong>everything in the photos you uploaded</strong>.</p>
      <div class="offer-amt">${escapeHtml(amount)}</div>
      ${photoBlock}
      <form method="post" action="/o/${encodeURIComponent(token)}/accept">
        <label>PayPal Goods &amp; Services email<input required type="email" name="paypal_gs_email" value="${escapeHtml(row.paypal_gs_email || row.seller_email)}" autocomplete="email" /></label>
        <p class="hint">We pay this address after you accept, before you ${
          row.delivery_method === "dropoff_florida" ? "drop off" : "ship"
        }.</p>
        <button type="submit">Accept</button>
      </form>
      <form method="get" action="/o/${encodeURIComponent(token)}/decline" style="margin-top:12px">
        <button class="secondary" type="submit">Decline</button>
      </form>
      <p class="hint">The link works until ${escapeHtml(row.offer_expires_at || "")}. You can reopen it until then. No reminders, no pressure.</p>
    </div>`
  );
});

/** Seller photo bytes for an offer link (must match offer_token + collection). */
app.get("/o/:token/photos/:photoId", async (c) => {
  const row = await c.env.DB.prepare(`SELECT id FROM collections WHERE offer_token = ?`)
    .bind(c.req.param("token"))
    .first<{ id: string }>();
  if (!row) return c.notFound();
  const photo = await c.env.DB.prepare(
    `SELECT * FROM photos WHERE id = ? AND collection_id = ?`
  )
    .bind(c.req.param("photoId"), row.id)
    .first<PhotoRow>();
  if (!photo) return c.notFound();
  const obj = await c.env.BUCKET.get(photo.r2_key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  headers.set("content-type", photo.content_type || "image/jpeg");
  headers.set("cache-control", "private, max-age=300");
  return new Response(obj.body, { headers });
});

app.post("/o/:token/accept", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE offer_token = ?`)
    .bind(c.req.param("token"))
    .first<CollectionRow>();
  if (!row || row.status !== "offer_sent" || row.offer_cents == null || offerExpired(row.offer_expires_at)) {
    return c.redirect(`/o/${c.req.param("token")}`);
  }
  const form = await c.req.parseBody();
  const paypal = String(form.paypal_gs_email || "").trim().toLowerCase() || row.seller_email;
  const updated = nowIso();
  await c.env.DB.prepare(`UPDATE collections SET status = 'accepted', paypal_gs_email = ?, updated_at = ? WHERE id = ?`)
    .bind(paypal, updated, row.id)
    .run();
  await logEvent(c.env.DB, row.id, row.seller_email, "accepted", { offer_cents: row.offer_cents, paypal });
  const mail = readyToPayEmail({
    collectionId: row.id,
    sellerName: row.seller_name,
    sellerEmail: row.seller_email,
    paypal,
    offerLabel: centsToDollars(row.offer_cents),
    adminLink: adminUrl(c.env, row.id),
  });
  mail.to = staffEmails(c.env);
  const sent = await sendEmail(c.env, mail);
  await logEvent(c.env.DB, row.id, "system", "ready_to_pay_email", sent);
  return c.redirect(`/o/${c.req.param("token")}`);
});

app.get("/o/:token/decline", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE offer_token = ?`)
    .bind(c.req.param("token"))
    .first<CollectionRow>();
  if (!row) return html(c.env, "Offer", `<div class="flash err">Not found.</div>`);
  return html(
    c.env,
    "Decline",
    `<h1>Decline this offer</h1>
    <div class="card">
      <p>Totally fine. If you want, tell us why (optional), and we won’t use it to negotiate.</p>
      <form method="post" action="/o/${encodeURIComponent(row.offer_token!)}/decline">
        <label>Reason
          <select name="reason">
            <option value="">Prefer not to say</option>
            <option value="price">The number wasn’t right</option>
            <option value="sold_elsewhere">Sold elsewhere</option>
            <option value="not_ready">Not ready to sell</option>
            <option value="shipping">Shipping</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>If it was the price, what amount would have worked? <span class="hint">(optional)</span>
          <input name="wanted" inputmode="decimal" placeholder="$" />
        </label>
        <label>Anything else? <span class="hint">(optional)</span>
          <textarea name="detail"></textarea>
        </label>
        <div class="row">
          <button type="submit">Submit decline</button>
          <a class="btn secondary" href="/o/${encodeURIComponent(row.offer_token!)}">Go back</a>
        </div>
      </form>
    </div>`
  );
});

app.post("/o/:token/decline", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE offer_token = ?`)
    .bind(c.req.param("token"))
    .first<CollectionRow>();
  if (!row || row.status !== "offer_sent") return c.redirect(`/o/${c.req.param("token")}`);
  const form = await c.req.parseBody();
  const reason = String(form.reason || "") || null;
  const wanted = parseDollarsToCents(String(form.wanted || ""));
  const detail = String(form.detail || "").trim() || null;
  await c.env.DB.prepare(
    `UPDATE collections SET status = 'declined', decline_reason = ?, decline_wanted_cents = ?, decline_detail = ?, updated_at = ? WHERE id = ?`
  )
    .bind(reason, wanted, detail, nowIso(), row.id)
    .run();
  await logEvent(c.env.DB, row.id, row.seller_email, "declined", { reason, wanted, detail });
  return html(
    c.env,
    "Declined",
    `<h1>Thanks</h1><div class="card"><p>No pressure at all. We hope the pins find a good home.</p></div>`
  );
});

/* ---------------- staff ---------------- */

app.get("/admin", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const rows = await c.env.DB.prepare(`SELECT * FROM collections ORDER BY updated_at DESC`).all<CollectionRow>();
  const byStatus = new Map<string, CollectionRow[]>();
  for (const col of KANBAN_COLUMNS) byStatus.set(col.id, []);
  for (const r of rows.results || []) {
    const list = byStatus.get(r.status) || [];
    list.push(r);
    byStatus.set(r.status, list);
  }
  const cols = KANBAN_COLUMNS.map((col) => {
    const source =
      col.id === "declined"
        ? (byStatus.get("declined") || []).filter((r) => !declinedWantedMore(r))
        : byStatus.get(col.id) || [];
    const cards = source
      .map((r) => {
        const img = r.cover_photo_id
          ? `<img src="/admin/collections/${r.id}/photos/${r.cover_photo_id}" alt="" />`
          : "";
        const offer = r.offer_cents != null ? escapeHtml(centsToDollars(r.offer_cents)) : "No offer yet";
        const due = offerDueLabel(r.created_at, r.status);
        const dueHtml = due ? `<div class="meta">${escapeHtml(due)}</div>` : "";
        const asking =
          r.asking_cents != null
            ? `<div class="meta">Had in mind ${escapeHtml(centsToDollars(r.asking_cents))}</div>`
            : "";
        return `<a class="mini" href="/admin/collections/${r.id}">${img}<div class="who">${escapeHtml(r.seller_name)}</div><div class="meta">${escapeHtml(offer)} · ${r.photo_count} photos</div>${asking}${dueHtml}</a>`;
      })
      .join("");
    const declinedCol = `<section class="col"><h3>${escapeHtml(col.label)} (${source.length})</h3>${cards || `<p class="hint">Empty</p>`}</section>`;
    if (col.id !== "declined") return declinedCol;
    const more = (byStatus.get("declined") || []).filter(declinedWantedMore);
    const moreCards = more
      .map((r) => {
        const img = r.cover_photo_id
          ? `<img src="/admin/collections/${r.id}/photos/${r.cover_photo_id}" alt="" />`
          : "";
        const offered = r.offer_cents != null ? centsToDollars(r.offer_cents) : "n/a";
        const wanted = r.decline_wanted_cents != null ? centsToDollars(r.decline_wanted_cents) : "n/a";
        const ourPct = percentOfValue(r.offer_cents, r.harness_total_cents);
        const theirPct = percentOfValue(r.decline_wanted_cents, r.harness_total_cents);
        return `<a class="mini" href="/admin/collections/${r.id}">${img}<div class="who">${escapeHtml(r.seller_name)}</div>
          <div class="meta">Wanted ${escapeHtml(wanted)}</div>
          <div class="meta">We offered ${escapeHtml(offered)}</div>
          <div class="meta">Our offer ${escapeHtml(ourPct)} of value</div>
          <div class="meta">They wanted ${escapeHtml(theirPct)} of value</div></a>`;
      })
      .join("");
    return `${declinedCol}<section class="col"><h3>Declined - wanted more money (${more.length})</h3>${moreCards || `<p class="hint">Empty</p>`}</section>`;
  }).join("");
  return html(
    c.env,
    "Dashboard",
    `<h1>Collections</h1>
     <p class="lede">Signed in as ${escapeHtml(staff.email)}. Sellers never see this board.</p>
     <div class="kanban">${cols}</div>`,
    true
  );
});

app.get("/admin/waiting", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const rows = await c.env.DB.prepare(
    `SELECT * FROM collections WHERE status IN ('accepted','paid','waiting_for_package','received') ORDER BY updated_at DESC`
  ).all<CollectionRow>();
  const list = (rows.results || [])
    .map(
      (r) =>
        `<a class="mini" href="/admin/collections/${r.id}"><div class="who">${escapeHtml(r.seller_name)}</div><div class="meta">${escapeHtml(r.status)} · ${r.offer_cents != null ? escapeHtml(centsToDollars(r.offer_cents)) : ""}</div></a>`
    )
    .join("");
  return html(
    c.env,
    "Waiting / received",
    `<h1>Accepted → received</h1><div class="card">${list || "<p>None right now.</p>"}</div>`,
    true
  );
});

app.get("/admin/alerts", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const rows = await c.env.DB.prepare(`SELECT * FROM moderation_alerts ORDER BY created_at DESC LIMIT 100`).all<{
    id: string;
    seller_name: string;
    seller_email: string;
    paypal_gs_email: string;
    reason_codes: string;
    attempted_photo_count: number;
    created_at: string;
  }>();
  const items = (rows.results || [])
    .map(
      (r) => `<li><time>${escapeHtml(r.created_at)}</time>
        ${escapeHtml(r.seller_name)} · ${escapeHtml(r.seller_email)} · PayPal ${escapeHtml(r.paypal_gs_email)}
        · ${r.attempted_photo_count} photos · codes: ${escapeHtml(r.reason_codes)}
        <div class="hint">No image stored.</div></li>`
    )
    .join("");
  return html(
    c.env,
    "Moderation alerts",
    `<h1>Moderation alerts</h1>
     <p class="lede">Identity + reason codes only. Images were deleted and are not here.</p>
     <ul class="timeline">${items || "<li>None yet.</li>"}</ul>`,
    true
  );
});

app.get("/admin/collections/:id", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<CollectionRow>();
  if (!row) return html(c.env, "Missing", `<div class="flash err">Not found</div>`, true);
  const photos = await c.env.DB.prepare(`SELECT * FROM photos WHERE collection_id = ? ORDER BY created_at`)
    .bind(row.id)
    .all<PhotoRow>();
  const storedPhotoCount = (photos.results || []).length;
  const pendingFinish = await c.env.DB.prepare(
    `SELECT id FROM upload_sessions WHERE collection_id = ? AND finish_started_at IS NOT NULL LIMIT 1`
  )
    .bind(row.id)
    .first<{ id: string }>();
  const events = await c.env.DB.prepare(
    `SELECT * FROM events WHERE collection_id = ? ORDER BY created_at DESC LIMIT 80`
  )
    .bind(row.id)
    .all<{ type: string; actor: string; payload_json: string | null; created_at: string }>();
  const helpers = offerHelpers(row.harness_total_cents);
  const helperHtml = helpers
    ? `<div class="helpers">
        <div><span>Harness total</span>${escapeHtml(centsToDollars(helpers.total))}</div>
        <div><span>30%</span>${escapeHtml(centsToDollars(helpers.p30))}</div>
        <div><span>40%</span>${escapeHtml(centsToDollars(helpers.p40))}</div>
        <div><span>50%</span>${escapeHtml(centsToDollars(helpers.p50))}</div>
        <div><span>60%</span>${escapeHtml(centsToDollars(helpers.p60))}</div>
      </div>`
    : `<p class="hint">Harness total appears after you pull from Firebase (or enter it below).</p>`;
  const cover = row.cover_photo_id
    ? `<img class="cover" src="/admin/collections/${row.id}/photos/${row.cover_photo_id}" alt="Cover" />`
    : "";
  const flashOk = c.req.query("ok");
  const flashErr = c.req.query("err");
  const flash = flashErr
    ? `<div class="flash err">${escapeHtml(flashErr)}</div>`
    : flashOk
      ? `<div class="flash ok">${escapeHtml(flashOk)}</div>`
      : "";
  const boxEditorHref = `/admin/collections/${row.id}/box-editor`;
  const awaitingBoxes = row.mac_handoff_status === "cloud_awaiting_boxes";
  const pricingBusy =
    row.mac_handoff_status === "cloud_running" ||
    row.mac_handoff_status === "cloud_queued" ||
    row.mac_handoff_status === "cloud_confirming";
  const canEditBoxes =
    Boolean(row.mac_handoff_folder) &&
    (row.mac_handoff_status === "cloud_done" ||
      row.mac_handoff_status === "cloud_awaiting_boxes" ||
      row.mac_handoff_status === "cloud_confirming");
  const finishIncomplete =
    Boolean(pendingFinish) || storedPhotoCount < Number(row.photo_count || 0);
  const optionalBoxEdit = canEditBoxes
    ? `<p style="margin-top:10px"><a class="btn secondary" href="${boxEditorHref}">Edit boxes (optional)</a></p>
       <p class="hint">Only if detections look wrong. Saving reprices added/moved boxes, drops deleted ones, and keeps unchanged eBay results.</p>`
    : "";
  // Same label as non-cloud intake admin ("Open pricing overlay"). Prefer same-origin cloud proxy.
  const cloudJobForOverlay = cloudJobIdFromFolder(
    (row as CollectionRow & { mac_handoff_folder?: string | null }).mac_handoff_folder
  );
  const overlayHref = row.overlay_url
    ? cloudJobForOverlay
      ? `/admin/collections/${row.id}/cloud-harness`
      : row.overlay_url
    : "";
  const overlayBlock = overlayHref
    ? `<p><a class="btn" href="${overlayHref}" target="_blank" rel="noopener">Open pricing overlay</a></p>
       <p class="hint">Same CTM / CTP harness as Mac intake (ClickToMatch → ClickToPrice). Lexi is not texted from this lab.</p>
       ${optionalBoxEdit}`
    : pricingBusy
      ? `<p class="hint"><strong>Pricing in progress</strong> (${escapeHtml(row.mac_handoff_status || "")}). <strong>Open pricing overlay</strong> appears when Match is ready.</p>
         ${optionalBoxEdit}`
      : awaitingBoxes
        ? `<p class="hint">Detect finished; continuing into eBay shortly (or use Resume confirm below).</p>
           ${optionalBoxEdit}
           <form method="post" action="/admin/collections/${row.id}/confirm-boxes-as-detected" style="margin-top:8px">
             <button class="secondary" type="submit">Resume confirm + price now</button>
           </form>`
        : finishIncomplete
          ? `<p class="hint"><strong>Still ingesting photos</strong> (${storedPhotoCount} of ${row.photo_count} stored). Detect + price starts after photos are stored.</p>
             <form method="post" action="/admin/collections/${row.id}/resume-finish" style="margin-top:8px">
               <button type="submit">Resume photo finish now</button>
             </form>`
          : `<p class="hint"><strong>Open pricing overlay</strong> appears after <strong>Detect + price</strong> finishes. Board Box Editor is optional afterward.</p>`;
  const next = staffNextStatuses(row.status)
    .map(
      (s) =>
        `<form method="post" action="/admin/collections/${row.id}/status" style="display:inline">
           <input type="hidden" name="status" value="${s}" />
           <button class="secondary" type="submit">${s.replace(/_/g, " ")}</button>
         </form>`
    )
    .join("");
  const photoGrid = (photos.results || [])
    .map(
      (p) =>
        `<a href="/admin/collections/${row.id}/photos/${p.id}" target="_blank"><img src="/admin/collections/${row.id}/photos/${p.id}" alt="" /></a>`
    )
    .join("");
  const ev = (events.results || [])
    .map(
      (e) =>
        `<li><time>${escapeHtml(e.created_at)}</time><strong>${escapeHtml(e.type)}</strong> · ${escapeHtml(e.actor)}
         ${e.payload_json ? `<div class="hint">${escapeHtml(e.payload_json)}</div>` : ""}</li>`
    )
    .join("");
  const expired = offerExpired(row.offer_expires_at);
  const paypalHref = paypalPayUrl(row.paypal_gs_email, row.offer_cents);
  // Plain text (not mailto). Pay with the button so Lexi/Steve both open PayPal, not Mail.
  const paypalPlain = escapeHtml(row.paypal_gs_email).replace(/@/g, "&#64;");
  const showPaypalPay =
    Boolean(row.paypal_gs_email) &&
    (row.status === "accepted" ||
      row.status === "paid" ||
      row.status === "waiting_for_package" ||
      row.status === "received");
  const paypalPayBtn = showPaypalPay
    ? `<div class="card">
         <h2>Pay seller</h2>
         <p>PayPal Goods &amp; Services: <strong>${paypalPlain}</strong></p>
         <p class="row"><a class="btn" href="${escapeHtml(paypalHref)}" target="_blank" rel="noopener">Open in PayPal to pay</a></p>
         <p class="hint">Opens PayPal with this email${
           row.offer_cents != null ? " and the offer amount" : ""
         }. Confirm Goods &amp; Services before you send.</p>
       </div>`
    : "";
  return html(
    c.env,
    row.seller_name,
    `${cover}
    ${flash}
    <h1>${escapeHtml(row.seller_name)}</h1>
    <p class="lede">${escapeHtml(row.status.replace(/_/g, " "))} · ${escapeHtml(row.seller_email).replace(/@/g, "&#64;")} · PayPal ${paypalPlain}
    ${row.instagram ? " · " + escapeHtml(row.instagram) : ""}
    ${
      row.delivery_method === "dropoff_florida"
        ? " · Drop off in Florida"
        : row.delivery_method === "ship_us"
          ? " · Ship within US"
          : ""
    }</p>
    ${paypalPayBtn}
    <div class="card">
      <h2>Pricing overlay (seller never sees this)</h2>
      ${overlayBlock}
      ${helperHtml}
      <div class="row" style="margin-top:12px">
        <form method="post" action="/admin/collections/${row.id}/pull-harness-total">
          <button type="submit" ${row.overlay_url ? "" : "disabled"}>Pull total from Firebase</button>
        </form>
      </div>
      <p class="hint">Pull after CTM Match / CTP / manual prices. Uses Firebase display_price values (same as Mac intake).</p>
      <form method="post" action="/admin/collections/${row.id}/overlay" style="margin-top:12px">
        <label>Harness total (dollars, no pin count shown to seller)<input name="harness_total" value="${row.harness_total_cents != null ? String(row.harness_total_cents / 100) : ""}" inputmode="decimal" /></label>
        <button type="submit">Save total</button>
      </form>
      <form method="post" action="/admin/collections/${row.id}/note">
        <label>Private note<textarea name="note">${escapeHtml(row.internal_note || "")}</textarea></label>
        <button type="submit">Save note</button>
      </form>
    </div>
    <div class="card">
      <h2>Offer</h2>
      <p><strong>Their price:</strong> ${
        row.asking_cents != null
          ? escapeHtml(centsToDollars(row.asking_cents))
          : "They did not enter a price"
      }</p>
      <p><strong>Seller notes:</strong> ${
        row.seller_notes
          ? escapeHtml(row.seller_notes)
          : "None"
      }</p>
      <p><strong>Our offer:</strong> ${row.offer_cents != null ? escapeHtml(centsToDollars(row.offer_cents)) : "None yet"}
         ${row.offer_expires_at ? " · expires " + escapeHtml(row.offer_expires_at) : ""}
         ${expired && row.offer_cents != null ? " · <strong>expired</strong>" : ""}</p>
      <form method="post" action="/admin/collections/${row.id}/offer">
        <label>Offer amount (dollars)<input required name="offer" value="${row.offer_cents != null ? String(row.offer_cents / 100) : ""}" inputmode="decimal" /></label>
        <button type="submit">Send offer email</button>
      </form>
      ${
        row.offer_cents != null
          ? `<form method="post" action="/admin/collections/${row.id}/reissue" style="margin-top:10px"><button class="secondary" type="submit">Reissue same offer (new 7-day link, no reprice)</button></form>`
          : ""
      }
    </div>
    <div class="card">
      <h2>Status</h2>
      <div class="row">${next || "<span class='hint'>No staff moves from here (accept/decline are seller actions).</span>"}</div>
      ${
        canEditBoxes
          ? `<p class="row" style="margin-top:14px">
               <a class="btn secondary" href="${boxEditorHref}">Edit boxes (optional)</a>
             </p>`
          : ""
      }
      <form method="post" action="/admin/collections/${row.id}/send-to-ctp" style="margin-top:14px">
        <button type="submit" ${
          row.mac_handoff_status === "cloud_running" ||
          row.mac_handoff_status === "cloud_queued" ||
          row.mac_handoff_status === "cloud_confirming"
            ? "disabled"
            : ""
        }>${
          row.mac_handoff_status === "cloud_done" || row.mac_handoff_status === "cloud_failed"
            ? "Re-detect + price"
            : row.mac_handoff_status === "cloud_running" || row.mac_handoff_status === "cloud_queued"
              ? "Detect / price in progress…"
              : row.mac_handoff_status === "cloud_awaiting_boxes"
                ? "Re-detect + price"
                : row.mac_handoff_status === "cloud_confirming"
                  ? "Finishing pricing…"
                  : "Detect + price"
        }</button>
      </form>
      <form method="post" action="/admin/collections/${row.id}/hold-ctp" style="margin-top:8px">
        <button class="secondary" type="submit">Hold / don't price</button>
      </form>
      <p class="hint">CLOUD LAB: RF-DETR then eBay immediately. Board Box Editor is optional for bad boxes (delta reprice only). Lexi notify is off.
      ${
        row.mac_handoff_status
          ? ` Current: <strong>${escapeHtml(row.mac_handoff_status)}</strong>${
              row.mac_handoff_folder ? ` → ${escapeHtml(row.mac_handoff_folder)}` : ""
            }${row.mac_handoff_at ? ` at ${escapeHtml(row.mac_handoff_at)}` : ""}.`
          : ""
      }</p>
      <form method="post" action="/admin/collections/${row.id}/tracking" style="margin-top:12px">
        <label>Tracking (optional)<input name="tracking" value="${escapeHtml(row.tracking || "")}" /></label>
        <button class="secondary" type="submit">Save tracking</button>
      </form>
    </div>
    <div class="card">
      <h2>Photos (${row.photo_count})</h2>
      <p>
        <a class="btn" href="/admin/collections/${row.id}/photos.zip">Download all photos (ZIP)</a>
        <span class="hint"> Unzip into CollectionsToPrice/&lt;SellerName&gt;/ for Mac pricing.</span>
      </p>
      <p class="hint"><a href="/admin/collections/${row.id}/manifest.json">Download manifest</a> (JSON)</p>
      <div class="photo-grid">${photoGrid}</div>
    </div>
    ${
      row.decline_reason || row.decline_wanted_cents || row.decline_detail
        ? `<div class="card"><h2>Decline feedback</h2>
           <p>Reason: ${escapeHtml(row.decline_reason || "-")}<br>
           Wanted: ${row.decline_wanted_cents != null ? escapeHtml(centsToDollars(row.decline_wanted_cents)) : "-"}<br>
           We offered: ${row.offer_cents != null ? escapeHtml(centsToDollars(row.offer_cents)) : "-"}<br>
           Our offer: ${escapeHtml(percentOfValue(row.offer_cents, row.harness_total_cents))} of value<br>
           They wanted: ${escapeHtml(percentOfValue(row.decline_wanted_cents, row.harness_total_cents))} of value<br>
           ${escapeHtml(row.decline_detail || "")}</p></div>`
        : ""
    }
    <div class="card">
      <h2>Event log</h2>
      <ul class="timeline">${ev}</ul>
    </div>`,
    true
  );
});

app.post("/admin/collections/:id/note", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const form = await c.req.parseBody();
  await c.env.DB.prepare(`UPDATE collections SET internal_note = ?, updated_at = ? WHERE id = ?`)
    .bind(String(form.note || ""), nowIso(), c.req.param("id"))
    .run();
  await logEvent(c.env.DB, c.req.param("id"), staff.email, "note_updated");
  return c.redirect(`/admin/collections/${c.req.param("id")}`);
});

app.post("/admin/collections/:id/overlay", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const form = await c.req.parseBody();
  const total = parseDollarsToCents(String(form.harness_total || ""));
  await c.env.DB.prepare(`UPDATE collections SET harness_total_cents = ?, updated_at = ? WHERE id = ?`)
    .bind(total, nowIso(), c.req.param("id"))
    .run();
  await logEvent(c.env.DB, c.req.param("id"), staff.email, "harness_total_saved", { total });
  return c.redirect(
    `/admin/collections/${c.req.param("id")}?ok=` +
      encodeURIComponent(total != null ? `Saved harness total ${centsToDollars(total)}.` : "Cleared harness total.")
  );
});

app.post("/admin/collections/:id/pull-harness-total", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<CollectionRow>();
  if (!row) return c.redirect("/admin");
  if (!row.overlay_url && !(row as CollectionRow & { mac_handoff_folder?: string | null }).mac_handoff_folder) {
    return c.redirect(
      `/admin/collections/${row.id}?err=` +
        encodeURIComponent("Pricing overlay is not ready yet. Run Detect + price first.")
    );
  }
  const jobId = cloudJobIdFromFolder(
    (row as CollectionRow & { mac_handoff_folder?: string | null }).mac_handoff_folder
  );
  const pulled = await pullHarnessTotalFromFirebase(row.overlay_url || "", {
    env: jobId ? c.env : undefined,
    jobId,
  });
  if (!pulled.ok) {
    return c.redirect(`/admin/collections/${row.id}?err=` + encodeURIComponent(pulled.error));
  }
  await c.env.DB.prepare(`UPDATE collections SET harness_total_cents = ?, updated_at = ? WHERE id = ?`)
    .bind(pulled.totalCents, nowIso(), row.id)
    .run();
  await logEvent(c.env.DB, row.id, staff.email, "harness_total_pulled", {
    total: pulled.totalCents,
    priced: pulled.priced,
    pin_count: pulled.pinCount,
    test_run_id: pulled.testRunId,
  });
  const note =
    pulled.priced < pulled.pinCount
      ? `Pulled ${centsToDollars(pulled.totalCents)} from ${pulled.priced} of ${pulled.pinCount} pins (some still unpriced).`
      : `Pulled ${centsToDollars(pulled.totalCents)} from ${pulled.priced} priced pins.`;
  return c.redirect(`/admin/collections/${row.id}?ok=` + encodeURIComponent(note));
});

app.post("/admin/collections/:id/offer", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<CollectionRow>();
  if (!row) return c.redirect("/admin");
  const form = await c.req.parseBody();
  const cents = parseDollarsToCents(String(form.offer || ""));
  if (cents == null) return c.redirect(`/admin/collections/${row.id}`);
  const token = id();
  const days = Number(c.env.OFFER_TTL_DAYS || 7);
  const expires = addDaysIso(days);
  const updated = nowIso();
  await c.env.DB.prepare(
    `UPDATE collections SET offer_cents = ?, offer_token = ?, offer_sent_at = ?, offer_expires_at = ?, status = 'offer_sent', updated_at = ? WHERE id = ?`
  )
    .bind(cents, token, updated, expires, updated, row.id)
    .run();
  const mail = offerEmail({
    sellerName: row.seller_name,
    offerLabel: centsToDollars(cents),
    link: offerUrl(c.env, token),
    days,
  });
  mail.to = [row.seller_email];
  const sent = await sendEmail(c.env, mail);
  await logEvent(c.env.DB, row.id, staff.email, "offer_sent", { cents, sent });
  return c.redirect(`/admin/collections/${row.id}`);
});

app.post("/admin/collections/:id/reissue", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<CollectionRow>();
  if (!row || row.offer_cents == null) return c.redirect(`/admin/collections/${c.req.param("id")}`);
  const token = id();
  const days = Number(c.env.OFFER_TTL_DAYS || 7);
  const expires = addDaysIso(days);
  const updated = nowIso();
  await c.env.DB.prepare(
    `UPDATE collections SET offer_token = ?, offer_sent_at = ?, offer_expires_at = ?, status = 'offer_sent', updated_at = ? WHERE id = ?`
  )
    .bind(token, updated, expires, updated, row.id)
    .run();
  const mail = offerEmail({
    sellerName: row.seller_name,
    offerLabel: centsToDollars(row.offer_cents),
    link: offerUrl(c.env, token),
    days,
  });
  mail.to = [row.seller_email];
  const sent = await sendEmail(c.env, mail);
  await logEvent(c.env.DB, row.id, staff.email, "offer_reissued", { sent });
  return c.redirect(`/admin/collections/${row.id}`);
});

app.post("/admin/collections/:id/status", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<CollectionRow>();
  const form = await c.req.parseBody();
  const to = String(form.status || "") as CollectionRow["status"];
  if (!row || !canStaffMove(row.status, to)) return c.redirect(`/admin/collections/${c.req.param("id")}`);
  await c.env.DB.prepare(`UPDATE collections SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(to, nowIso(), row.id)
    .run();
  await logEvent(c.env.DB, row.id, staff.email, "status", { from: row.status, to });
  return c.redirect(`/admin/collections/${row.id}`);
});

app.post("/admin/collections/:id/tracking", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const form = await c.req.parseBody();
  await c.env.DB.prepare(`UPDATE collections SET tracking = ?, updated_at = ? WHERE id = ?`)
    .bind(String(form.tracking || "").trim() || null, nowIso(), c.req.param("id"))
    .run();
  return c.redirect(`/admin/collections/${c.req.param("id")}`);
});

app.post("/admin/collections/:id/resume-finish", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const collectionId = c.req.param("id");
  const session = await c.env.DB.prepare(
    `SELECT * FROM upload_sessions WHERE collection_id = ? AND finish_started_at IS NOT NULL LIMIT 1`
  )
    .bind(collectionId)
    .first<UploadSessionSnap>();
  if (!session) {
    return c.redirect(
      `/admin/collections/${collectionId}?err=${encodeURIComponent("No in-flight finish session (already done or expired).")}`
    );
  }
  const run = async () => {
    for (let i = 0; i < 8; i++) {
      const temps = await c.env.DB.prepare(
        `SELECT id, r2_key, original_filename, content_type, size_bytes FROM upload_temp_photos WHERE session_id = ? ORDER BY created_at`
      )
        .bind(session.id)
        .all<TempPhotoSnap>();
      const photos = temps.results || [];
      if (!photos.length) break;
      const stored = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM photos WHERE collection_id = ?`)
        .bind(collectionId)
        .first<{ n: number }>();
      if (Number(stored?.n || 0) >= photos.length) {
        // Force one more pass so auto-detect can run / session can clear.
        await processSubmissionBackground(c.env, session, photos);
        break;
      }
      await processSubmissionBackground(c.env, session, photos);
    }
  };
  try {
    c.executionCtx.waitUntil(run());
  } catch {
    await run();
  }
  await logEvent(c.env.DB, collectionId, staff.email, "finish_resume_requested");
  return c.redirect(
    `/admin/collections/${collectionId}?ok=${encodeURIComponent(
      "Resumed photo finish. Refresh in a minute; Detect + price continues after photos are stored."
    )}`
  );
});

app.post("/admin/collections/:id/send-to-ctp", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<CollectionRow>();
  if (!row) return c.redirect("/admin");
  const stored = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM photos WHERE collection_id = ?`)
    .bind(row.id)
    .first<{ n: number }>();
  if (Number(stored?.n || 0) < 1) {
    return c.redirect(
      `/admin/collections/${row.id}?err=${encodeURIComponent("No stored photos yet. Resume photo finish first.")}`
    );
  }
  await queueMacHandoff(c.env.DB, row, staff.email);
  try {
    c.executionCtx.waitUntil(runCloudDetectForCollection(c.env, row.id, staff.email));
  } catch {
    await runCloudDetectForCollection(c.env, row.id, staff.email);
  }
  return c.redirect(
    `/admin/collections/${row.id}?ok=${encodeURIComponent(
      "Detect + price started. Harness appears when Match is ready. Board Box Editor stays optional."
    )}`
  );
});

app.post("/admin/collections/:id/confirm-boxes-as-detected", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const collectionId = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT mac_handoff_folder, mac_handoff_status FROM collections WHERE id = ?`)
    .bind(collectionId)
    .first<{ mac_handoff_folder: string | null; mac_handoff_status: string | null }>();
  const jobId = cloudJobIdFromFolder(row?.mac_handoff_folder);
  if (!jobId || row?.mac_handoff_status !== "cloud_awaiting_boxes") {
    return c.redirect(
      `/admin/collections/${collectionId}?err=${encodeURIComponent("No job awaiting box confirm")}`
    );
  }
  await c.env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'cloud_confirming', mac_handoff_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(nowIso(), nowIso(), collectionId)
    .run();
  await saveConfirmPending(c.env, collectionId, jobId, undefined);
  const run = async () => {
    const result = await confirmCloudBoxes(c.env, jobId);
    if (!result.ok) {
      await c.env.DB.prepare(
        `UPDATE collections SET mac_handoff_status = 'cloud_failed', mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
      )
        .bind(nowIso(), nowIso(), `Confirm failed: ${(result.error || "").slice(0, 240)}`, collectionId)
        .run();
      await logEvent(c.env.DB, collectionId, staff.email, "cloud_price_failed", { error: result.error });
      return;
    }
    const harnessLocal = `${c.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/collections/${collectionId}/cloud-harness`;
    await c.env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_done', mac_handoff_folder = ?, mac_handoff_at = ?, updated_at = ?, overlay_url = ? WHERE id = ?`
    )
      .bind(`cloud:${result.job_id || jobId}`, nowIso(), nowIso(), harnessLocal, collectionId)
      .run();
    await clearConfirmPending(c.env, collectionId);
    await logEvent(c.env.DB, collectionId, staff.email, "cloud_price_done", {
      job_id: result.job_id || jobId,
      pin_count: result.pin_count,
      priced_count: result.priced_count,
      elapsed_sec: result.elapsed_sec,
      confirm_as_detected: true,
      remaining_deferred: result.remaining_deferred,
      notify_lexi: false,
    });
  };
  try {
    c.executionCtx.waitUntil(run());
  } catch {
    await run();
  }
  return c.redirect(
    `/admin/collections/${collectionId}?ok=${encodeURIComponent("Confirm as detected started")}`
  );
});

/**
 * Cloud Run POSTs here when detect finishes (waitUntil often dies before the sync response returns).
 * Auth: X-Intake-Cloud-Key must match CLOUD_PRICE_INVOKE_KEY.
 */
app.post("/internal/cloud-run/detect-complete", async (c) => {
  const expected = String(c.env.CLOUD_PRICE_INVOKE_KEY || "").trim();
  const presented = (c.req.header("X-Intake-Cloud-Key") || "").trim();
  if (!expected || presented !== expected) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    ok?: boolean;
    collection_id?: string;
    job_id?: string;
    pin_count?: number;
    prefetch_priced?: number;
    elapsed_sec?: number;
    phase?: string;
    boards_done?: number;
    boards_total?: number;
    error?: string;
  };
  const collectionId = String(body.collection_id || "").trim();
  if (!collectionId) return c.json({ ok: false, error: "collection_id required" }, 400);

  if (!body.ok || !body.job_id) {
    await c.env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_failed', mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
    )
      .bind(nowIso(), nowIso(), `Cloud detect failed: ${(body.error || "unknown").slice(0, 240)}`, collectionId)
      .run();
    await logEvent(c.env.DB, collectionId, "cloud-run", "cloud_price_failed", { error: body.error });
    return c.json({ ok: true, recorded: "failed" });
  }

  const phase = String(body.phase || "awaiting_box_confirm");
  const boardsDone = typeof body.boards_done === "number" ? body.boards_done : null;
  const boardsTotal = typeof body.boards_total === "number" ? body.boards_total : null;

  if (phase === "detecting" || phase === "board_ready" || phase === "detect_ready" || phase === "prefetching") {
    const note =
      phase === "board_ready"
        ? `Board ${boardsDone ?? "?"}/${boardsTotal ?? "?"} detected (${body.pin_count || "?"} pins). Pricing continues…`
        : phase === "detect_ready"
          ? `Detect ready (${body.pin_count || "?"} pins). eBay prefetch running…`
          : phase === "prefetching"
            ? `eBay prefetch in progress (${body.prefetch_priced || "?"} priced)…`
            : `Detecting pins (job ${body.job_id})…`;
    await c.env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_running', mac_handoff_folder = ?, mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ? AND mac_handoff_status IN ('cloud_running', 'cloud_queued', 'pricing', 'submitted', 'uploading')`
    )
      .bind(`cloud:${body.job_id}`, nowIso(), nowIso(), note, collectionId)
      .run();
    return c.json({ ok: true, recorded: "running", phase, boards_done: boardsDone });
  }

  // Final detect phase: auto-confirm-as-detected and finish eBay (BBE optional afterward).
  await c.env.DB.prepare(
    `UPDATE collections SET mac_handoff_folder = ?, mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
  )
    .bind(
      `cloud:${body.job_id}`,
      nowIso(),
      nowIso(),
      `Detect OK (${body.pin_count || "?"} pins, ${body.prefetch_priced || "?"} prefetched). Continuing eBay…`,
      collectionId
    )
    .run();
  await logEvent(c.env.DB, collectionId, "cloud-run", "cloud_detect_ready", {
    job_id: body.job_id,
    pin_count: body.pin_count,
    prefetch_priced: body.prefetch_priced,
    elapsed_sec: body.elapsed_sec,
    phase,
    boards_done: boardsDone,
    boards_total: boardsTotal,
    via: "callback",
    notify_lexi: false,
  });

  const jobId = String(body.job_id);
  const run = async () => {
    // Ensure claimable status if callback raced ahead of sync detect.
    await c.env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = CASE
         WHEN mac_handoff_status IN ('cloud_done', 'cloud_confirming', 'cloud_failed') THEN mac_handoff_status
         ELSE 'cloud_running'
       END, updated_at = ? WHERE id = ?`
    )
      .bind(nowIso(), collectionId)
      .run();
    await continuePricingAfterDetect(c.env, collectionId, jobId, "cloud-run", { via: "detect_callback" });
  };
  try {
    c.executionCtx.waitUntil(run());
  } catch {
    await run();
  }
  return c.json({ ok: true, recorded: "auto_confirm", phase, boards_done: boardsDone });
});

/**
 * Cloud Run pulls board JPEGs here (source_urls) instead of multipart upload.
 * Auth: X-Intake-Cloud-Key must match CLOUD_PRICE_INVOKE_KEY.
 */
app.get("/internal/cloud-run/photos/:photoId", async (c) => {
  const expected = String(c.env.CLOUD_PRICE_INVOKE_KEY || "").trim();
  const presented = (c.req.header("X-Intake-Cloud-Key") || "").trim();
  if (!expected || presented !== expected) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }
  const photoId = c.req.param("photoId");
  const row = await c.env.DB.prepare(
    `SELECT id, r2_key, content_type, original_filename FROM photos WHERE id = ?`
  )
    .bind(photoId)
    .first<{ id: string; r2_key: string; content_type: string | null; original_filename: string | null }>();
  if (!row) return c.json({ ok: false, error: "Photo not found" }, 404);
  const obj = await c.env.BUCKET.get(row.r2_key);
  if (!obj) return c.json({ ok: false, error: "R2 object missing" }, 404);
  const filename = (row.original_filename || `${row.id}.jpg`).replace(/[^\w.\-]+/g, "_");
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": row.content_type || "image/jpeg",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, max-age=300",
    },
  });
});

app.get("/admin/collections/:id/box-editor", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const idParam = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT mac_handoff_status FROM collections WHERE id = ?`)
    .bind(idParam)
    .first<{ mac_handoff_status: string | null }>();
  if (!row) return c.redirect("/admin");
  if (
    row.mac_handoff_status !== "cloud_awaiting_boxes" &&
    row.mac_handoff_status !== "cloud_done" &&
    row.mac_handoff_status !== "cloud_confirming"
  ) {
    return c.redirect(
      `/admin/collections/${idParam}?err=${encodeURIComponent(
        "Run Detect + price first. Optional box editor opens after detect has a job."
      )}`
    );
  }
  // Serve editor HTML from assets (staff-gated). Query string drives collection id in the page JS.
  const asset = await c.env.ASSETS.fetch(new URL("/cloud-board-box-editor.html", c.req.url));
  if (asset.status === 404) {
    return c.text("Board Box Editor asset missing (cloud-board-box-editor.html)", 500);
  }
  let htmlText = await asset.text();
  // Inject collection id so the page works even if the query string is stripped by a proxy.
  htmlText = htmlText.replace(
    'const collectionId = (params.get("collection") || "").trim();',
    `const collectionId = (params.get("collection") || "${idParam}").trim() || "${idParam}";`
  );
  return new Response(htmlText, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});

app.get("/api/cloud/collections/:id/box-session", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const collectionId = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT mac_handoff_folder, mac_handoff_status FROM collections WHERE id = ?`)
    .bind(collectionId)
    .first<{ mac_handoff_folder: string | null; mac_handoff_status: string | null }>();
  const jobId = cloudJobIdFromFolder(row?.mac_handoff_folder);
  if (!jobId) {
    return c.json({ ok: false, error: "No cloud job for this collection" }, 404);
  }
  const prefetch = await fetchCloudJobJson(c.env, jobId, "prefetch.json");
  if (!prefetch.ok) {
    return c.json({ ok: false, error: prefetch.error }, 502);
  }
  return c.json({
    ok: true,
    collection_id: collectionId,
    job_id: jobId,
    status: row?.mac_handoff_status,
    boards: prefetch.body.boards || [],
    pin_count: prefetch.body.pin_count,
    prefetch_priced: prefetch.body.prefetch_priced,
  });
});

app.post("/api/cloud/collections/:id/confirm-boxes", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const collectionId = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT mac_handoff_folder, mac_handoff_status FROM collections WHERE id = ?`)
    .bind(collectionId)
    .first<{ mac_handoff_folder: string | null; mac_handoff_status: string | null }>();
  const jobId = cloudJobIdFromFolder(row?.mac_handoff_folder);
  if (!jobId) {
    return c.json({ ok: false, error: "No cloud job for this collection" }, 404);
  }
  if (
    row?.mac_handoff_status !== "cloud_awaiting_boxes" &&
    row?.mac_handoff_status !== "cloud_confirming" &&
    row?.mac_handoff_status !== "cloud_done"
  ) {
    return c.json({ ok: false, error: `Unexpected status ${row?.mac_handoff_status}` }, 409);
  }
  const body = (await c.req.json().catch(() => ({}))) as { boards?: unknown[] };
  await c.env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'cloud_confirming', mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
  )
    .bind(nowIso(), nowIso(), "Applying box edits (delta reprice)…", collectionId)
    .run();
  await saveConfirmPending(c.env, collectionId, jobId, Array.isArray(body.boards) ? body.boards : undefined);

  const result = await confirmCloudBoxes(c.env, jobId, body.boards);
  if (!result.ok) {
    await c.env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'cloud_failed', mac_handoff_at = ?, updated_at = ?, internal_note = ? WHERE id = ?`
    )
      .bind(nowIso(), nowIso(), `Confirm failed: ${(result.error || "").slice(0, 240)}`, collectionId)
      .run();
    await logEvent(c.env.DB, collectionId, staff.email, "cloud_price_failed", { error: result.error });
    return c.json({ ok: false, error: result.error || "Confirm failed" }, 500);
  }

  const harnessLocal = `${c.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/collections/${collectionId}/cloud-harness`;
  await c.env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'cloud_done', mac_handoff_folder = ?, mac_handoff_at = ?, updated_at = ?, overlay_url = ? WHERE id = ?`
  )
    .bind(`cloud:${result.job_id || jobId}`, nowIso(), nowIso(), harnessLocal, collectionId)
    .run();
  await clearConfirmPending(c.env, collectionId);
  await logEvent(c.env.DB, collectionId, staff.email, "cloud_price_done", {
    job_id: result.job_id || jobId,
    pin_count: result.pin_count,
    priced_count: result.priced_count,
    elapsed_sec: result.elapsed_sec,
    delta: result.delta,
    remaining_deferred: result.remaining_deferred,
    notify_lexi: false,
  });
  return c.json({
    ok: true,
    job_id: result.job_id || jobId,
    pin_count: result.pin_count,
    priced_count: result.priced_count,
    elapsed_sec: result.elapsed_sec,
    match_ready: true,
    remaining_deferred: Boolean(result.remaining_deferred),
    match_url: harnessLocal,
    next_url: harnessLocal,
    delta: result.delta,
    harness_url: harnessLocal,
  });
});

app.get("/admin/collections/:id/cloud-harness", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const row = await c.env.DB.prepare(`SELECT mac_handoff_folder FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<{ mac_handoff_folder: string | null }>();
  const folder = row?.mac_handoff_folder || "";
  const m = /^cloud:(.+)$/.exec(folder);
  if (!m) return c.text("No cloud job yet for this collection", 404);
  return fetchCloudHarnessHtml(c.env, m[1]);
});

app.get("/api/cloud/jobs/:jobId/file/*", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const jobId = c.req.param("jobId");
  const filePath = c.req.path.replace(`/api/cloud/jobs/${jobId}/file/`, "");
  if (!filePath || filePath.includes("..")) return c.text("Invalid path", 400);
  return fetchCloudJobFile(c.env, jobId, filePath);
});

app.post("/admin/collections/:id/hold-ctp", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<CollectionRow>();
  if (!row) return c.redirect("/admin");
  const updated = nowIso();
  await c.env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'held', mac_handoff_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(updated, updated, row.id)
    .run();
  await logEvent(c.env.DB, row.id, staff.email, "mac_handoff_held");
  return c.redirect(`/admin/collections/${row.id}`);
});

/** Mac helper: list collections queued for CollectionsToPrice. */
app.get("/api/mac/handoff/pending", async (c) => {
  const auth = await requireMacOrStaff(c.env, c.req.raw);
  if (auth instanceof Response) return auth;
  const rows = await c.env.DB.prepare(
    `SELECT id, seller_name, seller_email, photo_count, mac_handoff_folder, mac_handoff_status, mac_handoff_at, status
     FROM collections WHERE mac_handoff_status = 'queued' ORDER BY mac_handoff_at ASC LIMIT 20`
  ).all();
  return c.json({ ok: true, collections: rows.results || [] });
});

/**
 * Intake-only overlay linker: collections that have a handoff folder but no overlay yet.
 * Does not change Named Collections; a separate Mac script polls published harnesses.
 */
app.get("/api/mac/handoff/awaiting-overlay", async (c) => {
  const auth = await requireMacOrStaff(c.env, c.req.raw);
  if (auth instanceof Response) return auth;
  const rows = await c.env.DB.prepare(
    `SELECT id, seller_name, mac_handoff_folder, mac_handoff_status, mac_handoff_at, status, overlay_url
     FROM collections
     WHERE mac_handoff_folder IS NOT NULL
       AND mac_handoff_folder != ''
       AND (overlay_url IS NULL OR overlay_url = '')
       AND status NOT IN ('withdrawn', 'declined', 'done')
       AND IFNULL(mac_handoff_status, '') NOT IN ('failed', 'held')
       AND photo_count >= 1
       AND EXISTS (SELECT 1 FROM photos p WHERE p.collection_id = collections.id)
     ORDER BY mac_handoff_at DESC
     LIMIT 100`
  ).all();
  return c.json({ ok: true, collections: rows.results || [] });
});

/** Intake-only linker posts the overlay URL after Named Collections publishes. */
app.post("/api/mac/handoff/:id/pricing-overlay", async (c) => {
  const auth = await requireMacOrStaff(c.env, c.req.raw);
  if (auth instanceof Response) return auth;
  const body = (await c.req.json().catch(() => ({}))) as {
    overlay_url?: string;
    pricing_final_name?: string;
  };
  // Staff button opens the harness overlay (index.html), not CTM (new_ctm.html).
  const url = String(body.overlay_url || "")
    .trim()
    .replace(/\/new_ctm\.html(\?.*)?$/i, "/index.html$1");
  if (!url.startsWith("https://")) {
    return c.json({ error: "overlay_url must be an https URL" }, 400);
  }
  const row = await c.env.DB.prepare(`SELECT id, overlay_url FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<{ id: string; overlay_url: string | null }>();
  if (!row) return c.json({ error: "not found" }, 404);
  const updated = nowIso();
  await c.env.DB.prepare(`UPDATE collections SET overlay_url = ?, updated_at = ? WHERE id = ?`)
    .bind(url, updated, row.id)
    .run();
  await logEvent(c.env.DB, row.id, auth.email, "pricing_overlay_linked", {
    overlay_url: url,
    pricing_final_name: body.pricing_final_name || preparingInventoryFinalName(url),
    replaced: Boolean(row.overlay_url),
  });
  return c.json({ ok: true });
});

app.get("/api/mac/handoff/:id/manifest", async (c) => {
  const auth = await requireMacOrStaff(c.env, c.req.raw);
  if (auth instanceof Response) return auth;
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<CollectionRow>();
  if (!row) return c.json({ error: "not found" }, 404);
  const photos = await c.env.DB.prepare(
    `SELECT id, original_filename, content_type, size_bytes FROM photos WHERE collection_id = ? ORDER BY created_at`
  )
    .bind(row.id)
    .all();
  return c.json({
    collectionId: row.id,
    seller_name: row.seller_name,
    seller_notes: row.seller_notes,
    folder: row.mac_handoff_folder || folderNameFromSeller(row.seller_name, row.id),
    photos: (photos.results || []).map((p: { id: string; original_filename: string | null; content_type: string | null }, i: number) => ({
      id: p.id,
      filename: p.original_filename || `photo_${String(i + 1).padStart(3, "0")}.jpg`,
      content_type: p.content_type,
      url: `/api/mac/handoff/${row.id}/photos/${p.id}`,
    })),
  });
});

app.get("/api/mac/handoff/:id/photos/:photoId", async (c) => {
  const auth = await requireMacOrStaff(c.env, c.req.raw);
  if (auth instanceof Response) return auth;
  const photo = await c.env.DB.prepare(
    `SELECT * FROM photos WHERE id = ? AND collection_id = ?`
  )
    .bind(c.req.param("photoId"), c.req.param("id"))
    .first<PhotoRow>();
  if (!photo) return c.notFound();
  const obj = await c.env.BUCKET.get(photo.r2_key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": photo.content_type || "image/jpeg",
      "cache-control": "private, no-store",
    },
  });
});

app.post("/api/mac/handoff/:id/complete", async (c) => {
  const auth = await requireMacOrStaff(c.env, c.req.raw);
  if (auth instanceof Response) return auth;
  const body = (await c.req.json().catch(() => ({}))) as {
    folder?: string;
    error?: string;
    photo_count?: number;
  };
  const updated = nowIso();
  const collectionId = c.req.param("id");
  if (body.error) {
    await c.env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'failed', mac_handoff_at = ?, updated_at = ? WHERE id = ?`
    )
      .bind(updated, updated, collectionId)
      .run();
    await logEvent(c.env.DB, collectionId, auth.email, "mac_handoff_failed", { error: body.error });
    return c.json({ ok: false });
  }
  const row = await c.env.DB.prepare(
    `SELECT id, photo_count, seller_name, seller_email FROM collections WHERE id = ?`
  )
    .bind(collectionId)
    .first<{ id: string; photo_count: number; seller_name: string; seller_email: string }>();
  if (!row) return c.json({ error: "not found" }, 404);
  const dbPhotos = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM photos WHERE collection_id = ?`
  )
    .bind(collectionId)
    .first<{ n: number }>();
  const stored = Number(dbPhotos?.n || 0);
  const reported = body.photo_count != null ? Number(body.photo_count) : stored;
  if (stored < 1 || reported < 1 || stored !== row.photo_count || reported !== stored) {
    const err = `Refuse deliver: db_photos=${stored} collection.photo_count=${row.photo_count} reported=${reported}`;
    await c.env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'failed', mac_handoff_at = ?, updated_at = ? WHERE id = ?`
    )
      .bind(updated, updated, collectionId)
      .run();
    await logEvent(c.env.DB, collectionId, auth.email, "mac_handoff_failed", { error: err });
    await alertFinishIncomplete(c.env, {
      collectionId,
      sellerName: row.seller_name,
      sellerEmail: row.seller_email,
      expected: row.photo_count,
      stored,
      detail: err,
    });
    return c.json({ ok: false, error: err }, 409);
  }
  await c.env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'delivered', mac_handoff_folder = COALESCE(?, mac_handoff_folder), mac_handoff_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(body.folder || null, updated, updated, collectionId)
    .run();
  await logEvent(c.env.DB, collectionId, auth.email, "mac_handoff_delivered", {
    folder: body.folder || null,
    photo_count: stored,
  });
  return c.json({ ok: true });
});

app.get("/admin/collections/:id/photos/:photoId", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const photo = await c.env.DB.prepare(
    `SELECT * FROM photos WHERE id = ? AND collection_id = ?`
  )
    .bind(c.req.param("photoId"), c.req.param("id"))
    .first<PhotoRow>();
  if (!photo) return c.notFound();
  const obj = await c.env.BUCKET.get(photo.r2_key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  headers.set("content-type", photo.content_type || "image/jpeg");
  headers.set("cache-control", "private, max-age=60");
  return new Response(obj.body, { headers });
});

app.get("/admin/collections/:id/photos.zip", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<CollectionRow>();
  if (!row) return c.notFound();
  const photos = await c.env.DB.prepare(
    `SELECT * FROM photos WHERE collection_id = ? ORDER BY created_at`
  )
    .bind(row.id)
    .all<PhotoRow>();
  const entries: { name: string; bytes: Uint8Array }[] = [];
  let i = 0;
  for (const photo of photos.results || []) {
    i += 1;
    const obj = await c.env.BUCKET.get(photo.r2_key);
    if (!obj) continue;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const rawName = photo.original_filename || `${photo.id}.jpg`;
    const base = rawName.replace(/[\\/]+/g, "_");
    entries.push({ name: `${String(i).padStart(3, "0")}_${base}`, bytes });
  }
  if (!entries.length) return c.text("No photos", 404);
  const zip = buildZip(entries);
  const fileBase = safeZipBaseName(row.seller_name);
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileBase}_${row.id.slice(0, 8)}.zip"`,
      "cache-control": "private, no-store",
    },
  });
});

app.get("/admin/collections/:id/manifest.json", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<CollectionRow>();
  if (!row) return c.json({ error: "not found" }, 404);
  const photos = await c.env.DB.prepare(`SELECT * FROM photos WHERE collection_id = ?`).bind(row.id).all<PhotoRow>();
  return c.json({
    collectionId: row.id,
    seller_email: row.seller_email,
    seller_name: row.seller_name,
    photos: (photos.results || []).map((p) => ({
      id: p.id,
      filename: p.original_filename,
      url: `/admin/collections/${row.id}/photos/${p.id}`,
      sha256: p.sha256,
    })),
  });
});

app.get("/admin/collections/:id/download.sh", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const idParam = c.req.param("id");
  const origin = new URL(c.req.url).origin;
  const script = `#!/bin/bash
set -euo pipefail
# Run on the Mac while signed into Cloudflare Access in the same browser isn't enough;
# for curl, use a Cloudflare Access service token later, or download from the dashboard.
DIR="$HOME/Desktop/Intake_${idParam}"
mkdir -p "$DIR"
echo "Open ${origin}/admin/collections/${idParam} and save photos, or use wrangler/dev cookies."
echo "Folder: $DIR"
`;
  return new Response(script, {
    headers: { "content-type": "text/x-sh", "content-disposition": `attachment; filename="download-${idParam}.sh"` },
  });
});

/** Alert staff once for collections that never got a full photo set (e.g. waitUntil killed mid-finish). */
async function scanIncompleteCollections(env: Bindings): Promise<void> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT c.id, c.seller_name, c.seller_email, c.photo_count, c.status, c.mac_handoff_status,
            (SELECT COUNT(*) FROM photos p WHERE p.collection_id = c.id) AS stored
     FROM collections c
     WHERE c.created_at < ?
       AND c.status IN ('submitted', 'pricing')
       AND IFNULL(c.mac_handoff_status, '') NOT IN ('failed', 'held')
       AND NOT EXISTS (
         SELECT 1 FROM events e
         WHERE e.collection_id = c.id AND e.type = 'finish_incomplete_alerted'
       )
       AND (
         (c.photo_count >= 1 AND (SELECT COUNT(*) FROM photos p WHERE p.collection_id = c.id) < c.photo_count)
         OR (c.mac_handoff_status = 'delivered' AND (SELECT COUNT(*) FROM photos p WHERE p.collection_id = c.id) < 1)
       )
     ORDER BY c.created_at DESC
     LIMIT 20`
  )
    .bind(cutoff)
    .all<{
      id: string;
      seller_name: string;
      seller_email: string;
      photo_count: number;
      status: string;
      mac_handoff_status: string | null;
      stored: number;
    }>();
  for (const row of rows.results || []) {
    const stored = Number(row.stored || 0);
    if (row.mac_handoff_status === "delivered" && stored < 1) {
      await env.DB.prepare(
        `UPDATE collections SET mac_handoff_status = 'failed', updated_at = ? WHERE id = ?`
      )
        .bind(nowIso(), row.id)
        .run();
    }
    await alertFinishIncomplete(env, {
      collectionId: row.id,
      sellerName: row.seller_name,
      sellerEmail: row.seller_email,
      expected: row.photo_count,
      stored,
      detail: `cron scan: status=${row.status} handoff=${row.mac_handoff_status || "null"}`,
    });
  }
}

async function processQueuedCloudPricing(env: Bindings): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, status FROM collections
     WHERE mac_handoff_status = 'cloud_queued'
     ORDER BY mac_handoff_at ASC
     LIMIT 2`
  ).all<{ id: string; status: string }>();
  for (const row of rows.results || []) {
    // Draft still filling the form: detect-only. Submitted/staff: include Match-window eBay.
    const prefetch_n = row.status === "uploading" ? 0 : CLOUD_PREFETCH_N;
    await runCloudDetectForCollection(env, row.id, "system:cron", { prefetch_n });
  }
}

/* Resume unfinished finishes first, then clean abandoned temps, then alert stuck collections. */
export async function cleanupExpired(env: Bindings) {
  try {
    await processPendingFinishes(env);
  } catch (e) {
    console.error("process_pending_finishes_failed", e);
  }
  try {
    await processQueuedCloudPricing(env);
  } catch (e) {
    console.error("process_queued_cloud_pricing_failed", e);
  }
  try {
    await healStuckCloudJobs(env);
  } catch (e) {
    console.error("heal_stuck_cloud_jobs_failed", e);
  }

  const cutoff = nowIso();
  // Do not wipe in-flight finishes until expires_at (bumped to +3h on claim).
  const sessions = await env.DB.prepare(
    `SELECT id FROM upload_sessions WHERE expires_at < ?`
  )
    .bind(cutoff)
    .all<{ id: string }>();
  for (const s of sessions.results || []) {
    const sess = await env.DB.prepare(
      `SELECT id, collection_id, finish_started_at FROM upload_sessions WHERE id = ?`
    )
      .bind(s.id)
      .first<{ id: string; collection_id: string | null; finish_started_at: string | null }>();
    const photos = await env.DB.prepare(`SELECT r2_key FROM upload_temp_photos WHERE session_id = ?`)
      .bind(s.id)
      .all<{ r2_key: string }>();
    for (const p of photos.results || []) {
      await env.BUCKET.delete(p.r2_key);
    }
    await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE session_id = ?`).bind(s.id).run();
    await env.DB.prepare(`DELETE FROM upload_sessions WHERE id = ?`).bind(s.id).run();
    // Abandoned progressive draft (never submitted): wipe photos + collection.
    if (sess?.collection_id && !sess.finish_started_at) {
      try {
        await purgeAbandonedDraft(env, sess.collection_id);
      } catch (e) {
        console.error("purge_abandoned_draft_failed", e);
      }
    }
  }
  // Orphans = temps with no session left.
  const orphanCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const orphans = await env.DB.prepare(
    `SELECT t.id, t.r2_key FROM upload_temp_photos t
     LEFT JOIN upload_sessions s ON s.id = t.session_id
     WHERE s.id IS NULL AND t.created_at < ?`
  )
    .bind(orphanCutoff)
    .all<{ id: string; r2_key: string }>();
  for (const p of orphans.results || []) {
    try {
      await env.BUCKET.delete(p.r2_key);
    } catch {
      /* ignore */
    }
    await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE id = ?`).bind(p.id).run();
  }
  try {
    await scanIncompleteCollections(env);
  } catch (e) {
    console.error("scan_incomplete_collections_failed", e);
  }
}
