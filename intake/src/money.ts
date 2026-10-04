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

/** Percent of harness value. n/a if we have no total. */
export function percentOfValue(partCents: number | null | undefined, valueCents: number | null | undefined): string {
  if (partCents == null || valueCents == null || valueCents <= 0) return "n/a";
  return `${Math.round((partCents / valueCents) * 100)}%`;
}

export function declinedWantedMore(row: {
  status: string;
  offer_cents: number | null;
  decline_wanted_cents: number | null;
}): boolean {
  return (
    row.status === "declined" &&
    row.decline_wanted_cents != null &&
    row.offer_cents != null &&
    row.decline_wanted_cents > row.offer_cents
  );
}
