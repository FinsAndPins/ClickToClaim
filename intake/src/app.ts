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
} from "./email";
import { centsToDollars, declinedWantedMore, offerHelpers, parseDollarsToCents, percentOfValue } from "./money";
import { addDaysIso, canStaffMove, KANBAN_COLUMNS, offerDueLabel, offerExpired, staffNextStatuses } from "./workflow";
import { requireStaff, requireMacOrStaff } from "./auth";
import { getCookie, setCookie } from "hono/cookie";
import { INVITE_COOKIE, inviteGateEnabled, presentedInviteMatches } from "./invite";
import { buildZip, safeZipBaseName } from "./zip";
import { folderNameFromSeller, reencodeToJpeg } from "./reencode";

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
  finish_started_at?: string | null;
};

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

/** Runs after the seller already saw Thanks. Never queues Mac handoff until moderation passes. */
async function processSubmissionBackground(
  env: Bindings,
  session: UploadSessionSnap,
  photos: TempPhotoSnap[]
): Promise<void> {
  try {
    const failedCodes: string[] = [];
    for (const p of photos) {
      const obj = await env.BUCKET.get(p.r2_key);
      if (!obj) {
        failedCodes.push("missing_temp_object");
        break;
      }
      const buf = await obj.arrayBuffer();
      const result = await moderateImage(env, buf, p.content_type || "image/jpeg");
      if (!result.ok) {
        failedCodes.push(...result.codes);
        break;
      }
    }

    if (failedCodes.length) {
      await rejectModerationAndNotify(env, session, photos, failedCodes);
      return;
    }

    const collectionId = id();
    const created = nowIso();
    await env.DB.prepare(
      `INSERT INTO collections (
        id, status, seller_name, seller_email, paypal_gs_email, instagram, accepted_terms_at,
        asking_cents, seller_notes, delivery_method, photo_count, created_at, updated_at
      ) VALUES (?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        created,
        created
      )
      .run();

    let cover: string | null = null;
    for (const p of photos) {
      const obj = await env.BUCKET.get(p.r2_key);
      if (!obj) continue;
      const buf = await obj.arrayBuffer();
      const re = await reencodeToJpeg(buf, p.content_type || "image/jpeg", p.original_filename);
      const storeBytes = re.ok ? re.bytes : new Uint8Array(buf);
      const storeType = re.ok ? re.contentType : p.content_type || "image/jpeg";
      const storeName = re.ok ? re.filename : p.original_filename;
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
          reencoded: re.ok ? "jpeg" : "passthrough",
          reencode_reason: re.ok ? "" : asciiMeta(re.reason || "", 80),
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
      if (!cover) cover = p.id;
    }
    if (cover) {
      await env.DB.prepare(`UPDATE collections SET cover_photo_id = ? WHERE id = ?`)
        .bind(cover, collectionId)
        .run();
    }
    await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE session_id = ?`).bind(session.id).run();
    await env.DB.prepare(`DELETE FROM upload_sessions WHERE id = ?`).bind(session.id).run();
    await logEvent(env.DB, collectionId, session.seller_email, "submitted", {
      photo_count: photos.length,
      async_moderation: true,
      has_seller_notes: Boolean(session.seller_notes),
    });
    await queueMacHandoff(
      env.DB,
      { id: collectionId, seller_name: session.seller_name, status: "submitted" },
      session.seller_email,
      { auto: true }
    );
  } catch (e) {
    await logEvent(env.DB, null, "system", "async_finish_error", {
      session_id: session.id,
      seller_email: session.seller_email,
      error: String(e).slice(0, 300),
    });
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

/** Queue for the Mac intake helper (does not touch NamedCollections / BoardsToPrice). */
async function queueMacHandoff(
  db: D1Database,
  row: { id: string; seller_name: string; status: string },
  actor: string,
  extra?: { auto?: boolean }
): Promise<string> {
  const folder = folderNameFromSeller(row.seller_name, row.id);
  const updated = nowIso();
  await db
    .prepare(
      `UPDATE collections SET mac_handoff_status = 'queued', mac_handoff_folder = ?, mac_handoff_at = ?, updated_at = ? WHERE id = ?`
    )
    .bind(folder, updated, updated, row.id)
    .run();
  if (row.status === "submitted") {
    await db
      .prepare(`UPDATE collections SET status = 'pricing', updated_at = ? WHERE id = ?`)
      .bind(updated, row.id)
      .run();
  }
  await logEvent(db, row.id, actor, "mac_handoff_queued", {
    folder,
    auto: extra?.auto === true,
  });
  return folder;
}

function adminUrl(env: Bindings, collectionId: string) {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/collections/${collectionId}`;
}

function offerUrl(env: Bindings, token: string) {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/o/${token}`;
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
 */
async function pullHarnessTotalFromFirebase(overlayUrl: string): Promise<{
  ok: true;
  totalCents: number;
  priced: number;
  pinCount: number;
  testRunId: string;
} | { ok: false; error: string }> {
  const finalName = preparingInventoryFinalName(overlayUrl);
  if (!finalName) {
    return { ok: false, error: "Could not read the PriceCollection name from the overlay link." };
  }
  const uiDataUrl = `https://finsandpins.github.io/PreparingInventory/${finalName}/testing_ui_visual_baseline/ui_data.json`;
  let ui: {
    test_run_id?: string;
    approach_id?: string;
    global_pin_count?: number;
  };
  try {
    const res = await fetch(uiDataUrl);
    if (!res.ok) {
      return { ok: false, error: `Could not load harness ui_data.json (HTTP ${res.status}).` };
    }
    ui = (await res.json()) as typeof ui;
  } catch {
    return { ok: false, error: "Could not load harness ui_data.json from GitHub Pages." };
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
  return {
    seller_name: strField(raw.seller_name),
    seller_email: strField(raw.seller_email).toLowerCase(),
    instagram: strField(raw.instagram) || null,
    asking_cents: parseDollarsToCents(strField(raw.asking)),
    delivery_method: strField(raw.delivery) || strField(raw.delivery_method),
    seller_notes: notes ? notes.slice(0, 2000) : null,
    agree,
  };
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
    path.startsWith("/api/mac/") ||
    OPEN_PATHS.has(path)
  ) {
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
    service: "intake",
    moderation: hasModerationProvider(c.env)
      ? "configured"
      : c.env.ENVIRONMENT === "development"
        ? "dev_pass"
        : "missing",
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
  return res;
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
      <form id="contactForm">
        <fieldset class="contact-fields" id="contactFields" disabled>
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
    <script src="/seller-home.js"></script>`
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
      <p>We only email about your offer, using the address you enter. Use the link in that email to accept or decline.</p>
    </div>`
  );
});

app.post("/api/upload-sessions", async (c) => {
  try {
    const sessionId = id();
    const created = nowIso();
    const exp = new Date(Date.now() + 40 * 60 * 1000).toISOString();
    await c.env.DB.prepare(
      `INSERT INTO upload_sessions (id, seller_name, seller_email, paypal_gs_email, instagram, asking_cents, delivery_method, accepted_terms_at, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(sessionId, "", "", "", null, null, null, created, created, exp)
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
    const asking_cents = parseDollarsToCents(String(form.asking || ""));
    const delivery = String(form.delivery || "").trim();
    const agree = String(form.agree || "") === "yes";
    const deliveryOk = delivery === "ship_us" || delivery === "dropoff_florida";
    if (!agree || !seller_name || !seller_email || asking_cents == null || !deliveryOk) {
      return c.redirect(
        "/?err=" +
          encodeURIComponent(
            "Please fill name, email, your price, how you'll get the pins to us, and the privacy box."
          )
      );
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
          status.textContent = 'Done. Opening thank-you page…';
          location.href = '/thanks';
        } catch (e) {
          status.textContent = (e && e.message) ? e.message : String(e);
          go.disabled = false;
        }
      };
    </script>`
  );
});

app.post("/api/submissions/:sessionId/photos", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const session = await c.env.DB.prepare(`SELECT * FROM upload_sessions WHERE id = ?`).bind(sessionId).first();
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
    const asking_cents = ident.asking_cents ?? session.asking_cents;
    const delivery_method = ident.delivery_method || session.delivery_method;
    const seller_notes = ident.seller_notes || session.seller_notes;
    const deliveryOk = delivery_method === "ship_us" || delivery_method === "dropoff_florida";
    const agree = ident.agree || Boolean(session.seller_email && session.accepted_terms_at);
    if (!seller_name || !seller_email || asking_cents == null || !deliveryOk || !agree) {
      return c.json(
        { error: "Please fill name, email, your price, how you'll get the pins to us, and the privacy box." },
        400
      );
    }

    const temps = await c.env.DB.prepare(
      `SELECT * FROM upload_temp_photos WHERE session_id = ?`
    )
      .bind(sessionId)
      .all<TempPhotoSnap>();
    const photos = temps.results || [];
    if (!photos.length) return c.json({ error: "Please upload at least one photo" }, 400);

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
      return c.json({ ok: true, accepted: true });
    }
    const claimedAt = nowIso();
    try {
      const claim = await c.env.DB.prepare(
        `UPDATE upload_sessions SET
          seller_name = ?, seller_email = ?, paypal_gs_email = ?, instagram = ?,
          asking_cents = ?, seller_notes = ?, delivery_method = ?, accepted_terms_at = ?,
          finish_started_at = ?
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
          sessionId
        )
        .run();
      if (!claim.meta.changes) {
        return c.json({ ok: true, accepted: true });
      }
    } catch (claimErr) {
      console.error("finish_claim_failed", claimErr);
      return c.json({ error: "Could not finish. Please try again." }, 500);
    }

    // Thanks must return before moderation. Never await processSubmissionBackground here.
    const background = processSubmissionBackground(c.env, snap, photos);
    let scheduled = false;
    try {
      // Accessing the getter can throw on some Hono/Workers paths; keep it inside try.
      const ctx = (c as { executionCtx?: ExecutionContext }).executionCtx;
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(background);
        scheduled = true;
      }
    } catch (err) {
      console.error("waitUntil_failed", err);
    }
    if (!scheduled) {
      // Isolate may freeze after the response without waitUntil; still attempt best-effort.
      background.catch((err) => console.error("async_finish_unawaited", err));
    }

    return c.json({ ok: true, accepted: true });
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
      <p>Thanks. We’ll email our best offer to the address you gave, usually within 24 hours. No pressure if it’s not a fit.</p>
      <p class="hint">We still run a quick automated safety check in the background. If a photo doesn’t pass, we’ll email you and those files are not kept. Use the link in the offer email to accept or decline.</p>
    </div>`
  );
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
      <form method="post" action="/o/${encodeURIComponent(row.offer_token!)}/accept">
        <label>PayPal Goods &amp; Services email<input required type="email" name="paypal_gs_email" value="${escapeHtml(row.paypal_gs_email || row.seller_email)}" autocomplete="email" /></label>
        <p class="hint">We pay this address after you accept, before you ${
          row.delivery_method === "dropoff_florida" ? "drop off" : "ship"
        }.</p>
        <button type="submit">Accept</button>
      </form>
      <form method="get" action="/o/${encodeURIComponent(row.offer_token!)}/decline" style="margin-top:12px">
        <button class="secondary" type="submit">Decline</button>
      </form>
      <p class="hint">The link works until ${escapeHtml(row.offer_expires_at || "")}. You can reopen it until then. No reminders, no pressure.</p>
    </div>`
  );
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
  const overlayBlock = row.overlay_url
    ? `<p><a class="btn" href="${escapeHtml(row.overlay_url)}" target="_blank" rel="noopener">Open pricing overlay</a></p>
       <p class="hint">Linked automatically when Named Collections finishes publishing.</p>`
    : `<p class="hint">Pricing overlay button appears here automatically after Named Collections publishes the harness. No paste step.</p>`;
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
  return html(
    c.env,
    row.seller_name,
    `${cover}
    ${flash}
    <h1>${escapeHtml(row.seller_name)}</h1>
    <p class="lede">${escapeHtml(row.status.replace(/_/g, " "))} · ${escapeHtml(row.seller_email)} · PayPal ${escapeHtml(row.paypal_gs_email)}
    ${row.instagram ? " · " + escapeHtml(row.instagram) : ""}
    ${
      row.delivery_method === "dropoff_florida"
        ? " · Drop off in Florida"
        : row.delivery_method === "ship_us"
          ? " · Ship within US"
          : ""
    }</p>
    <div class="card">
      <h2>Internal (seller never sees this)</h2>
      ${overlayBlock}
      ${helperHtml}
      <div class="row" style="margin-top:12px">
        <form method="post" action="/admin/collections/${row.id}/pull-harness-total">
          <button type="submit" ${row.overlay_url ? "" : "disabled"}>Pull total from Firebase</button>
        </form>
      </div>
      <p class="hint">Pull after Lexi finishes CTM Match / CTP / manual prices. Uses Firebase display_price values (not the first-pass pipeline estimate).</p>
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
      <form method="post" action="/admin/collections/${row.id}/send-to-ctp" style="margin-top:14px">
        <button type="submit">${row.mac_handoff_status === "queued" || row.mac_handoff_status === "delivered" ? "Re-queue CollectionsToPrice" : "Send to CollectionsToPrice"}</button>
      </form>
      <form method="post" action="/admin/collections/${row.id}/hold-ctp" style="margin-top:8px">
        <button class="secondary" type="submit">Hold / don't price</button>
      </form>
      <p class="hint">New uploads auto-queue after the seller confirmation screen (Vision pass). Use Hold to skip pricing. Re-queue if the Mac helper was down. Folder: seller name from the form plus a short id. Does not change the CollectionsToPrice watcher.
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
  if (!row.overlay_url) {
    return c.redirect(
      `/admin/collections/${row.id}?err=` +
        encodeURIComponent("Open-pricing link is not set yet. Wait for Named Collections to finish, then try again.")
    );
  }
  const pulled = await pullHarnessTotalFromFirebase(row.overlay_url);
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

app.post("/admin/collections/:id/send-to-ctp", async (c) => {
  const staff = await requireStaff(c.env, c.req.raw);
  if (staff instanceof Response) return staff;
  const row = await c.env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<CollectionRow>();
  if (!row) return c.redirect("/admin");
  await queueMacHandoff(c.env.DB, row, staff.email);
  return c.redirect(`/admin/collections/${row.id}`);
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
  const body = (await c.req.json().catch(() => ({}))) as { folder?: string; error?: string };
  const updated = nowIso();
  if (body.error) {
    await c.env.DB.prepare(
      `UPDATE collections SET mac_handoff_status = 'failed', mac_handoff_at = ?, updated_at = ? WHERE id = ?`
    )
      .bind(updated, updated, c.req.param("id"))
      .run();
    await logEvent(c.env.DB, c.req.param("id"), auth.email, "mac_handoff_failed", { error: body.error });
    return c.json({ ok: false });
  }
  await c.env.DB.prepare(
    `UPDATE collections SET mac_handoff_status = 'delivered', mac_handoff_folder = COALESCE(?, mac_handoff_folder), mac_handoff_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(body.folder || null, updated, updated, c.req.param("id"))
    .run();
  await logEvent(c.env.DB, c.req.param("id"), auth.email, "mac_handoff_delivered", {
    folder: body.folder || null,
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

/* cleanup abandoned temp uploads */
export async function cleanupExpired(env: Bindings) {
  const cutoff = nowIso();
  const sessions = await env.DB.prepare(`SELECT id FROM upload_sessions WHERE expires_at < ?`)
    .bind(cutoff)
    .all<{ id: string }>();
  for (const s of sessions.results || []) {
    const photos = await env.DB.prepare(`SELECT r2_key FROM upload_temp_photos WHERE session_id = ?`)
      .bind(s.id)
      .all<{ r2_key: string }>();
    for (const p of photos.results || []) {
      await env.BUCKET.delete(p.r2_key);
    }
    await env.DB.prepare(`DELETE FROM upload_temp_photos WHERE session_id = ?`).bind(s.id).run();
    await env.DB.prepare(`DELETE FROM upload_sessions WHERE id = ?`).bind(s.id).run();
  }
  // Finish claims the session before background moderation. Orphans = temps with no session left.
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
}
