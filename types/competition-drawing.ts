/**
 * COMP-006 — Competition drawing & winner types.
 *
 * Kept in a dedicated module (mirroring types/competition-attempt.ts) so this
 * ticket adds no churn to unrelated type definitions.
 *
 * Design notes:
 *   * A competition_drawing is ONE immutable record of a single drawing and its
 *     SINGLE winner. There is exactly one drawing per event.
 *   * The winner is represented through the existing participant/profile
 *     relationships (winner_participant_id / winner_profile_id). No personal
 *     information is copied into the drawing row.
 *   * The management UI only ever sees display-safe fields (winner name, count,
 *     timestamp) — never profile ids, participant ids or database ids.
 */

/** The raw persisted drawing row (server-internal use). */
export interface CompetitionDrawingRecord {
  id: string;
  event_id: string;
  winner_participant_id: string;
  winner_profile_id: string | null;
  qualified_participant_count: number;
  drawn_by_profile_id: string | null;
  drawn_at: string;
  created_at: string;
}

/**
 * The display-safe drawing result returned to competition managers. Contains
 * ONLY what the result UI needs — never internal database ids, verification
 * tokens or private account data.
 */
export interface CompetitionDrawingView {
  /** Resolved display name of the winning participant (never an id/email). */
  winnerName: string | null;
  /** How many qualified participants were eligible when the drawing ran. */
  qualifiedParticipantCount: number;
  /** When the drawing was performed. */
  drawnAt: string;
}