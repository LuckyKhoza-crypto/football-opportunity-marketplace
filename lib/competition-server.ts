import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  computeCompetitionStatistics,
  isCompetitionEventStatus,
  isValidEventTransition,
  type CompetitionStatistics,
} from "@/lib/competition";
import type {
  CompetitionAmbassador,
  CompetitionAmbassadorWithProfile,
  CompetitionEvent,
  CompetitionEventStatus,
  CompetitionParticipant,
} from "@/types";

/**
 * COMP-001 — Server-side competition helpers.
 *
 * These helpers provide the small, shared authorization/data-access
 * foundation that future competition tickets (join flow, ambassador
 * dashboard, challenge verification, raffle) will build on. They follow
 * the existing `*-server.ts` conventions: `server-only`, service-role
 * client, "return null/false + log" error handling, no thrown errors.
 *
 * IMPORTANT: Being an ambassador is a competition-specific authorization
 * relationship (competition_ambassadors) — it is NEVER derived from
 * profiles.role. A user may be a player, a team manager, or have no
 * marketplace profile at all and still be an event ambassador.
 */

/**
 * Resolve the authenticated profile id (profiles.id) from the NextAuth
 * session. Returns null when there is no authenticated session.
 *
 * This is the single source of identity for competition server code — it
 * uses the existing auth system and does NOT require marketplace onboarding.
 */
export async function getAuthenticatedProfileId(): Promise<string | null> {
  try {
    const session = await getServerSession(authOptions);
    return session?.user?.id ?? null;
  } catch (err) {
    console.error("getAuthenticatedProfileId: session lookup failed", err);
    return null;
  }
}

/**
 * COMP-007 — Temporary competition-creation authorization.
 *
 * Only the authenticated profile whose id exactly equals the server-only
 * environment variable `MULTI_TEAM_ADMIN_USER_ID` may create competitions.
 *
 * This is a capability, NOT a marketplace role: it is intentionally NOT
 * derived from profiles.role, and it is NEVER exposed to the browser (no
 * NEXT_PUBLIC_* variable is used).
 *
 * Fails CLOSED: when the environment variable is missing/empty the answer is
 * always false, so competition creation never becomes available to everyone.
 *
 * This restricts competition CREATION only. It does not affect ambassador
 * operational permissions (managing assigned events, verifying participants,
 * recording attempts, starting the drawing) — those remain unchanged.
 */
export function isCompetitionCreationAdmin(
  profileId: string | null | undefined,
): boolean {
  if (!profileId) return false;
  const adminUserId = process.env.MULTI_TEAM_ADMIN_USER_ID;
  if (!adminUserId) return false;
  return profileId === adminUserId;
}

/**
 * Retrieve a competition event by id. Returns null when not found or on
 * error.
 */
export async function getCompetitionEvent(
  eventId: string,
): Promise<CompetitionEvent | null> {
  if (!eventId) return null;

  const { data, error } = await supabaseAdmin
    .from("competition_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (error || !data) return null;

  return data as unknown as CompetitionEvent;
}

/**
 * Verify that the given profile is the authoritative manager/creator of
 * the event. Ownership is always checked server-side against
 * competition_events.created_by — a client-provided value is never trusted.
 */
export async function isEventManager(
  eventId: string,
  profileId: string,
): Promise<boolean> {
  if (!eventId || !profileId) return false;

  const { data, error } = await supabaseAdmin
    .from("competition_events")
    .select("id")
    .eq("id", eventId)
    .eq("created_by", profileId)
    .maybeSingle();

  if (error) {
    console.error("isEventManager: query failed", error);
    return false;
  }

  return !!data;
}

/**
 * Verify that the given profile is an ambassador for the event. Ambassador
 * authorization comes ONLY from competition_ambassadors — never from
 * profiles.role.
 */
export async function isEventAmbassador(
  eventId: string,
  profileId: string,
): Promise<boolean> {
  if (!eventId || !profileId) return false;

  const { data, error } = await supabaseAdmin
    .from("competition_ambassadors")
    .select("id")
    .eq("event_id", eventId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    console.error("isEventAmbassador: query failed", error);
    return false;
  }

  return !!data;
}

/**
 * Verify that the given profile may manage the event — either as the
 * creator or as an authorized ambassador.
 */
export async function canManageEvent(
  eventId: string,
  profileId: string,
): Promise<boolean> {
  if (!eventId || !profileId) return false;

  if (await isEventManager(eventId, profileId)) return true;
  return isEventAmbassador(eventId, profileId);
}

/**
 * Retrieve a participant record for a specific event/profile. Because the
 * database enforces UNIQUE(event_id, profile_id), at most one row exists.
 * Returns null when the profile is not registered for the event.
 */
export async function getCompetitionParticipant(
  eventId: string,
  profileId: string,
): Promise<CompetitionParticipant | null> {
  if (!eventId || !profileId) return null;

  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .select("*")
    .eq("event_id", eventId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error || !data) return null;

  return data as unknown as CompetitionParticipant;
}

/**
 * List the participants of an event. This helper is server-only and is
 * intended for management/ambassador views; callers are responsible for
 * verifying authorization via canManageEvent before using it.
 */
export async function getCompetitionParticipants(
  eventId: string,
): Promise<CompetitionParticipant[]> {
  if (!eventId) return [];

  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getCompetitionParticipants: query failed", error);
    return [];
  }

  return (data ?? []) as unknown as CompetitionParticipant[];
}

/**
 * List the ambassadors of an event. Callers are responsible for verifying
 * management authorization before using this.
 */
export async function getCompetitionAmbassadors(
  eventId: string,
): Promise<CompetitionAmbassador[]> {
  if (!eventId) return [];

  const { data, error } = await supabaseAdmin
    .from("competition_ambassadors")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getCompetitionAmbassadors: query failed", error);
    return [];
  }

  return (data ?? []) as unknown as CompetitionAmbassador[];
}

export interface CreateCompetitionEventInput {
  name: string;
  description?: string | null;
  location?: string | null;
  event_date?: string | null;
  challenge_name: string;
  challenge_threshold: number;
  max_attempts: number;
}

/**
 * Create a competition event. The authoritative `created_by` is taken from
 * the authenticated profile — never from client input.
 *
 * Returns the created event, or null on error.
 */
export async function createCompetitionEvent(
  input: CreateCompetitionEventInput,
  profileId: string,
): Promise<CompetitionEvent | null> {
  if (!profileId) return null;

  // COMP-007: only the configured MULTI_TEAM_ADMIN_USER_ID may create a
  // competition. This is the authoritative, fail-closed server-side check
  // protecting the actual creation operation — hiding a button is never
  // sufficient, and this is never derived from profiles.role.
  if (!isCompetitionCreationAdmin(profileId)) {
    console.warn(
      "createCompetitionEvent: rejected — caller is not authorized to create competitions",
    );
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("competition_events")
    .insert({
      name: input.name,
      description: input.description ?? null,
      location: input.location ?? null,
      event_date: input.event_date ?? null,
      challenge_name: input.challenge_name,
      challenge_threshold: input.challenge_threshold,
      max_attempts: input.max_attempts,
      created_by: profileId,
    })
    .select()
    .single();

  if (error || !data) {
    console.error("createCompetitionEvent: insert failed", error);
    return null;
  }

  return data as unknown as CompetitionEvent;
}

// ═══════════════════════════════════════════════════════════════
// COMP-002 — Competition management (events, lifecycle, ambassadors)
// ═══════════════════════════════════════════════════════════════

/**
 * Discriminated result used by COMP-002 mutation helpers. Keeps server code
 * free of thrown errors (matching the existing `*-server.ts` convention) while
 * still letting the API layer map outcomes to the correct HTTP status.
 */
export type CompetitionMutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

/**
 * The role a profile holds on a given event:
 *  - "manager"    → the creator (competition_events.created_by)
 *  - "ambassador" → authorized via competition_ambassadors
 *  - null         → neither
 *
 * This is the single place the manager/ambassador distinction is resolved so
 * every UI/route derives permissions from one server-side source of truth.
 */
export async function getCompetitionViewerRole(
  eventId: string,
  profileId: string,
): Promise<"manager" | "ambassador" | null> {
  if (!eventId || !profileId) return null;
  if (await isEventManager(eventId, profileId)) return "manager";
  if (await isEventAmbassador(eventId, profileId)) return "ambassador";
  return null;
}

/**
 * List the events created (and therefore managed) by the given profile.
 * Returns an empty list on error.
 */
export async function listManagedCompetitionEvents(
  profileId: string,
): Promise<CompetitionEvent[]> {
  if (!profileId) return [];

  const { data, error } = await supabaseAdmin
    .from("competition_events")
    .select("*")
    .eq("created_by", profileId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("listManagedCompetitionEvents: query failed", error);
    return [];
  }

  return (data ?? []) as unknown as CompetitionEvent[];
}

/**
 * List the events the given profile is an ambassador for. Ambassador access
 * comes exclusively from competition_ambassadors.
 */
export async function listAmbassadorCompetitionEvents(
  profileId: string,
): Promise<CompetitionEvent[]> {
  if (!profileId) return [];

  const { data, error } = await supabaseAdmin
    .from("competition_ambassadors")
    .select("event:competition_events(*)")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("listAmbassadorCompetitionEvents: query failed", error);
    return [];
  }

  return ((data ?? []) as unknown as { event: CompetitionEvent | null }[])
    .map((row) => row.event)
    .filter((event): event is CompetitionEvent => !!event);
}

/**
 * Retrieve basic event statistics (simple counts — no analytics layer).
 * Works gracefully when there are zero participants or ambassadors.
 */
export async function getCompetitionStatistics(
  eventId: string,
): Promise<CompetitionStatistics> {
  if (!eventId) return computeCompetitionStatistics([], []);

  const [participants, ambassadors] = await Promise.all([
    getCompetitionParticipants(eventId),
    getCompetitionAmbassadors(eventId),
  ]);

  return computeCompetitionStatistics(participants, ambassadors);
}

export interface UpdateCompetitionEventInput {
  name?: string;
  description?: string | null;
  location?: string | null;
  event_date?: string | null;
  challenge_name?: string;
  challenge_threshold?: number;
  max_attempts?: number;
}

/**
 * Update core event configuration. Authorized ONLY for the event creator —
 * being an ambassador is never sufficient to change event configuration.
 */
export async function updateCompetitionEvent(
  eventId: string,
  profileId: string,
  input: UpdateCompetitionEventInput,
): Promise<CompetitionMutationResult<CompetitionEvent>> {
  if (!eventId || !profileId) {
    return { ok: false, error: "Event and profile are required", status: 400 };
  }

  if (!(await isEventManager(eventId, profileId))) {
    return {
      ok: false,
      error: "Not authorized to edit this event",
      status: 403,
    };
  }

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) {
    patch.description = input.description ?? null;
  }
  if (input.location !== undefined) patch.location = input.location ?? null;
  if (input.event_date !== undefined) {
    patch.event_date = input.event_date ?? null;
  }
  if (input.challenge_name !== undefined) {
    patch.challenge_name = input.challenge_name;
  }
  if (input.challenge_threshold !== undefined) {
    patch.challenge_threshold = input.challenge_threshold;
  }
  if (input.max_attempts !== undefined) {
    patch.max_attempts = input.max_attempts;
  }

  // No-op edit: return the current event unchanged.
  if (Object.keys(patch).length === 0) {
    const current = await getCompetitionEvent(eventId);
    if (!current) {
      return { ok: false, error: "Event not found", status: 404 };
    }
    return { ok: true, data: current };
  }

  const { data, error } = await supabaseAdmin
    .from("competition_events")
    .update(patch)
    .eq("id", eventId)
    .select()
    .single();

  if (error || !data) {
    console.error("updateCompetitionEvent: update failed", error);
    return { ok: false, error: "Failed to update event", status: 500 };
  }

  return { ok: true, data: data as unknown as CompetitionEvent };
}

/**
 * Transition an event through the controlled lifecycle. The transition is
 * validated against COMPETITION_EVENT_TRANSITIONS server-side — the client
 * cannot set an arbitrary status. Authorized ONLY for the event creator.
 */
export async function changeCompetitionEventStatus(
  eventId: string,
  profileId: string,
  newStatus: CompetitionEventStatus,
): Promise<CompetitionMutationResult<CompetitionEvent>> {
  if (!eventId || !profileId) {
    return { ok: false, error: "Event and profile are required", status: 400 };
  }

  if (!isCompetitionEventStatus(newStatus)) {
    return { ok: false, error: "Invalid status", status: 400 };
  }

  if (!(await isEventManager(eventId, profileId))) {
    return {
      ok: false,
      error: "Not authorized to change this event's status",
      status: 403,
    };
  }

  const event = await getCompetitionEvent(eventId);
  if (!event) {
    return { ok: false, error: "Event not found", status: 404 };
  }

  if (!isValidEventTransition(event.status, newStatus)) {
    return {
      ok: false,
      error: `Invalid status transition from ${event.status} to ${newStatus}`,
      status: 409,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("competition_events")
    .update({ status: newStatus })
    .eq("id", eventId)
    .select()
    .single();

  if (error || !data) {
    console.error("changeCompetitionEventStatus: update failed", error);
    return { ok: false, error: "Failed to change status", status: 500 };
  }

  return { ok: true, data: data as unknown as CompetitionEvent };
}

export interface AddAmbassadorData {
  ambassador: CompetitionAmbassador;
  profile: {
    id: string;
    email: string;
    full_name: string | null;
  };
}

/**
 * Add an existing account as an ambassador for an event, looked up by email.
 * Authorized ONLY for the event creator. The server resolves the profile from
 * the submitted identifier — a client can never inject an arbitrary profile id.
 *
 * Duplicate associations are handled cleanly (checked up-front and via the
 * database unique constraint). A missing account returns a friendly message.
 */
export async function addCompetitionAmbassador(
  eventId: string,
  managerProfileId: string,
  identifier: string,
): Promise<CompetitionMutationResult<AddAmbassadorData>> {
  if (!eventId || !managerProfileId) {
    return { ok: false, error: "Event and profile are required", status: 400 };
  }

  if (!(await isEventManager(eventId, managerProfileId))) {
    return {
      ok: false,
      error: "Not authorized to manage ambassadors",
      status: 403,
    };
  }

  const email = (identifier ?? "").trim();
  if (!email) {
    return { ok: false, error: "Enter an email address.", status: 400 };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, email, full_name")
    .eq("email", email)
    .maybeSingle();

  if (profileError || !profile) {
    return { ok: false, error: "No account found for that email.", status: 404 };
  }

  // The creator already has full management rights — adding themselves as an
  // ambassador is redundant and rejected.
  if (profile.id === managerProfileId) {
    return {
      ok: false,
      error: "You already manage this event.",
      status: 400,
    };
  }

  // Handle duplicates cleanly before attempting the insert.
  const { data: existing } = await supabaseAdmin
    .from("competition_ambassadors")
    .select("id")
    .eq("event_id", eventId)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (existing) {
    return {
      ok: false,
      error: "That account is already an ambassador for this event.",
      status: 409,
    };
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("competition_ambassadors")
    .insert({ event_id: eventId, profile_id: profile.id })
    .select()
    .single();

  if (insertError || !inserted) {
    // 23505 = unique_violation — a race with another request inserted first.
    if ((insertError as { code?: string } | null)?.code === "23505") {
      return {
        ok: false,
        error: "That account is already an ambassador for this event.",
        status: 409,
      };
    }
    console.error("addCompetitionAmbassador: insert failed", insertError);
    return { ok: false, error: "Failed to add ambassador", status: 500 };
  }

  return {
    ok: true,
    data: {
      ambassador: inserted as unknown as CompetitionAmbassador,
      profile,
    },
  };
}

/**
 * Remove an ambassador association from an event. Authorized ONLY for the
 * event creator.
 */
export async function removeCompetitionAmbassador(
  eventId: string,
  managerProfileId: string,
  ambassadorProfileId: string,
): Promise<CompetitionMutationResult<{ removed: true }>> {
  if (!eventId || !managerProfileId || !ambassadorProfileId) {
    return {
      ok: false,
      error: "Event, manager and ambassador are required",
      status: 400,
    };
  }

  if (!(await isEventManager(eventId, managerProfileId))) {
    return {
      ok: false,
      error: "Not authorized to manage ambassadors",
      status: 403,
    };
  }

  const { error } = await supabaseAdmin
    .from("competition_ambassadors")
    .delete()
    .eq("event_id", eventId)
    .eq("profile_id", ambassadorProfileId);

  if (error) {
    console.error("removeCompetitionAmbassador: delete failed", error);
    return { ok: false, error: "Failed to remove ambassador", status: 500 };
  }

  return { ok: true, data: { removed: true } };
}

/**
 * List an event's ambassadors joined with their profile identity for display.
 * Callers are responsible for verifying management authorization first.
 */
export async function getCompetitionAmbassadorsWithProfiles(
  eventId: string,
): Promise<CompetitionAmbassadorWithProfile[]> {
  if (!eventId) return [];

  const { data, error } = await supabaseAdmin
    .from("competition_ambassadors")
    .select(
      "id, event_id, profile_id, created_at, profile:profiles(id, email, full_name, avatar_url)",
    )
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getCompetitionAmbassadorsWithProfiles: query failed", error);
    return [];
  }

  return (data ?? []) as unknown as CompetitionAmbassadorWithProfile[];
}
