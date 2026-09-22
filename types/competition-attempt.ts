import type { CompetitionParticipantStatus } from "@/types";

/**
 * COMP-004 — Competition attempt & participant-verification types.
 *
 * Kept in a dedicated module (re-exported from the competition section of the
 * wider type surface where needed) so this ticket adds no churn to unrelated
 * type definitions.
 *
 * Design notes:
 *   * A competition_attempt is ONE physical challenge attempt. The result is
 *     intentionally generic (NUMERIC) — no soccer/juggle unit is baked in.
 *   * `passed` is ALWAYS determined server-side by comparing result_value
 *     against the event's configured challenge_threshold. The browser can
 *     never supply it.
 *   * attempt_number is server-assigned, 1-based and unique per participant.
 */

export interface CompetitionAttempt {
  id: string;
  event_id: string;
  participant_id: string;
  /** Server-assigned, 1-based, contiguous per participant. */
  attempt_number: number;
  result_value: number;
  /** Decided server-side from result_value vs the event threshold. */
  passed: boolean;
  /** profiles.id of the operator (event creator) who recorded it. */
  recorded_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Derived, read-only challenge summary for a participant. Shared by the
 * organizer UI and the participant pass so both describe state identically.
 */
export interface ParticipantChallengeSummary {
  attemptsUsed: number;
  attemptsRemaining: number;
  bestResult: number | null;
  lastResult: number | null;
  passed: boolean;
  challengeComplete: boolean;
  canAttempt: boolean;
}

/**
 * A participant joined with their display identity and derived challenge state
 * for the organizer's participant-management screen. Contains only what an
 * operator needs — never the wider user database. Account identifiers
 * (profiles.id, email) are deliberately omitted: an operator needs to find and
 * run a participant, not their account.
 */
export interface CompetitionParticipantWithState {
  /** competition_participants.id — required to verify/record attempts. */
  id: string;
  event_id: string;
  status: CompetitionParticipantStatus;
  checked_in_at: string | null;
  created_at: string;
  /** Display name only — never an account id or email. */
  profile: {
    full_name: string | null;
  } | null;
  /** Organizer-visible verification code (safe for the event operator). */
  verificationCode: string | null;
  attemptsUsed: number;
  attemptsRemaining: number;
  bestResult: number | null;
  lastResult: number | null;
  passed: boolean;
  challengeComplete: boolean;
  canAttempt: boolean;
}

/**
 * The result of a server-side verification lookup: a participant resolved from
 * an organizer-supplied verification credential. Deliberately returns only the
 * fields the operator UI needs — never raw profile/participant/event ids that
 * could be replayed elsewhere.
 */
export interface VerifiedCompetitionParticipant {
  participantId: string;
  eventId: string;
  status: CompetitionParticipantStatus;
  verificationCode: string | null;
  displayName: string | null;
  attemptsUsed: number;
  attemptsRemaining: number;
  bestResult: number | null;
  lastResult: number | null;
  passed: boolean;
  challengeComplete: boolean;
  canAttempt: boolean;
}