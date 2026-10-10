import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { canManageEvent } from "@/lib/competition-server";
import type { CompetitionMutationResult } from "@/lib/competition-server";
import {
  COMPETITION_HOST_BAN_REASON,
  COMPETITION_HOST_REMOVAL_REASON,
  PARTICIPANT_REMOVAL_MESSAGES,
} from "@/lib/competition-participant-admin";

/**
 * T-REM-3 — Server-side host/ambassador participant removal + banning.
 *
 * Follows the existing `*-server.ts` conventions: `server-only`, service-role
 * client, "discriminated result + log" error handling, no thrown errors.
 *
 * Authorization is ALWAYS resolved server-side: the acting profile id is the
 * authenticated NextAuth profile (caller supplied) and is re-checked with
 * `canManageEvent` (creator OR assigned ambassador) before the atomic RPC runs.
 * The RPC independently re-checks authorization in the database.
 *
 * The heavy lifting (soft removal + optional durable ban, eligibility + provider
 * safety, row locking, idempotent duplicate handling) happens in ONE transaction
 * inside the `remove_competition_participant` RPC, so a ban can never half-apply.
 */

interface RemoveParticipantRpcResult {
  success: boolean;
  error?: string;
  participant_id?: string;
  profile_id?: string;
  removed?: boolean;
  already_removed?: boolean;
  removed_at?: string | null;
  banned?: boolean;
  already_banned?: boolean;
  banned_at?: string | null;
}

export interface ParticipantRemovalResult {
  participantId: string;
  removedAt: string | null;
}

export interface ParticipantBanResult {
  participantId: string;
  /** True when the ban was recorded by THIS call. */
  created: boolean;
  /** True when a ban already existed (a duplicate/idempotent request). */
  alreadyBanned: boolean;
  /** True when this call also soft-removed an active registration. */
  removed: boolean;
  removedAt: string | null;
  bannedAt: string | null;
}

function mapRpcError(
  code: string,
  fallback: string,
): { ok: false; error: string; status: number } {
  switch (code) {
    case "MISSING_PARAMS":
      return { ok: false, error: PARTICIPANT_REMOVAL_MESSAGES.missingParams, status: 400 };
    case "UNAUTHORIZED":
      return { ok: false, error: PARTICIPANT_REMOVAL_MESSAGES.unauthorized, status: 403 };
    case "PARTICIPANT_NOT_FOUND":
      return { ok: false, error: PARTICIPANT_REMOVAL_MESSAGES.notFound, status: 404 };
    case "CANNOT_TARGET_SELF":
      return { ok: false, error: PARTICIPANT_REMOVAL_MESSAGES.cannotTargetSelf, status: 400 };
    case "EVENT_NOT_ACTIVE":
      return { ok: false, error: PARTICIPANT_REMOVAL_MESSAGES.eventNotActive, status: 409 };
    case "PARTICIPANT_CHECKED_IN":
      return { ok: false, error: PARTICIPANT_REMOVAL_MESSAGES.checkedIn, status: 409 };
    case "PARTICIPANT_HAS_ATTEMPTS":
      return { ok: false, error: PARTICIPANT_REMOVAL_MESSAGES.hasAttempts, status: 409 };
    case "PARTICIPANT_PROVIDER_MAPPED":
      return { ok: false, error: PARTICIPANT_REMOVAL_MESSAGES.providerMapped, status: 409 };
    case "PARTICIPANT_STATE_CHANGED":
      return { ok: false, error: PARTICIPANT_REMOVAL_MESSAGES.stateChanged, status: 409 };
    default:
      return { ok: false, error: fallback, status: 500 };
  }
}

/**
 * Whether the given profile is banned from the given competition. Server-only
 * (service role). Used by the registration service before creating a
 * registration — a ban is NEVER enforced by the UI alone.
 *
 * A transient query error is logged and reported as "not banned" (matching the
 * `*-server.ts` "return false + log" convention) so a read failure cannot block
 * every legitimate registration; the ban row itself is the durable source of
 * truth and is unaffected.
 */
export async function isProfileBannedFromEvent(
  eventId: string,
  profileId: string,
): Promise<boolean> {
  if (!eventId || !profileId) return false;

  const { data, error } = await supabaseAdmin
    .from("competition_bans")
    .select("id")
    .eq("event_id", eventId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    console.error("isProfileBannedFromEvent: query failed", error);
    return false;
  }

  return !!data;
}

/**
 * The set of profile ids banned from a competition. Used by the operator
 * participant list to flag banned players. Callers are responsible for
 * verifying management authorization first. Returns an empty array on error.
 */
export async function getBannedProfileIds(
  eventId: string,
): Promise<string[]> {
  if (!eventId) return [];

  const { data, error } = await supabaseAdmin
    .from("competition_bans")
    .select("profile_id")
    .eq("event_id", eventId);

  if (error) {
    console.error("getBannedProfileIds: query failed", error);
    return [];
  }

  return ((data ?? []) as unknown as { profile_id: string }[]).map(
    (row) => row.profile_id,
  );
}

/**
 * T-REM-3 — REMOVE (R): an authorized manager soft-removes an eligible
 * participant from their competition.
 *
 * The participant row (and every historical record — attempts, drawings,
 * check-in/verification history, provider mapping, notifications) is preserved.
 * A normal removal does NOT ban the player: they remain eligible to register
 * again later, subject to the competition's registration rules.
 *
 * Ordering / safety:
 *   1. the acting profile is re-checked via `canManageEvent`,
 *   2. the atomic RPC locks the participant row, verifies it belongs to the
 *      event, applies the shared lifecycle rule (active event, not checked in,
 *      no attempts, not provider-synced) and performs the soft removal,
 *   3. a duplicate request on an already-removed participant returns `409`
 *      without touching any historical data.
 */
export async function removeCompetitionParticipant(
  eventId: string,
  managerProfileId: string,
  participantId: string,
): Promise<CompetitionMutationResult<ParticipantRemovalResult>> {
  if (!eventId || !managerProfileId || !participantId) {
    return {
      ok: false,
      error: PARTICIPANT_REMOVAL_MESSAGES.missingParams,
      status: 400,
    };
  }

  if (!(await canManageEvent(eventId, managerProfileId))) {
    return {
      ok: false,
      error: PARTICIPANT_REMOVAL_MESSAGES.unauthorized,
      status: 403,
    };
  }

  const { data, error } = await supabaseAdmin.rpc(
    "remove_competition_participant",
    {
      p_event_id: eventId,
      p_participant_id: participantId,
      p_actor_profile_id: managerProfileId,
      p_removal_reason: COMPETITION_HOST_REMOVAL_REASON,
      p_ban: false,
      p_ban_reason: null,
    },
  );

  if (error) {
    console.error("removeCompetitionParticipant: rpc failed", error);
    return { ok: false, error: "Failed to remove participant", status: 500 };
  }

  const result = (data ?? {}) as RemoveParticipantRpcResult;
  if (!result.success) {
    return mapRpcError(result.error ?? "", "Failed to remove participant");
  }

  if (result.already_removed) {
    return {
      ok: false,
      error: PARTICIPANT_REMOVAL_MESSAGES.alreadyRemoved,
      status: 409,
    };
  }

  return {
    ok: true,
    data: {
      participantId: result.participant_id ?? participantId,
      removedAt: result.removed_at ?? null,
    },
  };
}

/**
 * T-REM-3 — BAN (B): an authorized manager records a durable,
 * competition-specific ban that prevents the player from registering for THIS
 * competition again.
 *
 * If the player is still actively registered, the ban ALSO removes them from the
 * competition using the SAME lifecycle/provider-safety checks as a normal
 * removal. If that removal is unsafe the whole operation is refused (nothing is
 * written) so there is never a misleading partial result. Banning a previously
 * removed player is always allowed. Duplicate ban requests are idempotent.
 *
 * This is NOT a global account ban — it only affects this competition.
 */
export async function banCompetitionParticipant(
  eventId: string,
  managerProfileId: string,
  participantId: string,
  reason?: string | null,
): Promise<CompetitionMutationResult<ParticipantBanResult>> {
  if (!eventId || !managerProfileId || !participantId) {
    return {
      ok: false,
      error: PARTICIPANT_REMOVAL_MESSAGES.missingParams,
      status: 400,
    };
  }

  if (!(await canManageEvent(eventId, managerProfileId))) {
    return {
      ok: false,
      error: PARTICIPANT_REMOVAL_MESSAGES.unauthorized,
      status: 403,
    };
  }

  const trimmedReason =
    typeof reason === "string" && reason.trim().length > 0
      ? reason.trim()
      : null;

  const { data, error } = await supabaseAdmin.rpc(
    "remove_competition_participant",
    {
      p_event_id: eventId,
      p_participant_id: participantId,
      p_actor_profile_id: managerProfileId,
      p_removal_reason: COMPETITION_HOST_BAN_REASON,
      p_ban: true,
      p_ban_reason: trimmedReason,
    },
  );

  if (error) {
    console.error("banCompetitionParticipant: rpc failed", error);
    return { ok: false, error: "Failed to ban participant", status: 500 };
  }

  const result = (data ?? {}) as RemoveParticipantRpcResult;
  if (!result.success) {
    return mapRpcError(result.error ?? "", "Failed to ban participant");
  }

  return {
    ok: true,
    data: {
      participantId: result.participant_id ?? participantId,
      created: !result.already_banned,
      alreadyBanned: !!result.already_banned,
      removed: !!result.removed,
      removedAt: result.removed_at ?? null,
      bannedAt: result.banned_at ?? null,
    },
  };
}

