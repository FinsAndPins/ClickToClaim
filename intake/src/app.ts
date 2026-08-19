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
import { centsToDollars, offerHelpers, parseDollarsToCents } from "./money";
import { addDaysIso, canStaffMove, KANBAN_COLUMNS, offerDueLabel, offerExpired, staffNextStatuses } from "./workflow";
import { requireStaff } from "./auth";
import { getCookie, setCookie } from "hono/cookie";
import { INVITE_COOKIE, inviteGateEnabled, presentedInviteMatches } from "./invite";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);

function nowIso() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
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

function adminUrl(env: Bindings, collectionId: string) {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/collections/${collectionId}`;
}

function offerUrl(env: Bindings, token: string) {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/o/${token}`;
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

const OPEN_PATHS = new Set(["/health", "/styles.css", "/invite"]);

app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/admin") || path.startsWith("/o/") || OPEN_PATHS.has(path)) {
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

app.get("/", (c) => {
  const err = c.req.query("err");
  const ok = c.req.query("ok");
  const flash = err
    ? `<div class="flash err">${escapeHtml(err)}</div>`
    : ok
      ? `<div class="flash ok">${escapeHtml(ok)}</div>`
      : "";
  return html(
    c.env,
    "Sell my collection",
    `${flash}
    <h1>Sell your pin collection</h1>
    <p class="lede">We pay reasonable prices for authentic Disney pins. Upload photos of the boards you want to sell. We’ll email <strong>one best offer</strong> for everything in those photos, usually within <strong>24 hours</strong>. It takes real work to price a collection — that’s why we ask for PayPal Goods &amp; Services details up front, and why this isn’t a free appraisal.</p>
    <div class="card">
      <form id="start" method="post" action="/api/submissions">
        <label>Name<input required name="seller_name" autocomplete="name" /></label>
        <label>Email<input required type="email" name="seller_email" autocomplete="email" /></label>
        <p class="hint">We’ll send the offer to the address you type here. Please use the link in that message to accept or decline — we don’t negotiate by email or in DMs.</p>
        <label>PayPal Goods &amp; Services email<input required type="email" name="paypal_gs_email" /></label>
        <p class="hint">Required so we can pay you if you accept. We pay via PayPal G&amp;S after you accept, before you ship. You pay postage to us in Florida.</p>
        <label>Instagram <span class="hint">(optional)</span><input name="instagram" placeholder="@you" /></label>
        <label class="agree">
          <input required type="checkbox" name="agree" value="yes" />
          <span>I agree to the <a href="/privacy">privacy notice and terms</a>. I understand photos are checked by automated content moderation. Rejected files are not stored. If we buy the collection, we may keep board photos and pin crops for our research.</span>
        </label>
        <button type="submit">Continue to photos</button>
      </form>
    </div>`
  );
});

app.get("/privacy", (c) => {
  return html(
    c.env,
    "Privacy & terms",
    `<h1>Privacy &amp; terms</h1>
    <div class="card legal">
      <p>Fins &amp; Pins buys authentic Disney pin collections. This site is an offer to purchase, not a free pricing tool. There is no minimum number of pins or photos.</p>
      <h2>What you submit</h2>
      <p>Name, email, PayPal Goods &amp; Services email, optional Instagram, and photos of the pins you want to sell.</p>
      <h2>Content moderation</h2>
      <p>Every photo is checked by automated safety filters before we keep it. If a photo fails, it is deleted immediately and never stored. We may notify ourselves with your name, email, and a reason code — not the image — so we know a submission was blocked.</p>
      <h2>What we keep</h2>
      <p>Photos that pass moderation may be kept as board originals and as cropped pin images. Crops are kept for future research and training. Board originals are kept for now; we may later delete originals after a set period, after we receive a collection, or after an offer is declined.</p>
      <h2>Offers</h2>
      <p>We aim to send one total offer within 24 hours of a complete submission. That offer is for everything in the photos you uploaded. You can accept or decline in the link we send. Declining is fine — no pressure. Please don’t reply to offer emails; we don’t negotiate by email. If you share why you declined, we use that to learn, not to haggle.</p>
      <h2>Shipping &amp; payment</h2>
      <p>If you accept, we pay PayPal Goods &amp; Services, then you ship to us in Florida using your own postage. We show our ship-to address after you accept.</p>
      <p>We can buy from outside the United States when you pay all shipping, PayPal Goods &amp; Services is available for the payment, and we can legally receive the package. International PayPal protection is not always the same as a U.S. domestic payment — if G&amp;S isn’t available in your country, we can’t complete a purchase. Import duties into the U.S., if any, are not something we can promise in advance.</p>
      <h2>How we contact you</h2>
      <p>We only email about your offer, using the address you enter. Use the link in that email to accept or decline. We don’t publish a contact address on this site and we don’t monitor replies.</p>
    </div>`
  );
});

app.post("/api/submissions", async (c) => {
  const form = await c.req.parseBody();
  const seller_name = String(form.seller_name || "").trim();
  const seller_email = String(form.seller_email || "").trim().toLowerCase();
  const paypal_gs_email = String(form.paypal_gs_email || "").trim().toLowerCase();
  const instagram = String(form.instagram || "").trim() || null;
  const agree = String(form.agree || "") === "yes";
  if (!agree || !seller_name || !seller_email || !paypal_gs_email) {
    return c.redirect("/?err=" + encodeURIComponent("Please fill name, email, PayPal, and agree to the terms."));
  }
  const sessionId = id();
  const created = nowIso();
  const exp = new Date(Date.now() + 40 * 60 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO upload_sessions (id, seller_name, seller_email, paypal_gs_email, instagram, accepted_terms_at, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(sessionId, seller_name, seller_email, paypal_gs_email, instagram, created, created, exp)
    .run();
  await logEvent(c.env.DB, null, seller_email, "session_started", { sessionId });
  return c.redirect(`/upload/${sessionId}`);
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
    <p class="lede">No minimum count. Up to ${maxPhotos} photos, ${Math.round(maxBytes / 1024 / 1024)}&nbsp;MB each. We’ll check each photo with automated safety filters before anything is saved.</p>
    <div class="card">
      <h2>How to shoot a board</h2>
      <ul class="legal">
        <li>One board (or one clear group of pins) per photo.</li>
        <li>Fill the frame with the pins. Straight-on is better than a steep angle.</li>
        <li>Use even light. Avoid heavy glare on cellophane if you can.</li>
        <li>Don’t include people, faces, or anything that isn’t the pins.</li>
        <li>JPEG is safest on iPhone: Settings → Camera → Most Compatible.</li>
      </ul>
      <input id="files" type="file" accept="image/*" multiple />
      <p class="hint">On iPhone you can pick from Photos. Upload starts when you tap Submit.</p>
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
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');
          }
          status.textContent = 'Checking photos… this can take a minute.';
          const fin = await fetch('/api/submissions/' + sessionId + '/finish', { method: 'POST' });
          const data = await fin.json();
          if (!fin.ok) throw new Error(data.error || 'Could not finish');
          location.href = '/thanks';
        } catch (e) {
          status.textContent = e.message || String(e);
          go.disabled = false;
        }
      };
    </script>`
  );
});

app.post("/api/submissions/:sessionId/photos", async (c) => {
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
  await c.env.BUCKET.put(key, bytes, {
    httpMetadata: { contentType: file.type || "image/jpeg" },
    customMetadata: {
      sessionId,
      temp: "1",
      originalFilename: file.name.slice(0, 180),
    },
  });
  await c.env.DB.prepare(
    `INSERT INTO upload_temp_photos (id, session_id, r2_key, original_filename, content_type, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(photoId, sessionId, key, file.name, file.type || "image/jpeg", file.size, nowIso())
    .run();
  return c.json({ ok: true, photoId });
});

app.post("/api/submissions/:sessionId/finish", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = await c.env.DB.prepare(
    `SELECT * FROM upload_sessions WHERE id = ?`
  )
    .bind(sessionId)
    .first<{
      id: string;
      seller_name: string;
      seller_email: string;
      paypal_gs_email: string;
      instagram: string | null;
      accepted_terms_at: string;
    }>();
  if (!session) return c.json({ error: "Session not found" }, 404);

  const temps = await c.env.DB.prepare(
    `SELECT * FROM upload_temp_photos WHERE session_id = ?`
  )
    .bind(sessionId)
    .all<{
      id: string;
      r2_key: string;
      original_filename: string | null;
      content_type: string | null;
      size_bytes: number | null;
    }>();
  const photos = temps.results || [];
  if (!photos.length) return c.json({ error: "Please upload at least one photo" }, 400);

  if (c.env.ENVIRONMENT === "production" && !hasModerationProvider(c.env)) {
    return c.json({ error: "Uploads are paused until content moderation is configured." }, 503);
  }

  const failedCodes: string[] = [];
  for (const p of photos) {
    const obj = await c.env.BUCKET.get(p.r2_key);
    if (!obj) {
      failedCodes.push("missing_temp_object");
      break;
    }
    const buf = await obj.arrayBuffer();
    const result = await moderateImage(c.env, buf, p.content_type || "image/jpeg");
    if (!result.ok) {
      failedCodes.push(...result.codes);
      break;
    }
  }

  if (failedCodes.length) {
    for (const p of photos) {
      await c.env.BUCKET.delete(p.r2_key);
    }
    await c.env.DB.prepare(`DELETE FROM upload_temp_photos WHERE session_id = ?`).bind(sessionId).run();
    await c.env.DB.prepare(`DELETE FROM upload_sessions WHERE id = ?`).bind(sessionId).run();
    const alertId = id();
    await c.env.DB.prepare(
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
    await logEvent(c.env.DB, null, "system", "moderation_rejected", {
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
    staff.to = staffEmails(c.env);
    const s1 = await sendEmail(c.env, staff);
    const seller = sellerPhotosRejectedEmail(session.seller_name);
    seller.to = [session.seller_email];
    const s2 = await sendEmail(c.env, seller);
    await logEvent(c.env.DB, null, "system", "moderation_emails", { staff: s1, seller: s2 });
    return c.json(
      {
        error:
          "One or more photos couldn't be accepted. They were not saved. Please try again with board photos only.",
      },
      400
    );
  }

  const collectionId = id();
  const created = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO collections (
      id, status, seller_name, seller_email, paypal_gs_email, instagram, accepted_terms_at,
      photo_count, created_at, updated_at
    ) VALUES (?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      collectionId,
      session.seller_name,
      session.seller_email,
      session.paypal_gs_email,
      session.instagram,
      session.accepted_terms_at,
      photos.length,
      created,
      created
    )
    .run();

  let cover: string | null = null;
  for (const p of photos) {
    const obj = await c.env.BUCKET.get(p.r2_key);
    if (!obj) continue;
    const buf = await obj.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const destKey = `o_${p.id}`;
    await c.env.BUCKET.put(destKey, buf, {
      httpMetadata: { contentType: p.content_type || "image/jpeg" },
      customMetadata: {
        collectionId,
        sellerEmail: session.seller_email,
        photoId: p.id,
        kind: "original",
        timestamp: created,
        sha256: sha,
      },
    });
    await c.env.BUCKET.delete(p.r2_key);
    await c.env.DB.prepare(
      `INSERT INTO photos (id, collection_id, kind, r2_key, original_filename, content_type, size_bytes, sha256, moderation_status, created_at)
       VALUES (?, ?, 'original', ?, ?, ?, ?, ?, 'passed', ?)`
    )
      .bind(
        p.id,
        collectionId,
        destKey,
        p.original_filename,
        p.content_type,
        p.size_bytes,
        sha,
        created
      )
      .run();
    if (!cover) cover = p.id;
  }
  if (cover) {
    await c.env.DB.prepare(`UPDATE collections SET cover_photo_id = ? WHERE id = ?`).bind(cover, collectionId).run();
  }
  await c.env.DB.prepare(`DELETE FROM upload_temp_photos WHERE session_id = ?`).bind(sessionId).run();
  await c.env.DB.prepare(`DELETE FROM upload_sessions WHERE id = ?`).bind(sessionId).run();
  await logEvent(c.env.DB, collectionId, session.seller_email, "submitted", { photo_count: photos.length });
  return c.json({ ok: true, collectionId });
});

app.get("/thanks", (c) => {
  return html(
    c.env,
    "Thanks",
    `<h1>We have your photos</h1>
    <div class="card">
      <p>Thanks — we’ll email our best offer to the address you gave, usually within 24 hours. No pressure if it’s not a fit.</p>
      <p class="hint">Use the link in that email to accept or decline. Please don’t reply to the message; we don’t negotiate by email.</p>
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
      `<h1>Offer declined</h1><div class="card"><p>Thanks for letting us know. No pressure — we kept a record in case you want to talk later, but this link can’t accept anymore.</p></div>`
    );
  }
  if (row.status === "accepted" || row.status === "paid" || row.status === "waiting_for_package" || row.status === "received" || row.status === "done") {
    const ship =
      row.status === "accepted" || row.status === "paid" || row.status === "waiting_for_package" || row.status === "received" || row.status === "done"
        ? `<h2>Ship to</h2><p><strong>${escapeHtml(c.env.SHIP_TO_NAME)}</strong><br>${escapeHtml(c.env.SHIP_TO_ADDRESS).replace(/\n/g, "<br>")}</p>
           <p class="hint">Please use your own postage (USPS, UPS, or your local carrier). International sellers: you pay all shipping to Florida. We pay via PayPal Goods &amp; Services after you accept.</p>`
        : "";
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
      <div class="card"><p>No pressure — if you’d still like to sell, email us and we can reissue the same offer without starting pricing over.</p></div>`
    );
  }
  return html(
    c.env,
    "Your offer",
    `<h1>Your offer</h1>
    <div class="card">
      <p>This is our best offer for <strong>everything in the photos you uploaded</strong>.</p>
      <div class="offer-amt">${escapeHtml(amount)}</div>
      <form method="post" action="/o/${encodeURIComponent(row.offer_token!)}/accept" onsubmit="return confirm('Accept this offer of ${escapeHtml(amount)}?');">
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
  const updated = nowIso();
  await c.env.DB.prepare(`UPDATE collections SET status = 'accepted', updated_at = ? WHERE id = ?`)
    .bind(updated, row.id)
    .run();
  await logEvent(c.env.DB, row.id, row.seller_email, "accepted", { offer_cents: row.offer_cents });
  const mail = readyToPayEmail({
    collectionId: row.id,
    sellerName: row.seller_name,
    sellerEmail: row.seller_email,
    paypal: row.paypal_gs_email,
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
      <p>Totally fine. If you want, tell us why — optional, and we won’t use it to negotiate.</p>
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
    const cards = (byStatus.get(col.id) || [])
      .map((r) => {
        const img = r.cover_photo_id
          ? `<img src="/admin/collections/${r.id}/photos/${r.cover_photo_id}" alt="" />`
          : "";
        const offer = r.offer_cents != null ? escapeHtml(centsToDollars(r.offer_cents)) : "No offer yet";
        const due = offerDueLabel(r.created_at, r.status);
        const dueHtml = due ? `<div class="meta">${escapeHtml(due)}</div>` : "";
        return `<a class="mini" href="/admin/collections/${r.id}">${img}<div class="who">${escapeHtml(r.seller_name)}</div><div class="meta">${escapeHtml(offer)} · ${r.photo_count} photos</div>${dueHtml}</a>`;
      })
      .join("");
    return `<section class="col"><h3>${escapeHtml(col.label)} (${(byStatus.get(col.id) || []).length})</h3>${cards || `<p class="hint">Empty</p>`}</section>`;
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
    : `<p class="hint">Paste overlay URL + harness total after Mac pricing.</p>`;
  const cover = row.cover_photo_id
    ? `<img class="cover" src="/admin/collections/${row.id}/photos/${row.cover_photo_id}" alt="Cover" />`
    : "";
  const overlay = row.overlay_url
    ? `<p><a class="btn" href="${escapeHtml(row.overlay_url)}" target="_blank" rel="noopener">Open pricing overlay</a></p>`
    : "";
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
    <h1>${escapeHtml(row.seller_name)}</h1>
    <p class="lede">${escapeHtml(row.status.replace(/_/g, " "))} · ${escapeHtml(row.seller_email)} · PayPal ${escapeHtml(row.paypal_gs_email)}
    ${row.instagram ? " · " + escapeHtml(row.instagram) : ""}</p>
    <div class="card">
      <h2>Internal (seller never sees this)</h2>
      ${helperHtml}
      ${overlay}
      <form method="post" action="/admin/collections/${row.id}/overlay">
        <label>Pricing overlay URL<input name="overlay_url" value="${escapeHtml(row.overlay_url || "")}" placeholder="https://…" /></label>
        <label>Harness total (dollars, no pin count shown to seller)<input name="harness_total" value="${row.harness_total_cents != null ? String(row.harness_total_cents / 100) : ""}" inputmode="decimal" /></label>
        <button type="submit">Save overlay / total</button>
      </form>
      <form method="post" action="/admin/collections/${row.id}/note">
        <label>Private note<textarea name="note">${escapeHtml(row.internal_note || "")}</textarea></label>
        <button type="submit">Save note</button>
      </form>
    </div>
    <div class="card">
      <h2>Offer</h2>
      <p>${row.offer_cents != null ? escapeHtml(centsToDollars(row.offer_cents)) : "None yet"}
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
      <form method="post" action="/admin/collections/${row.id}/tracking" style="margin-top:12px">
        <label>Tracking (optional)<input name="tracking" value="${escapeHtml(row.tracking || "")}" /></label>
        <button class="secondary" type="submit">Save tracking</button>
      </form>
    </div>
    <div class="card">
      <h2>Photos (${row.photo_count})</h2>
      <p><a href="/admin/collections/${row.id}/manifest.json">Download manifest</a> — on the Mac, run the download script in intake/scripts.</p>
      <div class="photo-grid">${photoGrid}</div>
    </div>
    ${
      row.decline_reason || row.decline_wanted_cents || row.decline_detail
        ? `<div class="card"><h2>Decline feedback</h2>
           <p>Reason: ${escapeHtml(row.decline_reason || "—")}<br>
           Wanted: ${row.decline_wanted_cents != null ? escapeHtml(centsToDollars(row.decline_wanted_cents)) : "—"}<br>
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
  const url = String(form.overlay_url || "").trim() || null;
  const total = parseDollarsToCents(String(form.harness_total || "")) ;
  await c.env.DB.prepare(
    `UPDATE collections SET overlay_url = ?, harness_total_cents = ?, updated_at = ? WHERE id = ?`
  )
    .bind(url, total, nowIso(), c.req.param("id"))
    .run();
  await logEvent(c.env.DB, c.req.param("id"), staff.email, "overlay_saved", { url, total });
  return c.redirect(`/admin/collections/${c.req.param("id")}`);
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
# Run on the Mac while signed into Cloudflare Access in the same browser isn't enough —
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
}
