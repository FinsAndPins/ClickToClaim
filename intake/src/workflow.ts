import type { Status } from "./types";

export const KANBAN_COLUMNS: { id: Status; label: string }[] = [
  { id: "submitted", label: "Submitted" },
  { id: "pricing", label: "Pricing" },
  { id: "offer_sent", label: "Offer sent" },
  { id: "accepted", label: "Accepted" },
  { id: "paid", label: "Paid" },
  { id: "waiting_for_package", label: "Waiting for package" },
  { id: "received", label: "Received" },
  { id: "done", label: "Done" },
  { id: "declined", label: "Declined" },
  { id: "withdrawn", label: "Withdrawn" },
];

/** Staff-driven status changes (not accept/decline/send-offer). */
const STAFF_NEXT: Partial<Record<Status, Status[]>> = {
  submitted: ["pricing", "withdrawn"],
  pricing: ["submitted", "withdrawn"],
  offer_sent: ["withdrawn"],
  accepted: ["paid", "withdrawn"],
  paid: ["waiting_for_package"],
  waiting_for_package: ["received"],
  received: ["done"],
};

export function staffNextStatuses(current: Status): Status[] {
  return STAFF_NEXT[current] ?? [];
}

export function canStaffMove(from: Status, to: Status): boolean {
  return staffNextStatuses(from).includes(to);
}

export function offerExpired(expiresAt: string | null, now = new Date()): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < now.getTime();
}

export function addDaysIso(days: number, from = new Date()): string {
  const d = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}
