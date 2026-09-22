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
} from "@/lib/competition-join";
import { isEventManager } from "@/lib/competition-server";
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
 *   5. existing participant returned idempotently.
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
    .select("id, event_id, status, verification_code, checked_in_at, created_at")
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
    created_at: string;
  };

  return {
    participantId: row.id,
    eventId: row.event_id,
    status: row.status,
    verificationCode: row.verification_code,
    checkedInAt: row.checked_in_at,
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
// Re-exports for convenience
// ═══════════════════════════════════════════════════════════════

export type { CompetitionJoinLinkState };