import type {
  CompetitionEventStatus,
  CompetitionParticipantStatus,
} from "@/types";

/**
 * COMP-001 — Pure (client-safe) competition helpers.
 *
 * These functions contain no I/O and no Supabase access, so they can be
 * imported from both client and server code and unit-tested in isolation.
 * Server-side authorization/data access lives in lib/competition-server.ts.
 */

export const COMPETITION_EVENT_STATUS_VALUES: CompetitionEventStatus[] = [
  "draft",
  "active",
  "drawing",
  "completed",
  "cancelled",
];

export const COMPETITION_PARTICIPANT_STATUS_VALUES: CompetitionParticipantStatus[] =
  ["registered", "challenge_pending", "qualified", "not_qualified"];

/**
 * Narrow an arbitrary string to a CompetitionEventStatus.
 */
export function isCompetitionEventStatus(
  value: unknown,
): value is CompetitionEventStatus {
  return (
    typeof value === "string" &&
    (COMPETITION_EVENT_STATUS_VALUES as string[]).includes(value)
  );
}

/**
 * Narrow an arbitrary string to a CompetitionParticipantStatus.
 */
export function isCompetitionParticipantStatus(
  value: unknown,
): value is CompetitionParticipantStatus {
  return (
    typeof value === "string" &&
    (COMPETITION_PARTICIPANT_STATUS_VALUES as string[]).includes(value)
  );
}

/**
 * A challenge configuration is valid when the name is present and both the
 * threshold and the maximum attempts are positive integers.
 *
 * The challenge configuration is event data (challenge_threshold /
 * max_attempts) — it must never be hard-coded.
 */
export function isValidChallengeConfig(config: {
  challenge_name?: unknown;
  challenge_threshold?: unknown;
  max_attempts?: unknown;
}): boolean {
  const { challenge_name, challenge_threshold, max_attempts } = config;

  return (
    typeof challenge_name === "string" &&
    challenge_name.trim().length > 0 &&
    Number.isInteger(challenge_threshold) &&
    (challenge_threshold as number) > 0 &&
    Number.isInteger(max_attempts) &&
    (max_attempts as number) > 0
  );
}

/**
 * Event-specific qualification outcome. `qualified` / `not_qualified` are
 * terminal for a single event but never affect a profile's ability to join
 * other competitions.
 */
export function isQualified(status: CompetitionParticipantStatus): boolean {
  return status === "qualified";
}

/**
 * COMP-002 — Controlled lifecycle transitions.
 *
 * The lifecycle is intentionally NOT an arbitrary status setter. Only the
 * transitions below are valid:
 *
 *   draft    → active | cancelled
 *   active   → drawing | cancelled
 *   drawing  → active | completed
 *   completed (terminal)
 *   cancelled (terminal)
 *
 * NOTE: COMP-002 does NOT implement winner selection. Moving an event into
 * `drawing` simply prepares it for the future raffle ticket. If later winner
 * integrity requires COMP-007 to own the `drawing → completed` transition,
 * this map is the single, extensible place to change it.
 */
export const COMPETITION_EVENT_TRANSITIONS: Record<
  CompetitionEventStatus,
  CompetitionEventStatus[]
> = {
  draft: ["active", "cancelled"],
  active: ["drawing", "cancelled"],
  drawing: ["completed", "active"],
  completed: [],
  cancelled: [],
};

/**
 * The transitions permitted from a given status. Always returns a new array
 * so callers cannot mutate the underlying transition map.
 */
export function getAllowedEventTransitions(
  from: CompetitionEventStatus,
): CompetitionEventStatus[] {
  return [...(COMPETITION_EVENT_TRANSITIONS[from] ?? [])];
}

/**
 * Whether moving an event from `from` to `to` is a valid lifecycle
 * transition. Rejects self-transitions and unknown/invalid states.
 */
export function isValidEventTransition(
  from: CompetitionEventStatus,
  to: CompetitionEventStatus,
): boolean {
  if (from === to) return false;
  return getAllowedEventTransitions(from).includes(to);
}

/**
 * COMP-002 — Basic event/participant statistics.
 *
 * Pure count derivation so it can be unit-tested without a database. Counts
 * are intentionally simple for MVP; no analytics infrastructure is added.
 */
export interface CompetitionStatistics {
  /** Total participants of any status. */
  total: number;
  /** Participants currently registered / pending their challenge. */
  registered: number;
  /** Participants explicitly awaiting a challenge attempt. */
  challenge_pending: number;
  qualified: number;
  not_qualified: number;
  ambassadors: number;
}

/**
 * Derive the MVP statistics from participant and ambassador rows. The input
 * is deliberately minimal so it works with plain `{ status }` rows.
 */
export function computeCompetitionStatistics(
  participants: { status: CompetitionParticipantStatus }[],
  ambassadors: unknown[] = [],
): CompetitionStatistics {
  const stats: CompetitionStatistics = {
    total: participants.length,
    registered: 0,
    challenge_pending: 0,
    qualified: 0,
    not_qualified: 0,
    ambassadors: ambassadors.length,
  };

  for (const participant of participants) {
    if (participant.status in stats) {
      stats[participant.status] += 1;
    }
  }

  return stats;
}
