/**
 * COMP-007 — Public competition results types.
 *
 * These types define the EXPLICIT public data boundary for the no-auth
 * competition results dashboard. They intentionally contain ONLY the fields
 * that are safe to show to logged-out visitors:
 *
 *   * competition name / description / location / date / status / challenge
 *   * the qualified participants' public display name + avatar
 *   * the player_profiles.id (only so an existing public player profile can be
 *     linked using the EXISTING public routing pattern /players/[id])
 *   * the winner (from the persisted drawing)
 *
 * They deliberately do NOT contain database ids for events/participants,
 * profiles.id, emails, verification codes, verification tokens, join tokens,
 * attempt data or any private competition-management information. The
 * server-side query in lib/competition-public-server.ts is the only place the
 * public boundary is established — components never receive a raw row.
 */

import type { CompetitionEventStatus } from "@/types";

/**
 * A qualified participant as shown on the public dashboard.
 *
 * `playerProfileId` is the `player_profiles.id` when the participant has a
 * marketplace player profile, otherwise null. It is NEVER a `profiles.id`.
 * When null the participant is still displayed, but is not made clickable.
 */
export interface PublicCompetitionParticipant {
  displayName: string;
  avatarUrl: string | null;
  playerProfileId: string | null;
  /** True for the persisted winner (highlighted on the dashboard). */
  isWinner: boolean;
}

/**
 * A single publicly-visible competition result.
 *
 * This is a server-projected view — it is not a database row.
 */
export interface PublicCompetitionResult {
  name: string;
  description: string | null;
  location: string | null;
  eventDate: string | null;
  status: CompetitionEventStatus;
  challengeName: string;
  /** Number of qualified participants (server-derived, never client). */
  qualifiedCount: number;
  qualifiedParticipants: PublicCompetitionParticipant[];
  /** Whether a persisted drawing exists for this competition. */
  drawn: boolean;
  /** When the drawing was performed (null when not drawn). */
  drawnAt: string | null;
  /**
   * The persisted winner, or null when the drawing has not occurred.
   * Never randomly recalculated and never inferred on the client.
   */
  winner: PublicCompetitionParticipant | null;
}