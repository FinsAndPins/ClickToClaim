/** Dollar helpers. Store money as integer cents. */

export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

export function offerHelpers(harnessTotalCents: number | null) {
  if (harnessTotalCents == null || harnessTotalCents <= 0) return null;
  return {
    total: harnessTotalCents,
    p30: Math.round(harnessTotalCents * 0.3),
    p40: Math.round(harnessTotalCents * 0.4),
    p50: Math.round(harnessTotalCents * 0.5),
    p60: Math.round(harnessTotalCents * 0.6),
  };
}

/** Declined because they wanted a higher price than our offer. */
export function declinedWantedMore(row: {
  decline_wanted_cents?: number | null;
  offer_cents?: number | null;
}): boolean {
  const wanted = row.decline_wanted_cents;
  const offered = row.offer_cents;
  if (wanted == null || wanted <= 0) return false;
  if (offered == null) return true;
  return wanted > offered;
}

/** e.g. offer vs harness total → "42%". */
export function percentOfValue(
  partCents: number | null | undefined,
  totalCents: number | null | undefined
): string {
  if (partCents == null || totalCents == null || totalCents <= 0) return "n/a";
  return `${Math.round((partCents / totalCents) * 100)}%`;
}
