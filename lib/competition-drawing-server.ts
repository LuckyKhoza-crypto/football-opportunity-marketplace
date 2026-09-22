import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  canManageEvent,
  getCompetitionEvent,
  type CompetitionMutationResult,
} from "@/lib/competition-server";
import type { CompetitionDrawingView } from "@/types/competition-drawing";

/**
 * COMP-006 — Server-side competition drawing helpers.
 *
 * Conventions (matching lib/competition-server.ts / competition-attempt-server.ts):
 * `server-only`, service-role client, discriminated-result error handling, no
 * thrown errors.
 *
 * The drawing is a single, atomic, server-authoritative operation. The random
 * selection and the write happen INSIDE the `start_competition_drawing`
 * SECURITY DEFINER RPC (migration 0020), so the browser can never:
 *   * choose the winner,
 *   * submit a qualified participant id,
 *   * submit the qualified participant count,
 *   * start two drawings (UNIQUE(event_id) + row lock guarantee one winner).
 *
 * Authorization is the shared `canManageEvent` rule (event CREATOR or assigned
 * AMBASSADOR), re-checked server-side. It is NEVER derived from profiles.role.
 */

/** Shape returned by the start_competition_drawing RPC. */
interface StartDrawingRpcResult {
  success: boolean;
  error?: string;
  drawing_id?: string;
  winner_participant_id?: string;
  winner_profile_id?: string | null;
  qualified_participant_count?: number;
  drawn_at?: string;
  drawn_by_profile_id?: string;
}

/** Map an RPC error code to a user-safe message + HTTP status. */
function mapDrawingRpcError(error: string | undefined): {
  ok: false;
  error: string;
  status: number;
} {
  switch (error) {
    case "EVENT_NOT_FOUND":
      return { ok: false, error: "Competition not found", status: 404 };
    case "UNAUTHORIZED":
      return {
        ok: false,
        error: "Not authorized to start the drawing for this competition",
        status: 403,
      };
    case "DRAWING_ALREADY_EXISTS":
      return {
        ok: false,
        error: "A drawing has already been completed for this competition.",
        status: 409,
      };
    case "EVENT_NOT_DRAWABLE":
      return {
        ok: false,
        error: "This competition is not in a state that can be drawn.",
        status: 409,
      };
    case "NO_QUALIFIED_PARTICIPANTS":
      return {
        ok: false,
        error: "No qualified participants are eligible for the drawing.",
        status: 409,
      };
    default:
      return { ok: false, error: "Failed to start the drawing", status: 500 };
  }
}

/**
 * Count the participants who have successfully qualified for an event
 * (status = 'qualified'). This is the server-side eligibility set for the
 * drawing — it is never derived from client-supplied values.
 */
export async function getQualifiedParticipantCount(
  eventId: string,
): Promise<number> {
  if (!eventId) return 0;

  const { count, error } = await supabaseAdmin
    .from("competition_participants")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("status", "qualified");

  if (error) {
    console.error("getQualifiedParticipantCount: query failed", error);
    return 0;
  }

  return count ?? 0;
}

/** Resolve a participant's display name from a profiles.id (name only). */
async function resolveProfileDisplayName(
  profileId: string | null,
): Promise<string | null> {
  if (!profileId) return null;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", profileId)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { full_name: string | null }).full_name ?? null;
}

/**
 * Retrieve the drawing result for an event in a display-safe shape.
 *
 * Authorized for the event creator OR an assigned ambassador (else null).
 * Returns only the winner's display name, the qualified participant count and
 * the timestamp — never a database id, token, or private account data.
 */
export async function getCompetitionDrawing(
  eventId: string,
  viewerProfileId: string,
): Promise<CompetitionDrawingView | null> {
  if (!eventId || !viewerProfileId) return null;
  if (!(await canManageEvent(eventId, viewerProfileId))) return null;

  const { data, error } = await supabaseAdmin
    .from("competition_drawings")
    .select(
      "id, event_id, winner_profile_id, qualified_participant_count, drawn_at",
    )
    .eq("event_id", eventId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as {
    winner_profile_id: string | null;
    qualified_participant_count: number;
    drawn_at: string;
  };

  const winnerName = await resolveProfileDisplayName(row.winner_profile_id);

  return {
    winnerName,
    qualifiedParticipantCount: row.qualified_participant_count,
    drawnAt: row.drawn_at,
  };
}

/**
 * Start the competition drawing. This is the ONLY way a drawing is created.
 *
 * Atomicity: the server helper re-checks management authorization, then runs
 * the `start_competition_drawing` RPC, which in ONE transaction locks the
 * event row, re-checks authorization + status, rejects an existing drawing,
 * counts the qualified participants, selects ONE at random and persists the
 * result. Two concurrent requests therefore produce exactly one drawing.
 */
export async function startCompetitionDrawing(
  eventId: string,
  profileId: string,
): Promise<CompetitionMutationResult<CompetitionDrawingView>> {
  if (!eventId || !profileId) {
    return { ok: false, error: "Event and profile are required", status: 400 };
  }

  if (!(await canManageEvent(eventId, profileId))) {
    return {
      ok: false,
      error: "Not authorized to start the drawing for this competition",
      status: 403,
    };
  }

  const event = await getCompetitionEvent(eventId);
  if (!event) {
    return { ok: false, error: "Competition not found", status: 404 };
  }

  // Friendly, server-side eligibility pre-check. The RPC independently
  // enforces this (atomicity), so this is purely for a clearer early error.
  const qualifiedCount = await getQualifiedParticipantCount(eventId);
  if (qualifiedCount === 0) {
    return {
      ok: false,
      error: "No qualified participants are eligible for the drawing.",
      status: 409,
    };
  }

  const { data, error } = await supabaseAdmin.rpc("start_competition_drawing", {
    p_event_id: eventId,
    p_user_id: profileId,
  });

  if (error) {
    console.error("startCompetitionDrawing: rpc failed", error);
    return { ok: false, error: "Failed to start the drawing", status: 500 };
  }

  const result = (data ?? {}) as StartDrawingRpcResult;
  if (!result.success) {
    return mapDrawingRpcError(result.error);
  }

  // Build the display-safe view from the RPC result (resolve the winner name).
  const winnerName = await resolveProfileDisplayName(
    result.winner_profile_id ?? null,
  );

  return {
    ok: true,
    data: {
      winnerName,
      qualifiedParticipantCount: result.qualified_participant_count ?? qualifiedCount,
      drawnAt: result.drawn_at ?? new Date().toISOString(),
    },
  };
}