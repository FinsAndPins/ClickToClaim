import type { Bindings } from "./types";
import { splitEmails } from "./email";

export function isProduction(env: Bindings): boolean {
  return (env.ENVIRONMENT || "").toLowerCase() === "production";
}

export function staffEmailFromRequest(env: Bindings, request: Request): string | null {
  const access = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (access && splitEmails(env.STAFF_EMAILS).includes(access.trim().toLowerCase())) {
    return access.trim().toLowerCase();
  }
  if (!isProduction(env)) {
    const dev = (env.DEV_ADMIN_EMAIL || "").trim().toLowerCase();
    if (dev) return dev;
  }
  return null;
}

export async function requireStaff(
  env: Bindings,
  request: Request
): Promise<{ email: string } | Response> {
  const email = staffEmailFromRequest(env, request);
  if (email) return { email };
  return new Response("Staff only. Sign in with Cloudflare Access.", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** Mac handoff helper: Bearer MAC_HANDOFF_TOKEN (preferred) or staff Access email. */
export async function requireMacOrStaff(
  env: Bindings,
  request: Request
): Promise<{ email: string; via: "mac_token" | "staff" } | Response> {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const token = (env.MAC_HANDOFF_TOKEN || "").trim();
  if (token && m && m[1].trim() === token) {
    return { email: "mac-handoff@local", via: "mac_token" };
  }
  const staff = await requireStaff(env, request);
  if (staff instanceof Response) return staff;
  return { email: staff.email, via: "staff" };
}
