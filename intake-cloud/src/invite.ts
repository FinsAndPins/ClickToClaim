const COOKIE = "fp_invite";

export function inviteCode(env: { INVITE_CODE?: string; ENVIRONMENT?: string }): string {
  return (env.INVITE_CODE || "").trim();
}

/** Production is invite-only even if someone forgets to set a code (site stays closed). */
export function inviteGateEnabled(env: { INVITE_CODE?: string; ENVIRONMENT?: string }): boolean {
  if ((env.ENVIRONMENT || "").toLowerCase() === "production") return true;
  return Boolean(inviteCode(env));
}

export function presentedInviteMatches(
  env: { INVITE_CODE?: string; ENVIRONMENT?: string },
  presented: string | undefined
): boolean {
  const expected = inviteCode(env);
  if (!inviteGateEnabled(env)) return true;
  if (!expected) return false;
  return Boolean(presented && presented === expected);
}

export { COOKIE as INVITE_COOKIE };
