import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  generateJoinToken,
  hashJoinToken,
  getJoinLinkState,
  isEventOpenForRegistration,
  isJoinLinkUsable,
  generateVerificationCode,
  generateVerificationToken,
  hashVerificationToken,
  getWithdrawalBlockReason,
  COMPETITION_SELF_REMOVAL_REASON,
} from "@/lib/competition-join";
import { getCompetitionEvent, isEventManager } from "@/lib/competition-server";
import { isProfileBannedFromEvent } from "@/lib/competition-participant-admin-server";
import type {
  CompetitionEvent,
  CompetitionJoinLink,
  CompetitionJoinLinkState,
  CompetitionPass,
  CompetitionParticipantStatus,
  PublicCompetitionJoin,
} from "@/types";

/**
 * COMP-003 — Server-side competition join-link helpers.
 *
 * Follows the existing `*-server.ts` conventions: `server-only`, service-role
 * client, "return null/false + log" error handling, no thrown errors.
 *
 * Authorization is ALWAYS resolved server-side:
 *   * the manager identity comes from the NextAuth session (caller supplied),
 *   * event/ambassador/profile ids are derived from the join token or the
 *     authenticated session — never trusted from the browser.
 */

// ═══════════════════════════════════════════════════════════════
// Public resolution (join page)
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve a raw join token to public-safe join metadata, hashing the token
 * before lookup. Returns null (never throws) when the token is unknown, so
 * callers cannot distinguish "no such link" from "invalid token".
 */
export async function getCompetitionJoinByToken(
  token: string,
): Promise<PublicCompetitionJoin | null> {
  if (!token) return null;

  const tokenHash = hashJoinToken(token);

  const { data, error } = await supabaseAdmin
    .from("competition_join_links")
    .select(
      `
      id,
      event_id,
      ambassador_id,
      revoked_at,
      event:event_id (
        id,
        name,
        description,
        location,
        event_date,
        status,
        challenge_name,
        challenge_threshold,
        max_attempts
      )
    `,
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as {
    id: string;
    event_id: string;
    ambassador_id: string;
    revoked_at: string | null;
    event: {
      id: string;
      name: string;
      description: string | null;
      location: string | null;
      event_date: string | null;
      status: CompetitionEvent["status"];
      challenge_name: string;
      challenge_threshold: number;
      max_attempts: number;
    } | null;
  };

  if (!row.event) return null;

  const ambassador = await getAmbassadorDisplayName(row.ambassador_id);

  return {
    state: getJoinLinkState({ revoked_at: row.revoked_at }),
    eventOpen: isEventOpenForRegistration(row.event.status),
    // The public payload exposes NO event status/manager identity beyond what
    // a participant needs, and never the token hash or ambassador id.
    event: {
      id: row.event.id,
      name: row.event.name,
      description: row.event.description,
      location: row.event.location,
      event_date: row.event.event_date,
      challenge_name: row.event.challenge_name,
      challenge_threshold: row.event.challenge_threshold,
      max_attempts: row.event.max_attempts,
    },
    ambassador,
  };
}

/**
 * Resolve the public display name of an ambassador relationship, or null.
 * Never returns email or profile ids to the public page.
 */
async function getAmbassadorDisplayName(
  ambassadorId: string,
): Promise<{ full_name: string | null } | null> {
  if (!ambassadorId) return null;

  const { data, error } = await supabaseAdmin
    .from("competition_ambassadors")
    .select("profile:profiles(full_name)")
    .eq("id", ambassadorId)
    .maybeSingle();

  if (error || !data) return null;

  const profile = (data as unknown as { profile: { full_name: string | null } | null })
    .profile;

  if (!profile) return null;
  return { full_name: profile.full_name };
}

// ═══════════════════════════════════════════════════════════════
// Link management (manager)
// ═══════════════════════════════════════════════════════════════

export type CompetitionMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

export interface CreatedJoinLink {
  link: CompetitionJoinLink;
  /** The RAW token — returned exactly once, for the join URL / QR code. */
  token: string;
}

/**
 * Create a reusable join link for an event's ambassador. Authorized ONLY for
 * the event creator/manager. The ambassador relationship is verified to belong
 * to the event — a client can never attach a link to a foreign ambassador.
 *
 * The raw token is generated here and returned once; only its hash is stored.
 */
export async function createCompetitionJoinLink(
  eventId: string,
  managerProfileId: string,
  ambassadorId: string,
): Promise<CompetitionMutationResult<CreatedJoinLink>> {
  if (!eventId || !managerProfileId || !ambassadorId) {
    return {
      ok: false,
      error: "Event, manager and ambassador are required",
      status: 400,
    };
  }

  if (!(await isEventManager(eventId, managerProfileId))) {
    return {
      ok: false,
      error: "Not authorized to manage join links",
      status: 403,
    };
  }

  // The ambassador must belong to THIS event.
  const { data: ambassador, error: ambassadorError } = await supabaseAdmin
    .from("competition_ambassadors")
    .select("id, event_id")
    .eq("id", ambassadorId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (ambassadorError || !ambassador) {
    return {
      ok: false,
      error: "Ambassador not found for this event",
      status: 404,
    };
  }

  const token = generateJoinToken();
  const tokenHash = hashJoinToken(token);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("competition_join_links")
    .insert({
      event_id: eventId,
      ambassador_id: ambassadorId,
      token_hash: tokenHash,
    })
    .select()
    .single();

  if (insertError || !inserted) {
    console.error("createCompetitionJoinLink: insert failed", insertError);
    return { ok: false, error: "Failed to create join link", status: 500 };
  }

  return {
    ok: true,
    data: {
      link: inserted as unknown as CompetitionJoinLink,
      token,
    },
  };
}

/**
 * Revoke a join link. Authorized ONLY for the event creator/manager. Revocation
 * preserves the row (revoked_at = now()) rather than deleting it.
 */
export async function revokeCompetitionJoinLink(
  eventId: string,
  managerProfileId: string,
  linkId: string,
): Promise<CompetitionMutationResult<CompetitionJoinLink>> {
  if (!eventId || !managerProfileId || !linkId) {
    return {
      ok: false,
      error: "Event, manager and link are required",
      status: 400,
    };
  }

  if (!(await isEventManager(eventId, managerProfileId))) {
    return {
      ok: false,
      error: "Not authorized to manage join links",
      status: 403,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("competition_join_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("event_id", eventId)
    .select()
    .maybeSingle();

  if (error) {
    console.error("revokeCompetitionJoinLink: update failed", error);
    return { ok: false, error: "Failed to revoke join link", status: 500 };
  }

  if (!data) {
    return { ok: false, error: "Join link not found", status: 404 };
  }

  return { ok: true, data: data as unknown as CompetitionJoinLink };
}

/**
 * A join link joined with its ambassador identity for the management UI.
 * Never exposes the raw token (which no longer exists after creation).
 */
export interface CompetitionJoinLinkWithAmbassador {
  id: string;
  event_id: string;
  ambassador_id: string;
  revoked_at: string | null;
  created_at: string;
  ambassador: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
}

/**
 * List an event's join links. Callers must verify management authorization
 * before using this.
 */
export async function getCompetitionJoinLinks(
  eventId: string,
): Promise<CompetitionJoinLinkWithAmbassador[]> {
  if (!eventId) return [];

  const { data, error } = await supabaseAdmin
    .from("competition_join_links")
    .select(
      `
      id,
      event_id,
      ambassador_id,
      revoked_at,
      created_at,
      ambassador:ambassador_id (
        id,
        profile:profiles(full_name, email)
      )
    `,
    )
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getCompetitionJoinLinks: query failed", error);
    return [];
  }

  return ((data ?? []) as unknown as {
    id: string;
    event_id: string;
    ambassador_id: string;
    revoked_at: string | null;
    created_at: string;
    ambassador:
      | { id: string; profile: { full_name: string | null; email: string | null } | null }
      | null;
  }[]).map((row) => ({
    id: row.id,
    event_id: row.event_id,
    ambassador_id: row.ambassador_id,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    ambassador: row.ambassador
      ? {
          id: row.ambassador.id,
          full_name: row.ambassador.profile?.full_name ?? null,
          email: row.ambassador.profile?.email ?? null,
        }
      : null,
  }));
}

// ═══════════════════════════════════════════════════════════════
// Registration (participant)
// ═══════════════════════════════════════════════════════════════

export interface RegistrationResult {
  participantId: string;
  eventId: string;
  status: CompetitionParticipantStatus;
  verificationCode: string | null;
  alreadyRegistered: boolean;
}

/**
 * Register the authenticated profile for the event identified by a join token.
 *
 * Server-side checks (never trusting the client):
 *   1. token resolves to a join link,
 *   2. link is not revoked,
 *   3. event is active (accepting registration),
 *   4. event/ambassador derived from the token (never client input),
 *   5. the profile is not banned from THIS competition (T-REM-3),
 *   6. existing participant returned idempotently.
 *
 * Uses the participant's OWN profile id (the authenticated user) — a client can
 * never register another profile, spoof event_id, or assign themselves as an
 * ambassador.
 */
export async function registerForCompetition(
  token: string,
  profileId: string,
): Promise<CompetitionMutationResult<RegistrationResult>> {
  if (!token || !profileId) {
    return { ok: false, error: "A join token is required", status: 400 };
  }

  const tokenHash = hashJoinToken(token);

  const { data: linkData, error: linkError } = await supabaseAdmin
    .from("competition_join_links")
    .select(
      `
      id,
      event_id,
      ambassador_id,
      revoked_at,
      event:event_id ( id, status ),
      ambassador:ambassador_id ( id, event_id )
    `,
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (linkError || !linkData) {
    return { ok: false, error: "This competition link is no longer available.", status: 404 };
  }

  const link = linkData as unknown as {
    id: string;
    event_id: string;
    ambassador_id: string;
    revoked_at: string | null;
    event: { id: string; status: CompetitionEvent["status"] } | null;
    ambassador: { id: string; event_id: string } | null;
  };

  if (!link.event) {
    return { ok: false, error: "This competition link is no longer available.", status: 404 };
  }

  // Defense-in-depth: the link's ambassador must belong to the SAME event.
  // (Also enforced at link-creation time and by the FK, but re-checked here so
  // a malformed row can never register a participant into the wrong event.)
  if (!link.ambassador || link.ambassador.event_id !== link.event_id) {
    return { ok: false, error: "This competition link is no longer available.", status: 404 };
  }

  if (!isJoinLinkUsable({ revoked_at: link.revoked_at })) {
    return { ok: false, error: "This competition link is no longer available.", status: 410 };
  }

  if (!isEventOpenForRegistration(link.event.status)) {
    return {
      ok: false,
      error: "This competition is not currently accepting registrations.",
      status: 409,
    };
  }

  const eventId = link.event_id;

  // T-REM-3: a competition-specific ban is enforced HERE — on the server, before
  // any registration is created. A banned player is rejected even though the
  // link is valid and the event is open, and even if a previous registration was
  // removed. The message never reveals ban-management internals.
  if (await isProfileBannedFromEvent(eventId, profileId)) {
    return {
      ok: false,
      error: "You are not allowed to register for this competition.",
      status: 403,
    };
  }

  // Idempotency: return the existing participant rather than duplicating.
  const { data: existing } = await supabaseAdmin
    .from("competition_participants")
    .select("id, event_id, status, verification_code")
    .eq("event_id", eventId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (existing) {
    const row = existing as unknown as {
      id: string;
      event_id: string;
      status: CompetitionParticipantStatus;
      verification_code: string | null;
    };
    return {
      ok: true,
      data: {
        participantId: row.id,
        eventId: row.event_id,
        status: row.status,
        verificationCode: row.verification_code,
        alreadyRegistered: true,
      },
    };
  }

  const verificationCode = generateVerificationCode();
  const verificationTokenHash = hashVerificationToken(
    generateVerificationToken(),
  );

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("competition_participants")
    .insert({
      event_id: eventId,
      profile_id: profileId,
      // Intended initial status from COMP-001: 'registered'.
      status: "registered",
      verification_code: verificationCode,
      verification_token_hash: verificationTokenHash,
    })
    .select("id, event_id, status, verification_code")
    .single();

  if (insertError || !inserted) {
    // 23505 = unique_violation — a concurrent registration won the race.
    if ((insertError as { code?: string } | null)?.code === "23505") {
      const { data: raced } = await supabaseAdmin
        .from("competition_participants")
        .select("id, event_id, status, verification_code")
        .eq("event_id", eventId)
        .eq("profile_id", profileId)
        .maybeSingle();

      if (raced) {
        const row = raced as unknown as {
          id: string;
          event_id: string;
          status: CompetitionParticipantStatus;
          verification_code: string | null;
        };
        return {
          ok: true,
          data: {
            participantId: row.id,
            eventId: row.event_id,
            status: row.status,
            verificationCode: row.verification_code,
            alreadyRegistered: true,
          },
        };
      }
    }

    console.error("registerForCompetition: insert failed", insertError);
    return { ok: false, error: "Failed to register for competition", status: 500 };
  }

  const row = inserted as unknown as {
    id: string;
    event_id: string;
    status: CompetitionParticipantStatus;
    verification_code: string | null;
  };

  return {
    ok: true,
    data: {
      participantId: row.id,
      eventId: row.event_id,
      status: row.status,
      verificationCode: row.verification_code,
      alreadyRegistered: false,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Participant pass
// ═══════════════════════════════════════════════════════════════

/**
 * Retrieve the authenticated profile's participant pass for an event. Returns
 * null when the profile is not registered. The pass is private to the
 * participant — the caller must have already resolved the profile server-side.
 */
export async function getCompetitionPass(
  eventId: string,
  profileId: string,
): Promise<CompetitionPass | null> {
  if (!eventId || !profileId) return null;

  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .select(
      "id, event_id, status, verification_code, checked_in_at, removed_at, provider_participant_id, created_at",
    )
    .eq("event_id", eventId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as {
    id: string;
    event_id: string;
    status: CompetitionParticipantStatus;
    verification_code: string | null;
    checked_in_at: string | null;
    removed_at: string | null;
    provider_participant_id: string | null;
    created_at: string;
  };

  return {
    participantId: row.id,
    eventId: row.event_id,
    status: row.status,
    verificationCode: row.verification_code,
    checkedInAt: row.checked_in_at,
    // `?? null` keeps a missing column (a row read before migration 0026) active.
    removedAt: row.removed_at ?? null,
    // A boolean only — the provider participant id never leaves the server.
    providerMapped: row.provider_participant_id != null,
    createdAt: row.created_at,
  };
}

/**
 * Whether the given profile already has a participant row for the event.
 * Used by the join page to show the "already registered" experience.
 */
export async function isRegisteredForEvent(
  eventId: string,
  profileId: string,
): Promise<boolean> {
  if (!eventId || !profileId) return false;

  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .select("id")
    .eq("event_id", eventId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

// ═══════════════════════════════════════════════════════════════
// Player self-unregistration (T-REM-2)
// ═══════════════════════════════════════════════════════════════

/**
 * The fields every withdrawal eligibility check needs. Selected EXPLICITLY so a
 * partially-selected participant row can never be mistaken for an active one —
 * `removed_at` in particular must always be present.
 */
const WITHDRAWAL_SELECT =
  "id, event_id, profile_id, status, checked_in_at, provider_participant_id, removed_at, created_at";

export interface WithdrawalResult {
  participantId: string;
  eventId: string;
  /** When the soft removal was recorded. */
  removedAt: string;
}

/**
 * T-REM-2 — a player unregisters THEMSELVES from a competition.
 *
 * The player identity is the authenticated `profileId` supplied by the caller
 * (resolved from the NextAuth session) — never a body-supplied id. This helper:
 *
 *   1. loads the event (its lifecycle status gates withdrawal),
 *   2. loads the caller's OWN registration for that event (explicit select),
 *   3. applies the shared `getWithdrawalBlockReason` rule (event active,
 *      not removed, not checked in, no attempts, not provider-synced),
 *   4. records the soft removal with a CONDITIONAL update whose WHERE clause
 *      re-checks the eligibility (`removed_at`/`checked_in_at`/
 *      `provider_participant_id` all NULL), so a concurrent check-in or
 *      provider sync cannot be silently bypassed between the read and the write.
 *
 * Nothing is deleted: attempts, drawings, check-in data, provider mapping and
 * notifications all survive. A repeat request on an already-removed row returns
 * a clear `409` without touching historical data.
 */
export async function withdrawFromCompetition(
  eventId: string,
  profileId: string,
): Promise<CompetitionMutationResult<WithdrawalResult>> {
  if (!eventId || !profileId) {
    return { ok: false, error: "Event and profile are required", status: 400 };
  }

  const event = await getCompetitionEvent(eventId);
  if (!event) {
    return { ok: false, error: "Competition not found", status: 404 };
  }

  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .select(WITHDRAWAL_SELECT)
    .eq("event_id", eventId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    console.error("withdrawFromCompetition: participant lookup failed", error);
    return {
      ok: false,
      error: "Failed to unregister from this competition",
      status: 500,
    };
  }

  if (!data) {
    return {
      ok: false,
      error: "You are not registered for this competition.",
      status: 404,
    };
  }

  const row = data as unknown as {
    id: string;
    event_id: string;
    profile_id: string;
    status: CompetitionParticipantStatus;
    checked_in_at: string | null;
    provider_participant_id: string | null;
    removed_at: string | null;
    created_at: string;
  };

  // Event / removal / check-in / provider checks share the pure rule with the
  // UI. Attempts need a query, so they are checked separately just below.
  const blockReason = getWithdrawalBlockReason({
    eventStatus: event.status,
    removedAt: row.removed_at,
    checkedInAt: row.checked_in_at,
    hasAttempts: false,
    providerMapped: row.provider_participant_id != null,
  });

  if (blockReason) {
    return { ok: false, error: blockReason, status: 409 };
  }

  // Attempts are historical records and are never deleted, so a participant who
  // has already attempted the challenge can no longer withdraw.
  const { data: attempts, error: attemptError } = await supabaseAdmin
    .from("competition_attempts")
    .select("id")
    .eq("event_id", eventId)
    .eq("participant_id", row.id)
    .limit(1);

  if (attemptError) {
    console.error("withdrawFromCompetition: attempt lookup failed", attemptError);
    return {
      ok: false,
      error: "Failed to unregister from this competition",
      status: 500,
    };
  }

  if (attempts && (attempts as unknown[]).length > 0) {
    return {
      ok: false,
      error: "You have already started the challenge and can no longer unregister.",
      status: 409,
    };
  }

  const removedAt = new Date().toISOString();

  // Conditional (atomic) soft removal. The DB only performs the update when the
  // row is STILL eligible, so a concurrent check-in / provider sync / removal
  // cannot slip past the checks above.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("competition_participants")
    .update({
      removed_at: removedAt,
      removed_by_profile_id: profileId,
      removal_reason: COMPETITION_SELF_REMOVAL_REASON,
    })
    .eq("id", row.id)
    .eq("event_id", eventId)
    .eq("profile_id", profileId)
    .is("removed_at", null)
    .is("checked_in_at", null)
    .is("provider_participant_id", null)
    .select("id, removed_at")
    .maybeSingle();

  if (updateError) {
    console.error("withdrawFromCompetition: update failed", updateError);
    return {
      ok: false,
      error: "Failed to unregister from this competition",
      status: 500,
    };
  }

  if (!updated) {
    // The guard no longer matched: the registration changed between the read and
    // the write (checked in, provider-synced or already removed).
    return {
      ok: false,
      error: "Your registration has changed. Please refresh and try again.",
      status: 409,
    };
  }

  return {
    ok: true,
    data: {
      participantId: row.id,
      eventId,
      removedAt:
        (updated as unknown as { removed_at: string | null }).removed_at ??
        removedAt,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Re-exports for convenience
// ═══════════════════════════════════════════════════════════════

export type { CompetitionJoinLinkState };