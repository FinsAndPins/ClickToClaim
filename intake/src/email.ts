import type { Bindings } from "./types";

export type OutboundEmail = {
  to: string[];
  subject: string;
  text: string;
};

const NO_REPLY_LINE =
  "Please don’t reply to this email — this inbox isn’t monitored. Use the link in the message if we sent one.";

export async function sendEmail(
  env: Bindings,
  email: OutboundEmail
): Promise<{ sent: boolean; error?: string }> {
  const key = env.RESEND_API_KEY;
  if (!key) {
    return { sent: false, error: "RESEND_API_KEY missing — logged only" };
  }
  const replyTo = (env.NOREPLY_EMAIL || "noreply@finsandpins.shop").trim();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `Fins & Pins <${env.FROM_EMAIL}>`,
      reply_to: replyTo,
      to: email.to,
      subject: email.subject,
      text: email.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { sent: false, error: `resend ${res.status}: ${body.slice(0, 300)}` };
  }
  return { sent: true };
}

export function staffEmails(env: Bindings): string[] {
  return splitEmails(env.STAFF_ALERT_EMAILS);
}

export function splitEmails(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function offerEmail(opts: {
  sellerName: string;
  offerLabel: string;
  link: string;
  days: number;
}): OutboundEmail {
  return {
    to: [],
    subject: "Your Fins & Pins collection offer",
    text: [
      `Hi ${opts.sellerName},`,
      "",
      "Thank you for sending photos of your collection.",
      "",
      `Our offer for everything in the photos you uploaded is ${opts.offerLabel}.`,
      "",
      "This is our best offer — it takes real work to price a collection, and we send the number we'd pay.",
      "",
      `View the offer and accept or decline here (link works for ${opts.days} days):`,
      opts.link,
      "",
      "No pressure either way. If you decline, you can optionally tell us why — we won't use that to haggle.",
      "",
      NO_REPLY_LINE,
      "",
      "— Fins & Pins",
    ].join("\n"),
  };
}

export function readyToPayEmail(opts: {
  collectionId: string;
  sellerName: string;
  sellerEmail: string;
  paypal: string;
  offerLabel: string;
  adminLink: string;
}): OutboundEmail {
  return {
    to: [],
    subject: `Ready to pay — ${opts.sellerName} accepted ${opts.offerLabel}`,
    text: [
      `${opts.sellerName} accepted the offer.`,
      "",
      `Amount: ${opts.offerLabel}`,
      `PayPal G&S: ${opts.paypal}`,
      `Seller email: ${opts.sellerEmail}`,
      `Collection: ${opts.collectionId}`,
      "",
      "Pay in PayPal (manual for v1), then mark Paid on the dashboard.",
      opts.adminLink,
    ].join("\n"),
  };
}

export function moderationAlertEmail(opts: {
  sellerName: string;
  sellerEmail: string;
  paypal: string;
  codes: string[];
  count: number;
}): OutboundEmail {
  return {
    to: [],
    subject: "Intake moderation reject (no image attached)",
    text: [
      "An upload was rejected by automated moderation.",
      "No image was stored.",
      "",
      `Name: ${opts.sellerName}`,
      `Email: ${opts.sellerEmail}`,
      `PayPal G&S: ${opts.paypal}`,
      `Photos attempted: ${opts.count}`,
      `Reason codes: ${opts.codes.join(", ") || "(none)"}`,
    ].join("\n"),
  };
}

export function sellerPhotosRejectedEmail(sellerName: string): OutboundEmail {
  return {
    to: [],
    subject: "We couldn't accept one or more photos",
    text: [
      `Hi ${sellerName},`,
      "",
      "One or more photos didn't pass our automated safety checks, so we could not accept this submission.",
      "Those files were not saved.",
      "",
      "Please try again with photos of pin boards only — a clear picture of the pins, without people or other content. Use the same invite link you were given; don’t reply to this email.",
      "",
      NO_REPLY_LINE,
      "",
      "— Fins & Pins",
    ].join("\n"),
  };
}
