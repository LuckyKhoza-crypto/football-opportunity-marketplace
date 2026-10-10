import { isActiveParticipant } from "@/lib/competition";
import type { CompetitionWithdrawalState } from "@/lib/competition-join";

/**
 * T-REM-3 — Pure (client-safe) host/ambassador participant-administration
 * helpers.
 *
 * These functions contain no I/O and no Supabase access, so they can be
 * imported from both client and server code and unit-tested in isolation.
 * Server-side authorization/data access lives in
 * lib/competition-participant-admin-server.ts.
 *
 * Removal and banning are two SEPARATE actions:
 *
 *   * REMOVE (R) — soft-removes an eligible registration. The player stays
 *     eligible to register again later, subject to the competition's rules.
 *   * BAN (B)    — records a durable, COMPETITION-SPECIFIC ban that prevents the
 *     player from registering for THIS competition again. It is not a global
 *     account ban and never expires when a participant is removed.
 *
 * The withdrawal/lifecycle policy is intentionally the SAME one T-REM-2 uses for
 * a player unregistering themselves, so a host and a player can never be held to
 * different rules. The pure rule below is the documented policy; the authoritative
 * enforcement lives in the `remove_competition_participant` RPC (migration 0027)
 * AND the server helpers — never in the UI alone.
 */

/**
 * The `removal_reason` recorded when an authorized manager removes a participant
 * without banning them.
 */
export const COMPETITION_HOST_REMOVAL_REASON = "host_removal";

/**
 * The `removal_reason` recorded when an authorized manager bans a participant
 * (which also removes any still-active registration).
 */
export const COMPETITION_HOST_BAN_REASON = "host_ban";

/**
 * Operator-facing messages for every blocked lifecycle state / server outcome.
 * Kept in one place so the friendly UI copy and the server error mapping can
 * never drift apart.
 */
export const PARTICIPANT_REMOVAL_MESSAGES = {
  eventNotActive: "This competition is not currently accepting participant changes.",
  alreadyRemoved: "This participant has already been removed.",
  checkedIn:
    "This participant has already checked in and can no longer be removed.",
  hasAttempts:
    "This participant has already attempted the challenge and can no longer be removed.",
  providerMapped:
    "This participant has already been added to the external tournament and cannot be removed here.",
  notFound: "Participant not found for this competition.",
  cannotTargetSelf: "You cannot remove or ban yourself.",
  stateChanged:
    "This participant's registration has changed. Please refresh and try again.",
  unauthorized: "Not authorized to manage this competition.",
  missingParams: "A competition and participant are required.",
} as const;

/**
 * T-REM-3 — Host removal/ban eligibility rule.
 *
 * Returns the human-readable reason a participant may NOT be removed (or
 * banned), or `null` when the participant is eligible. It mirrors
 * `getWithdrawalBlockReason` (T-REM-2) exactly — the same five conditions in the
 * same order — because banning an actively registered player removes them, which
 * must obey the identical safe lifecycle. A previously removed participant is
 * still ban-able: they simply have no active registration to release, so the
 * `alreadyRemoved` reason applies to REMOVAL only (the server treats it as a
 * no-op for a ban).
 *
 * It is pure so the UI can explain (and disable) an action before the operator
 * tries it, while the server re-applies the SAME policy authoritatively.
 */
export function getParticipantRemovalBlockReason(
  state: CompetitionWithdrawalState,
): string | null {
  // Mirrors `isEventOpenForRegistration` (only an `active` event mutates its
  // participant list) without importing the node-only join module here.
  if (state.eventStatus !== "active") {
    return PARTICIPANT_REMOVAL_MESSAGES.eventNotActive;
  }

  // Reuse the T-REM-1 active-participant rule rather than re-deriving it.
  if (!isActiveParticipant({ removed_at: state.removedAt ?? null })) {
    return PARTICIPANT_REMOVAL_MESSAGES.alreadyRemoved;
  }

  if (state.checkedInAt != null) {
    return PARTICIPANT_REMOVAL_MESSAGES.checkedIn;
  }

  if (state.hasAttempts) {
    return PARTICIPANT_REMOVAL_MESSAGES.hasAttempts;
  }

  if (state.providerMapped) {
    return PARTICIPANT_REMOVAL_MESSAGES.providerMapped;
  }

  return null;
}
