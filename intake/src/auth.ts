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
