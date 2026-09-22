import type { CompetitionEventStatus } from "@/types";

/**
 * COMP-006 — Pure (client-safe) competition drawing helpers.
 *
 * These functions contain NO I/O and NO Supabase access, so they can be
 * imported from both client and server code and unit-tested in isolation.
 * Server-side authorization, random selection and persistence live in
 * lib/competition-drawing-server.ts (and the start_competition_drawing RPC).
 *
 * The drawing is deliberately simple: an event that is `active` (or already
 * prepared for the drawing) can be drawn exactly once, producing one winner.
 * There is no reroll, weighting or ticket system.
 */

/**
 * Event statuses from which a drawing may be started. `active` is the normal
 * case; `drawing` is tolerated so an event already moved into the prepared
 * state can still be drawn. Every other status (draft, completed, cancelled)
 * is not drawable.
 */
export const COMPETITION_DRAWABLE_STATUSES: CompetitionEventStatus[] = [
  "active",
  "drawing",
];

/**
 * Whether an event is currently in a drawable state. This mirrors the
 * server-side check in the start_competition_drawing RPC — the UI must never
 * be the authorization boundary.
 */
export function isEventDrawable(status: CompetitionEventStatus): boolean {
  return COMPETITION_DRAWABLE_STATUSES.includes(status);
}

/**
 * Human-readable reason a drawing cannot be started for the given status, or
 * null when the status is drawable. Used to explain a disabled drawing action
 * without inventing new statuses.
 */
export function getDrawingUnavailableReason(
  status: CompetitionEventStatus,
): string | null {
  if (isEventDrawable(status)) return null;
  switch (status) {
    case "draft":
      return "Activate the competition before starting the drawing.";
    case "completed":
      return "This competition has already been completed.";
    case "cancelled":
      return "This competition has been cancelled.";
    default:
      return "This competition is not ready for a drawing.";
  }
}