import type {
  CompetitionEvent,
  CompetitionParticipant,
  CompetitionParticipantStatus,
} from "@/types";

/**
 * COMP-004 — Pure (client-safe) competition attempt/verification helpers.
 *
 * These functions contain NO I/O and NO Supabase access, so they can be
 * imported from both client and server code and unit-tested in isolation.
 * Server-side authorization/data access lives in
 * lib/competition-attempt-server.ts.
 *
 * Threshold semantics (single source of truth):
 *   The challenge is a LARGER-IS-BETTER metric (repetitions / juggles / score /
 *   distance). An attempt PASSES when its result is GREATER THAN OR EQUAL TO
 *   the event's configured `challenge_threshold`. This matches the existing
 *   public copy "Complete {challenge_threshold} to qualify" introduced in
 *   COMP-003. If a future competition needs a lower-is-better metric (e.g.
 *   time), that is a new, explicit configuration — it is NOT inferred here.
 */

/** Result values are compared against an integer threshold; keep it generic. */
export type AttemptResultValue = number;

/**
 * The absolute magnitude cap for a submitted result. PostgreSQL NUMERIC can
 * hold far larger values, but this keeps accidental/garbage input (e.g. a
 * pasted timestamp or a 1e308) out of the database while never restricting a
 * realistic challenge result (speed, distance, reps, score, time).
 */
export const ATTEMPT_RESULT_ABS_LIMIT = 1_000_000_000_000; // 1e12

// ═══════════════════════════════════════════════════════════════
// Result validation
// ═══════════════════════════════════════════════════════════════

export type AttemptResultParse =
  | { ok: true; value: AttemptResultValue }
  | { ok: false; error: string };

/**
 * Validate and normalise a browser-supplied attempt result.
 *
 * Rejects (server-side authoritative):
 *   * missing / empty / whitespace-only values,
 *   * malformed strings ("abc", "12px"),
 *   * NaN, Infinity and -Infinity,
 *   * values outside the numeric magnitude cap.
 *
 * Accepts any finite number — the direction of "good" is decided separately by
 * meetsChallengeThreshold, never here.
 */
export function parseAttemptResultValue(input: unknown): AttemptResultParse {
  let numeric: number;

  if (typeof input === "number") {
    numeric = input;
  } else if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "A result value is required." };
    }
    // Number() accepts "12", "12.5", "1e3" and correctly rejects "abc"/"12px".
    numeric = Number(trimmed);
  } else {
    return { ok: false, error: "A result value is required." };
  }

  if (Number.isNaN(numeric)) {
    return { ok: false, error: "Enter a valid number." };
  }

  if (!Number.isFinite(numeric)) {
    return { ok: false, error: "Enter a finite number." };
  }

  if (Math.abs(numeric) > ATTEMPT_RESULT_ABS_LIMIT) {
    return { ok: false, error: "That result value is out of range." };
  }

  return { ok: true, value: numeric };
}

// ═══════════════════════════════════════════════════════════════
// Threshold comparison (server-authoritative, pure)
// ═══════════════════════════════════════════════════════════════

/**
 * Whether a result meets the event's configured challenge threshold.
 *
 * Larger-is-better: result >= threshold. Never trust a client-computed
 * `passed` — this pure helper is the single place the outcome is decided and
 * it is only ever called server-side with the event's own threshold.
 */
export function meetsChallengeThreshold(
  resultValue: AttemptResultValue,
  challengeThreshold: number,
): boolean {
  return resultValue >= challengeThreshold;
}

// ═══════════════════════════════════════════════════════════════
// Participant challenge state (derived — pure)
// ═══════════════════════════════════════════════════════════════

/** The minimal attempt shape needed to derive participant state. */
export interface AttemptSummary {
  attempt_number: number;
  result_value: number;
  passed: boolean;
}

/**
 * Everything the organizer UI / participant pass needs to describe a
 * participant's current challenge state, derived purely from data.
 */
export interface ParticipantChallengeState {
  participantId: string;
  eventId: string;
  /** The persisted competition_participants.status value. */
  status: CompetitionParticipantStatus;
  challengeName: string;
  threshold: number;
  maxAttempts: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  /** Highest result recorded so far, or null when no attempts exist. */
  bestResult: number | null;
  /** Most recent attempt's result, or null when no attempts exist. */
  lastResult: number | null;
  /** Whether any recorded attempt met the threshold. */
  passed: boolean;
  /** Attempt number of the first passing attempt, or null. */
  passedOnAttempt: number | null;
  /** Once the threshold is met the challenge is complete — no more attempts. */
  challengeComplete: boolean;
  /** Whether another attempt may currently be recorded. */
  canAttempt: boolean;
}

/**
 * Derive the full challenge state for one participant from the event config
 * and the participant's attempt history.
 *
 * Rules (matching the COMP-004 brief and COMP-001 status model):
 *   * the FIRST passing attempt (lowest attempt_number) marks the participant
 *     qualified and closes the challenge,
 *   * otherwise the participant may attempt until `max_attempts` is reached,
 *   * exhausting attempts without passing yields not_qualified.
 */
export function computeParticipantChallengeState(
  participant: Pick<CompetitionParticipant, "id" | "event_id" | "status">,
  event: Pick<
    CompetitionEvent,
    "challenge_name" | "challenge_threshold" | "max_attempts"
  >,
  attempts: AttemptSummary[],
): ParticipantChallengeState {
  const ordered = [...attempts].sort(
    (a, b) => a.attempt_number - b.attempt_number,
  );

  const attemptsUsed = ordered.length;
  const maxAttempts = Math.max(0, event.max_attempts);
  const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);

  const passingAttempt = ordered.find((a) => a.passed) ?? null;
  const passed = passingAttempt !== null;
  const challengeComplete = passed;

  const canAttempt = !challengeComplete && attemptsRemaining > 0;

  return {
    participantId: participant.id,
    eventId: participant.event_id,
    status: participant.status,
    challengeName: event.challenge_name,
    threshold: event.challenge_threshold,
    maxAttempts,
    attemptsUsed,
    attemptsRemaining,
    bestResult: ordered.length
      ? ordered.reduce((best, a) => Math.max(best, a.result_value), -Infinity)
      : null,
    lastResult: ordered.length ? ordered[ordered.length - 1].result_value : null,
    passed,
    passedOnAttempt: passingAttempt ? passingAttempt.attempt_number : null,
    challengeComplete,
    canAttempt,
  };
}

/**
 * The next 1-based attempt number for a participant (contiguous, server
 * derived). Never trust a browser-supplied attempt number.
 */
export function getNextAttemptNumber(attempts: AttemptSummary[]): number {
  return attempts.reduce((max, a) => Math.max(max, a.attempt_number), 0) + 1;
}

/**
 * Resolve the participant status implied by their attempt history. Used by the
 * server after recording an attempt so the persisted status always reflects
 * reality:
 *
 *   passed                        -> qualified
 *   attempts used >= max_attempts -> not_qualified
 *   at least one attempt          -> challenge_pending
 *   none                          -> registered (unchanged)
 */
export function resolveParticipantStatus(
  currentStatus: CompetitionParticipantStatus,
  attempts: AttemptSummary[],
  maxAttempts: number,
): CompetitionParticipantStatus {
  if (attempts.some((a) => a.passed)) return "qualified";
  if (attempts.length >= maxAttempts) return "not_qualified";
  if (attempts.length > 0) return "challenge_pending";
  return currentStatus === "registered" ? "registered" : "challenge_pending";
}

/**
 * Human-readable status label for the operator UI. Deliberately separate from
 * the persisted enum so the UI can say "Challenge Complete" for a qualified
 * participant without inventing a new database status.
 */
export function getChallengeStateLabel(
  state: Pick<
    ParticipantChallengeState,
    "passed" | "challengeComplete" | "attemptsUsed" | "attemptsRemaining"
  >,
): string {
  if (state.passed) return "Qualified";
  if (state.attemptsRemaining <= 0) return "Not Qualified";
  if (state.attemptsUsed > 0) return "Attempting";
  return "Registered";
}