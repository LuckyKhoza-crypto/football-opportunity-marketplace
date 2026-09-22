import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type {
  PublicCompetitionParticipant,
  PublicCompetitionResult,
} from "@/types/competition-public";
import type { CompetitionEventStatus } from "@/types";

/**
 * COMP-007 — Public competition results (server-only).
 *
 * This module is the SINGLE explicit public data boundary for the no-auth
 * competition results dashboard. It deliberately:
 *
 *   * uses the service-role `supabaseAdmin` client (matching every other
 *     server helper in this app — see lib/competition-server.ts) so that RLS
 *     does NOT need to be loosened on any competition table;
 *   * projects RAW rows down to a small, public-safe view, so sensitive fields
 *     (participant ids, profiles.id, emails, verification codes/tokens, join
 *     tokens, attempt data) are dropped on the SERVER and never reach React;
 *   * answers a fixed, small number of queries (no N-per-competition or
 *     N-per-participant fan-out), so the dashboard stays efficient.
 *
 * It never requires a session: it is pure server-side reading of data that is
 * intentionally public.
 *
 * Qualification is the authoritative, event-specific state created by COMP-004
 * (competition_participants.status = 'qualified'). It is NEVER inferred from
 * attempt counts, highest results, client state or browser-supplied values.
 *
 * The winner is read from the persisted drawing created by COMP-006
 * (competition_drawings). It is NEVER randomly selected again.
 */

interface ProfileJoin {
  full_name: string | null;
  avatar_url: string | null;
}

interface QualifiedParticipantRow {
  event_id: string;
  profile_id: string;
  profile: ProfileJoin | ProfileJoin[] | null;
}

interface PlayerProfileRow {
  id: string;
  user_id: string;
}

interface DrawingRow {
  event_id: string;
  winner_profile_id: string | null;
}

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  event_date: string | null;
  status: CompetitionEventStatus;
  challenge_name: string;
  created_at: string;
}

/** Supabase returns a to-one nested relation as an object; be defensive. */
function pickProfile(
  profile: QualifiedParticipantRow["profile"],
): ProfileJoin | null {
  if (!profile) return null;
  if (Array.isArray(profile)) return profile[0] ?? null;
  return profile;
}

/**
 * Build the public-safe participant entry. Profile / player-profile lookups are
 * supplied by the caller so this stays pure and testable.
 */
function buildParticipant(
  profile: ProfileJoin | null,
  playerProfileId: string | null,
  isWinner: boolean,
): PublicCompetitionParticipant {
  return {
    displayName: profile?.full_name?.trim() || "Player",
    avatarUrl: profile?.avatar_url ?? null,
    playerProfileId,
    isWinner,
  };
}

/**
 * Retrieve all publicly-visible competition results.
 *
 * Ordering is deterministic and done server-side: newest competitions first
 * (created_at desc), with the event id as a stable tie-breaker.
 *
 * Returns an empty list on error (matching the `*-server.ts` convention — no
 * thrown errors).
 */
export async function getPublicCompetitionResults(): Promise<
  PublicCompetitionResult[]
> {
  // 1. All competitions (public metadata only — no created_by).
  const { data: eventsData, error: eventsError } = await supabaseAdmin
    .from("competition_events")
    .select(
      "id, name, description, location, event_date, status, challenge_name, created_at",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });

  if (eventsError) {
    console.error(
      "getPublicCompetitionResults: events query failed",
      eventsError,
    );
    return [];
  }

  const events = (eventsData ?? []) as unknown as EventRow[];
  if (events.length === 0) return [];

  const eventIds = events.map((event) => event.id);

  // 2. Qualified participants for every returned competition, joined with the
  //    public profiles fields (name + avatar). A single query — no fan-out.
  const { data: participantsData, error: participantsError } = await supabaseAdmin
    .from("competition_participants")
    .select("event_id, profile_id, profile:profiles(full_name, avatar_url)")
    .in("event_id", eventIds)
    .eq("status", "qualified")
    .order("created_at", { ascending: true });

  if (participantsError) {
    console.error(
      "getPublicCompetitionResults: participants query failed",
      participantsError,
    );
    return [];
  }

  const participants =
    (participantsData ?? []) as unknown as QualifiedParticipantRow[];
  const profileIds = Array.from(
    new Set(participants.map((row) => row.profile_id)),
  );

  // 3. Which qualified profiles also have a marketplace player profile. The
  //    player_profiles.id is the identifier used by the EXISTING public route
  //    /players/[id] — profiles.id is never exposed to the client.
  const playerProfileByUserId = new Map<string, string>();
  if (profileIds.length > 0) {
    const { data: playerProfilesData, error: playerProfilesError } =
      await supabaseAdmin
        .from("player_profiles")
        .select("id, user_id")
        .in("user_id", profileIds);

    if (playerProfilesError) {
      console.error(
        "getPublicCompetitionResults: player_profiles query failed",
        playerProfilesError,
      );
    } else {
      for (const row of (playerProfilesData ??
        []) as unknown as PlayerProfileRow[]) {
        playerProfileByUserId.set(row.user_id, row.id);
      }
    }
  }

  // 4. Persisted drawings (the source of truth for the winner).
  const { data: drawingsData, error: drawingsError } = await supabaseAdmin
    .from("competition_drawings")
    .select("event_id, winner_profile_id")
    .in("event_id", eventIds);

  if (drawingsError) {
    console.error(
      "getPublicCompetitionResults: drawings query failed",
      drawingsError,
    );
  }
  const drawingByEventId = new Map<string, DrawingRow>();
  for (const row of (drawingsData ?? []) as unknown as DrawingRow[]) {
    drawingByEventId.set(row.event_id, row);
  }

  // 5. Assemble each competition's public result.
  return events.map((event) => {
    const drawing = drawingByEventId.get(event.id) ?? null;
    const winnerProfileId = drawing?.winner_profile_id ?? null;

    const qualifiedParticipants = participants
      .filter((row) => row.event_id === event.id)
      .map((row) => {
        const profile = pickProfile(row.profile);
        const playerProfileId =
          playerProfileByUserId.get(row.profile_id) ?? null;
        return buildParticipant(
          profile,
          playerProfileId,
          winnerProfileId !== null && row.profile_id === winnerProfileId,
        );
      });

    const winner = winnerProfileId
      ? qualifiedParticipants.find((p) => p.isWinner) ?? null
      : null;

    return {
      name: event.name,
      description: event.description,
      location: event.location,
      eventDate: event.event_date,
      status: event.status,
      challengeName: event.challenge_name,
      qualifiedCount: qualifiedParticipants.length,
      qualifiedParticipants,
      drawn: drawing !== null,
      drawnAt: null,
      winner,
    };
  });
}