/**
 * TOURN-001 — FOM tournament service (server-only orchestration).
 *
 * This is the ONLY tournament API the rest of FOM should call. It:
 *
 *   1. authorizes the caller against the EXISTING competition rules
 *      (`canManageEvent` = event creator or assigned ambassador — never
 *      profiles.role),
 *   2. reads/writes the small FOM↔provider mapping on competition_events and
 *      competition_participants,
 *   3. delegates every tournament-engine operation to the provider contract,
 *   4. maps provider failures onto the project's discriminated result
 *      (`CompetitionMutationResult`) with an honest HTTP status.
 *
 *   FOM competition  →  service.ts  →  registry.ts  →  ChallongeProvider  →  Challonge
 *
 * Challonge is the source of truth for the bracket, match progression, match
 * state, scores and advancement; FOM is the source of truth for users, profiles,
 * registration and permissions. Only identifiers/mappings are stored in Supabase.
 *
 * There are deliberately NO HTTP routes here: this layer is server-side
 * callable, and the API surface will be designed with the tournament UI task.
 *
 * Conventions match the existing `*-server.ts` modules: `server-only`,
 * service-role client, discriminated results, no thrown errors to callers.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  canManageEvent,
  type CompetitionMutationResult,
} from "@/lib/competition-server";
import {
  DEFAULT_TOURNAMENT_FORMAT,
  isMatchReference,
  isTournamentComplete,
  isValidMatchScoreValue,
  participantDisplayName,
  TOURNAMENT_FORMATS,
  toMatchReference,
  toTournamentConfig,
} from "@/lib/integrations/tournament/contract";
import { TournamentProviderError } from "@/lib/integrations/tournament/errors";
import type { TournamentProviderErrorCode } from "@/lib/integrations/tournament/errors";
import { resolveTournamentProvider } from "@/lib/integrations/tournament/registry";
import {
  buildTournamentName,
  buildTournamentSlug,
} from "@/lib/integrations/tournament/slug";
import type {
  Tournament,
  TournamentConfig,
  TournamentFormat,
  TournamentMatch,
  TournamentParticipant,
  TournamentParticipantRef,
  TournamentProvider,
} from "@/lib/integrations/tournament/types";
import type { CompetitionParticipantStatus } from "@/types";

/**
 * Participants are pushed to the provider in bounded batches: the mapping for a
 * batch is persisted immediately after the provider confirms it, so a failure
 * can only ever affect one batch instead of the whole roster.
 */
export const PARTICIPANT_SYNC_BATCH_SIZE = 64;

// ─── Result shapes ─────────────────────────────────────────────

/** The FOM ↔ provider link stored on the competition. */
export interface EventTournamentLink {
  /** Provider id ("challonge"). */
  provider: string;
  /** The provider's tournament id. */
  providerTournamentId: string;
}

/**
 * One tournament format FOM models, and whether the competition's provider can
 * actually create it.
 *
 * `supported: false` means the format exists in FOM's vocabulary but cannot be
 * created yet, so the UI offers it as a future capability instead of submitting
 * something the provider would refuse (or worse, silently replacing).
 */
export interface EventTournamentFormatOption {
  format: TournamentFormat;
  supported: boolean;
}

/** A competition participant that exists on the provider. */
export interface EventTournamentParticipant {
  /** The provider's participant id. */
  providerParticipantId: string;
  /** competition_participants.id — FOM's own participant identity. */
  participantId: string;
  displayName: string;
  status: CompetitionParticipantStatus;
}

/** The bracket as FOM sees it: provider state + FOM participant identities. */
export interface EventTournamentBracket {
  link: EventTournamentLink;
  tournament: Tournament;
  matches: TournamentMatch[];
  participants: EventTournamentParticipant[];
}

/** A compact status view for a competition's external tournament. */
export interface EventTournamentSummary {
  link: EventTournamentLink;
  tournament: Tournament;
  /** The FOM tournament configuration recorded for this competition. */
  config: TournamentConfig;
  isComplete: boolean;
  /** Matches with both sides known and no result yet. */
  openMatchCount: number;
  winnerProviderParticipantId: string | null;
  /** competition_participants.id of the champion, when mapped. */
  winnerParticipantId: string | null;
}

/** Result of starting (or confirming the start of) a tournament. */
export interface EventTournamentStart {
  link: EventTournamentLink;
  tournament: Tournament;
  /** The FOM tournament configuration recorded for this competition. */
  config: TournamentConfig;
  /** false when the tournament was already started (idempotent call). */
  started: boolean;
}

/** Result of finalizing (or confirming the completion of) a tournament. */
export interface EventTournamentFinalization {
  link: EventTournamentLink;
  tournament: Tournament;
  /** The FOM tournament configuration recorded for this competition. */
  config: TournamentConfig;
  /**
   * The provider's participant id for the champion. Server-side only: the API
   * layer resolves it to {@link winnerParticipantId} before responding, so a
   * provider id never leaves FOM.
   */
  winnerProviderParticipantId: string | null;
  /** competition_participants.id of the champion, when it could be mapped. */
  winnerParticipantId: string | null;
  /** false when the tournament was already complete (idempotent call). */
  finalized: boolean;
}

/** The outcome of reporting one match result. */
export interface EventMatchResult {
  link: EventTournamentLink;
  /** The match as the provider now holds it (provider-neutral shape). */
  match: TournamentMatch;
  /**
   * The FOM↔provider participant mapping, so the caller can express the match's
   * sides as `competition_participants.id` + display name instead of provider
   * ids.
   */
  participants: EventTournamentParticipant[];
}

/** Result of pushing the competition's participants to the provider. */
export interface EventParticipantSync {
  link: EventTournamentLink;
  added: TournamentParticipant[];
  /** Participants already mapped from an earlier sync. */
  skipped: number;
}

/** Options for creating a provider tournament for a competition. */
export interface CreateEventTournamentOptions {
  /** Provider to use when the competition has not recorded one. */
  providerId?: string;
  /**
   * The provider-neutral configuration the tournament must be created with.
   *
   * An omitted config (or omitted format) keeps the historical behaviour and
   * uses {@link DEFAULT_TOURNAMENT_FORMAT}; a format FOM does not model is
   * rejected with `400` and never converted into another format.
   */
  config?: Partial<TournamentConfig>;
}

/** FOM's match-result input for a competition's external tournament. */
export interface ReportEventMatchResultInput {
  /**
   * FOM's own reference for the match (see `toMatchReference`) — resolved to the
   * provider's match inside this service. Never a provider id.
   */
  matchRef: string;
  /** The winning side, as a `competition_participants.id` (a FOM id). */
  winnerParticipantId: string;
  participant1Score: number;
  participant2Score: number;
}

// ─── Internal types ────────────────────────────────────────────

/** The only competition_events columns this service needs. */
interface EventTournamentRow {
  id: string;
  name: string;
  provider: string | null;
  provider_tournament_id: string | null;
  /**
   * The FOM format recorded when the tournament was created. NULL for a
   * competition with no tournament, and for rows written before TOURN-002A —
   * both are read as {@link DEFAULT_TOURNAMENT_FORMAT}.
   */
  tournament_format: string | null;
}

/** competition_participants row joined with the participant's display name. */
interface EventParticipantRow {
  id: string;
  status: CompetitionParticipantStatus;
  provider_participant_id: string | null;
  /**
   * T-REM-4 soft-removal timestamp. NULL (or missing) === active. Read so the
   * loader can detect the "removed but provider-mapped" consistency case.
   */
  removed_at: string | null;
  profile: { full_name: string | null } | null;
}

type Failure = { ok: false; error: string; status: number };

type LoadedEvent = { ok: true; event: EventTournamentRow } | Failure;

const EVENT_TOURNAMENT_COLUMNS =
  "id, name, provider, provider_tournament_id, tournament_format";

// Migration 0026 (T-REM-1) added a second FK from competition_participants to
// profiles (removed_by_profile_id), so the `profiles` embed needs an explicit FK
// hint (PostgREST PGRST201 otherwise). The hint pins the participant's OWN profile.
const PARTICIPANT_COLUMNS =
  "id, status, provider_participant_id, removed_at, profile:profiles!competition_participants_profile_id_fkey(full_name)";

/** Provider error code → HTTP status FOM reports to its own caller. */
const PROVIDER_ERROR_STATUS: Record<TournamentProviderErrorCode, number> = {
  provider_not_configured: 503,
  provider_unknown: 500,
  provider_auth_failed: 502,
  provider_not_found: 404,
  provider_invalid_request: 400,
  provider_request_failed: 502,
  provider_unavailable: 502,
  provider_response_invalid: 502,
  tournament_invalid_input: 400,
};

/**
 * Translate a provider/validation failure into a discriminated failure.
 *
 * Logging is intentionally limited to the error code/status and the message:
 * provider errors are constructed to be credential-free (see
 * providers/challonge.ts), and an unexpected error is logged by message only so
 * a request URL could never be dumped into the logs.
 */
function mapProviderFailure(error: unknown, context: string): Failure {
  if (error instanceof TournamentProviderError) {
    console.error(`[tournament] ${context} failed`, {
      code: error.code,
      status: error.status ?? null,
      provider: error.providerId ?? null,
    });
    return {
      ok: false,
      error: error.message,
      status: PROVIDER_ERROR_STATUS[error.code] ?? 502,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`[tournament] ${context} failed`, message);
  return {
    ok: false,
    error: "The tournament provider request failed",
    status: 502,
  };
}

// ─── FOM data access ───────────────────────────────────────────

/** Load the competition row the tournament mapping lives on. */
async function loadEventTournament(eventId: string): Promise<LoadedEvent> {
  if (!eventId) {
    return { ok: false, error: "A competition is required", status: 400 };
  }

  const { data, error } = await supabaseAdmin
    .from("competition_events")
    .select(EVENT_TOURNAMENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    console.error("loadEventTournament: query failed", error);
    return { ok: false, error: "Failed to load the competition", status: 500 };
  }

  if (!data) {
    return { ok: false, error: "Competition not found", status: 404 };
  }

  return { ok: true, event: data as unknown as EventTournamentRow };
}

/** Load a competition that is already linked to an external tournament. */
async function loadLinkedEventTournament(
  eventId: string,
): Promise<LoadedEvent> {
  const loaded = await loadEventTournament(eventId);
  if (!loaded.ok) return loaded;

  if (!loaded.event.provider_tournament_id) {
    return {
      ok: false,
      error: "This competition is not linked to an external tournament yet",
      status: 409,
    };
  }

  return loaded;
}

/** The FOM mapping, for an event known to be linked. */
function linkOf(event: EventTournamentRow): EventTournamentLink {
  return {
    provider: event.provider as string,
    providerTournamentId: event.provider_tournament_id as string,
  };
}

/**
 * The tournament configuration recorded for a competition.
 *
 * BACKWARD COMPATIBILITY: a competition linked before TOURN-002A has no
 * `tournament_format` (and an unexpected stored value is never acted upon), so
 * both are read as {@link DEFAULT_TOURNAMENT_FORMAT} — the format the
 * integration created tournaments with until now. Existing tournaments
 * therefore keep working unchanged.
 */
function configOf(event: EventTournamentRow): TournamentConfig {
  return (
    toTournamentConfig({ format: event.tournament_format ?? undefined }) ?? {
      format: DEFAULT_TOURNAMENT_FORMAT,
    }
  );
}

/**
 * Authorize the caller using the EXISTING competition rule (creator or assigned
 * ambassador). Returns null when authorized.
 */
async function requireManager(
  eventId: string,
  profileId: string,
): Promise<Failure | null> {
  if (!eventId || !profileId) {
    return {
      ok: false,
      error: "Competition and profile are required",
      status: 400,
    };
  }

  if (!(await canManageEvent(eventId, profileId))) {
    return {
      ok: false,
      error: "Not authorized to manage this competition's tournament",
      status: 403,
    };
  }

  return null;
}

/** Resolve the provider recorded on the event through the registry. */
function providerForEvent(
  provider: string | null,
  fallbackProviderId?: string,
): TournamentProvider {
  return resolveTournamentProvider(provider ?? fallbackProviderId ?? null);
}

/**
 * All participant rows of an event, in the competition's own order.
 *
 * T-REM-4: `activeOnly` excludes soft-removed participants (`removed_at IS
 * NULL`) at the QUERY level. It is used ONLY by the sync operation, so a removed
 * participant is never newly pushed into an external tournament. The history
 * readers (bracket / match result / finalize / summary) load ALL rows so every
 * existing provider mapping and past bracket participant stays resolvable — a
 * removed participant's historical result is never hidden or rewritten.
 *
 * If a row is BOTH soft-removed and still provider-mapped it is a consistency
 * case that cannot be produced through FOM (removal and ban are refused while
 * `provider_participant_id IS NOT NULL`, and the sync path above never maps a
 * removed participant). It is surfaced with a warning instead of silently
 * mutating provider state.
 */
async function loadEventParticipantRows(
  eventId: string,
  options: { activeOnly?: boolean } = {},
): Promise<{ ok: true; rows: EventParticipantRow[] } | Failure> {
  let query = supabaseAdmin
    .from("competition_participants")
    .select(PARTICIPANT_COLUMNS)
    .eq("event_id", eventId);

  if (options.activeOnly) {
    query = query.is("removed_at", null);
  }

  const { data, error } = await query.order("created_at", {
    ascending: true,
  });

  if (error) {
    console.error("loadEventParticipantRows: query failed", error);
    return {
      ok: false,
      error: "Failed to load the competition participants",
      status: 500,
    };
  }

  const rows = (data ?? []) as unknown as EventParticipantRow[];

  // Consistency guard (T-REM-4): preserve the mapping, never mutate the
  // provider, but make the inconsistent state visible for reconciliation.
  const removedAndMapped = rows.filter(
    (row) => row.removed_at != null && row.provider_participant_id != null,
  );
  if (removedAndMapped.length > 0) {
    console.warn(
      "[tournament] soft-removed participants are still mapped to the external tournament; preserving provider state for reconciliation",
      {
        eventId,
        participantIds: removedAndMapped.map((row) => row.id),
      },
    );
  }

  return { ok: true, rows };
}

/**
 * The competition's participants that exist on the provider, with the display
 * name FOM shows for them on a bracket (see `participantDisplayName`).
 */
function mappedEventParticipants(
  rows: EventParticipantRow[],
): EventTournamentParticipant[] {
  const mapped: EventTournamentParticipant[] = [];

  rows.forEach((row, index) => {
    if (!row.provider_participant_id) return;
    mapped.push({
      providerParticipantId: row.provider_participant_id,
      participantId: row.id,
      displayName: participantDisplayName(row.profile?.full_name, index + 1),
      status: row.status,
    });
  });

  return mapped;
}

/**
 * The FOM → provider participant translation.
 *
 * A match result is accepted from FOM in FOM terms (a
 * `competition_participants.id`) and only the provider's own id is handed to the
 * adapter, which is what keeps provider ids out of the API and UI. A participant
 * with no provider id has never been synced, so it cannot appear on the bracket.
 */
function fomToProviderParticipantIds(
  rows: EventParticipantRow[],
): Map<string, string> {
  const byFomId = new Map<string, string>();

  for (const row of rows) {
    if (row.provider_participant_id) {
      byFomId.set(row.id, row.provider_participant_id);
    }
  }

  return byFomId;
}

/** The reverse direction: provider participant id → competition_participants.id. */
function providerToFomParticipantIds(
  rows: EventParticipantRow[],
): Map<string, string> {
  const byProviderId = new Map<string, string>();

  for (const row of rows) {
    if (row.provider_participant_id) {
      byProviderId.set(row.provider_participant_id, row.id);
    }
  }

  return byProviderId;
}

/**
 * Persist one participant's provider id.
 *
 * T-REM-4: the write is conditional on the participant still being ACTIVE
 * (`removed_at IS NULL`). This closes the narrow race where a host removes an
 * un-mapped participant while the provider call is in flight: the mapping is
 * never written, so FOM cannot create a removed-but-mapped inconsistency. The
 * external bracket already holds the participant, so the 0-row update surfaces
 * through the caller's existing "confirmed but not mapped" reconciliation
 * failure instead of reporting a false success.
 */
async function saveParticipantMapping(
  participantId: string,
  providerParticipantId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .update({ provider_participant_id: providerParticipantId })
    .eq("id", participantId)
    .is("removed_at", null)
    .select("id");

  if (error) {
    console.error("saveParticipantMapping: update failed", error);
    return false;
  }

  // A 0-row update means the participant was removed concurrently.
  return Array.isArray(data) && data.length > 0;
}

/**
 * Save the FOM ↔ provider mapping AND the configuration it was created with on
 * the competition.
 *
 * The update is CONDITIONAL on the event still being unlinked, so two
 * concurrent requests can never leave a mismatch between FOM and the provider:
 * the loser of the race re-reads the row and succeeds only when it points at
 * the very same external tournament.
 *
 * The format is written in the SAME update as the provider columns because the
 * database requires a linked competition to record a format (migration 0024), so
 * a half-written configuration can never exist.
 */
async function saveEventTournamentLink(
  eventId: string,
  providerId: string,
  providerTournamentId: string,
  format: TournamentFormat,
): Promise<CompetitionMutationResult<EventTournamentLink>> {
  const { data, error } = await supabaseAdmin
    .from("competition_events")
    .update({
      provider: providerId,
      provider_tournament_id: providerTournamentId,
      tournament_format: format,
    })
    .eq("id", eventId)
    .is("provider_tournament_id", null)
    .select("id");

  if (error) {
    console.error("saveEventTournamentLink: update failed", error);
    return {
      ok: false,
      error: "Failed to save the external tournament link",
      status: 500,
    };
  }

  if (Array.isArray(data) && data.length > 0) {
    return { ok: true, data: { provider: providerId, providerTournamentId } };
  }

  // The conditional update matched nothing: another request linked it first.
  const existing = await loadEventTournament(eventId);
  if (
    existing.ok &&
    existing.event.provider_tournament_id === providerTournamentId
  ) {
    return {
      ok: true,
      data: {
        provider: existing.event.provider ?? providerId,
        providerTournamentId,
      },
    };
  }

  return {
    ok: false,
    error:
      "This competition is already linked to a different external tournament",
    status: 409,
  };
}

/**
 * Try to adopt a tournament that already exists on the provider under our slug.
 * Used only after the provider rejected a creation as a duplicate; any failure
 * here is ignored so the original creation error is what the caller sees.
 */
async function adoptExistingTournament(
  provider: TournamentProvider,
  slug: string,
): Promise<Tournament | null> {
  try {
    return await provider.getTournament(slug);
  } catch {
    return null;
  }
}

// ─── Tournament lifecycle ──────────────────────────────────────

/**
 * Create the external tournament for a competition and persist the mapping.
 *
 *   FOM competition → provider.createTournament → save provider_tournament_id
 *
 * DUPLICATE-CREATION PROTECTION (see slug.ts for the reasoning):
 *   1. an already-linked competition is rejected with 409 before any call;
 *   2. the slug is derived from the competition id, so a retry after a crash
 *      produces the same slug and the provider rejects the duplicate — the
 *      service then adopts the tournament that already exists instead of
 *      creating a second one;
 *   3. the mapping write is conditional on the event still being unlinked.
 *
 * CONFIGURATION (TOURN-002A): the caller passes the provider-neutral tournament
 * configuration it wants. It is validated here (never trusted from a client) and
 * checked against the resolved provider's own capability — an unsupported format
 * is refused with 400 and is NEVER mapped onto a supported one. The accepted
 * configuration is persisted on the competition together with the provider
 * mapping, so a reload (or a later task) always sees the format that was chosen.
 *
 * This is not a distributed transaction: if the external tournament is deleted
 * on the provider between attempts, a new one is created (documented limitation).
 */
export async function createEventTournament(
  eventId: string,
  profileId: string,
  options: CreateEventTournamentOptions = {},
): Promise<
  CompetitionMutationResult<{
    link: EventTournamentLink;
    tournament: Tournament;
    config: TournamentConfig;
  }>
> {
  const denied = await requireManager(eventId, profileId);
  if (denied) return denied;

  const loaded = await loadEventTournament(eventId);
  if (!loaded.ok) return loaded;

  const { event } = loaded;
  if (event.provider_tournament_id) {
    return {
      ok: false,
      error: "This competition already has an external tournament",
      status: 409,
    };
  }

  // Validated BEFORE any provider is resolved: a format FOM does not model is
  // rejected outright, and an omitted format keeps the historical default.
  const config = toTournamentConfig(options.config);
  if (!config) {
    const requested = (options.config as { format?: unknown } | undefined)?.format;
    return {
      ok: false,
      error: `Unsupported tournament format "${String(requested)}"`,
      status: 400,
    };
  }

  let provider: TournamentProvider;
  let slug: string;
  try {
    provider = providerForEvent(event.provider, options.providerId);
    slug = buildTournamentSlug(event.id);
  } catch (error) {
    return mapProviderFailure(error, "createEventTournament");
  }

  // The adapter decides what it can actually create. Anything else is refused
  // with a clear domain error instead of being silently substituted.
  if (!provider.supportsFormat(config.format)) {
    return {
      ok: false,
      error: `The tournament format "${config.format}" is not supported by the configured tournament provider`,
      status: 400,
    };
  }

  const name = buildTournamentName(event.name, slug);

  let tournament: Tournament | null = null;
  try {
    tournament = await provider.createTournament({ name, slug, config });
  } catch (error) {
    // A duplicate slug means an earlier attempt already created this
    // competition's tournament: adopt it rather than creating a second one.
    if (
      error instanceof TournamentProviderError &&
      error.code === "provider_invalid_request"
    ) {
      tournament = await adoptExistingTournament(provider, slug);
    }
    if (!tournament) {
      return mapProviderFailure(error, "createEventTournament");
    }
  }

  const saved = await saveEventTournamentLink(
    event.id,
    provider.id,
    tournament.providerTournamentId,
    config.format,
  );
  if (!saved.ok) return saved;

  return { ok: true, data: { link: saved.data, tournament, config } };
}

/**
 * Push the competition's participants to the external tournament.
 *
 *   FOM participant (competition_participants) → provider participant
 *                                              → provider_participant_id
 *
 * Identity comes from the FOM participant row (never from synthetic data), and
 * the display name is the participant's own `full_name` with a positional
 * fallback. Participants already mapped from an earlier sync are skipped, so the
 * call is safe to repeat for a partially synced competition.
 *
 * The provider is called in bounded batches and each batch's mapping is saved
 * immediately, so a failure can only affect one batch. If the provider confirms
 * participants whose mapping cannot be stored, the call FAILS (it never reports
 * success) and the affected ids are logged for reconciliation — see the known
 * limitations in the README.
 *
 * T-REM-4: only ACTIVE participants are synced (`removed_at IS NULL`), so a
 * soft-removed participant is never newly added to the external tournament.
 * Participants already mapped from an earlier sync are skipped, so the call is
 * safe to repeat for a partially synced competition.
 */
export async function addEventParticipantsToTournament(
  eventId: string,
  profileId: string,
): Promise<CompetitionMutationResult<EventParticipantSync>> {
  const denied = await requireManager(eventId, profileId);
  if (denied) return denied;

  const loaded = await loadLinkedEventTournament(eventId);
  if (!loaded.ok) return loaded;

  const { event } = loaded;
  const link = linkOf(event);

  // T-REM-4: never newly sync a soft-removed participant.
  const participants = await loadEventParticipantRows(event.id, {
    activeOnly: true,
  });
  if (!participants.ok) return participants;

  const rows = participants.rows;
  const refs: TournamentParticipantRef[] = [];
  rows.forEach((row, index) => {
    if (row.provider_participant_id) return;
    refs.push({
      ref: row.id,
      displayName: participantDisplayName(row.profile?.full_name, index + 1),
    });
  });

  if (refs.length === 0) {
    return { ok: true, data: { link, added: [], skipped: rows.length } };
  }

  let provider: TournamentProvider;
  try {
    provider = providerForEvent(event.provider);
  } catch (error) {
    return mapProviderFailure(error, "addEventParticipantsToTournament");
  }

  const added: TournamentParticipant[] = [];

  try {
    for (
      let start = 0;
      start < refs.length;
      start += PARTICIPANT_SYNC_BATCH_SIZE
    ) {
      const batch = refs.slice(start, start + PARTICIPANT_SYNC_BATCH_SIZE);
      const confirmed = await provider.addParticipants(
        link.providerTournamentId,
        batch,
      );

      const unmapped: string[] = [];
      for (const participant of confirmed) {
        const stored = await saveParticipantMapping(
          participant.ref,
          participant.providerParticipantId,
        );
        if (stored) added.push(participant);
        else unmapped.push(participant.ref);
      }

      if (unmapped.length > 0) {
        console.error(
          "[tournament] participants confirmed by the provider but not mapped in FOM",
          { provider: link.provider, participantIds: unmapped },
        );
        return {
          ok: false,
          error:
            "Participants were added to the external tournament but could not be mapped in FOM. Reconcile them before retrying.",
          status: 500,
        };
      }
    }
  } catch (error) {
    return mapProviderFailure(error, "addEventParticipantsToTournament");
  }

  return {
    ok: true,
    data: { link, added, skipped: rows.length - refs.length },
  };
}

/**
 * Start the external tournament (generating the bracket).
 *
 * Idempotent: starting an already-started tournament returns its current state
 * with `started: false`. A `completed` tournament is rejected with 409, and an
 * unrecognised provider state is refused rather than acted upon.
 *
 * T-REM-4: starting does not select FOM participants — the bracket is produced
 * from the participants already present at the provider, and a soft-removed
 * participant is never provider-mapped (sync filters them, and removal/ban are
 * refused while `provider_participant_id IS NOT NULL`). A removed-but-mapped
 * participant — impossible through FOM — is detected and logged by
 * `loadEventParticipantRows`, and its provider state is preserved for manual
 * reconciliation rather than being mutated here.
 */
export async function startEventTournament(
  eventId: string,
  profileId: string,
): Promise<CompetitionMutationResult<EventTournamentStart>> {
  const denied = await requireManager(eventId, profileId);
  if (denied) return denied;

  const loaded = await loadLinkedEventTournament(eventId);
  if (!loaded.ok) return loaded;

  const { event } = loaded;
  const link = linkOf(event);

  let provider: TournamentProvider;
  let current: Tournament | null;
  try {
    provider = providerForEvent(event.provider);
    current = await provider.getTournament(link.providerTournamentId);
  } catch (error) {
    return mapProviderFailure(error, "startEventTournament");
  }

  if (!current) {
    return {
      ok: false,
      error: "The linked external tournament no longer exists",
      status: 404,
    };
  }

  if (current.state === "completed") {
    return {
      ok: false,
      error: "The external tournament is already completed",
      status: 409,
    };
  }

  if (current.state === "started") {
    return {
      ok: true,
      data: { link, tournament: current, config: configOf(event), started: false },
    };
  }

  if (current.state !== "created") {
    return {
      ok: false,
      error: `The external tournament reported a state FOM does not recognise ("${current.state}") and will not be started`,
      status: 409,
    };
  }

  try {
    const tournament = await provider.startTournament(link.providerTournamentId);
    return {
      ok: true,
      data: { link, tournament, config: configOf(event), started: true },
    };
  } catch (error) {
    return mapProviderFailure(error, "startEventTournament");
  }
}

/**
 * Report a match result for the competition's external tournament.
 *
 *   FOM → reportEventMatchResult() → TournamentProvider → ChallongeProvider → Challonge
 *
 * FOM's input is fully provider-neutral: the match is addressed by FOM's own
 * match reference and the winner is a `competition_participants.id`. This
 * function resolves both to the provider's identifiers using the mapping that
 * already exists in FOM — the adapter receives nothing but the provider's own
 * ids and wire format — and then hands the result to the provider contract.
 *
 * ADVANCEMENT IS THE PROVIDER'S JOB. Nothing here inspects or edits the bracket:
 * FOM submits what happened, re-reads the bracket afterwards, and displays it. A
 * result is refused (never "corrected") for a match the provider already reports
 * as completed, because the current provider contract has no notion of
 * correcting a settled match.
 */
export async function reportEventMatchResult(
  eventId: string,
  profileId: string,
  input: ReportEventMatchResultInput,
): Promise<CompetitionMutationResult<EventMatchResult>> {
  const denied = await requireManager(eventId, profileId);
  if (denied) return denied;

  // ── The client's input is validated before anything is read or called ──
  const matchRef = String(input?.matchRef ?? "").trim();
  if (!isMatchReference(matchRef)) {
    return { ok: false, error: "A valid match reference is required", status: 400 };
  }
  if (
    !isValidMatchScoreValue(input.participant1Score) ||
    !isValidMatchScoreValue(input.participant2Score)
  ) {
    return {
      ok: false,
      error: "Match scores must be whole, non-negative numbers",
      status: 400,
    };
  }
  // FOM tournaments do not model draws, and a level score cannot decide who
  // advances, so it is rejected instead of inventing a tie-break rule.
  if (input.participant1Score === input.participant2Score) {
    return {
      ok: false,
      error:
        "A match result needs a decisive score: this tournament does not support draws",
      status: 400,
    };
  }
  const winnerParticipantId = String(input.winnerParticipantId ?? "").trim();
  if (!winnerParticipantId) {
    return { ok: false, error: "A winning participant is required", status: 400 };
  }

  const loaded = await loadLinkedEventTournament(eventId);
  if (!loaded.ok) return loaded;

  const { event } = loaded;
  const link = linkOf(event);

  // The FOM↔provider mapping: the ONLY place a FOM participant id becomes a
  // provider participant id.
  const participants = await loadEventParticipantRows(event.id);
  if (!participants.ok) return participants;

  let provider: TournamentProvider;
  let tournament: Tournament | null;
  let matches: TournamentMatch[] = [];

  try {
    provider = providerForEvent(event.provider);
    tournament = await provider.getTournament(link.providerTournamentId);

    // Only a started (or completed) tournament has a bracket to read.
    if (tournament && tournament.state !== "created") {
      matches = await provider.getMatches(link.providerTournamentId);
    }
  } catch (error) {
    return mapProviderFailure(error, "reportEventMatchResult");
  }

  if (!tournament) {
    return {
      ok: false,
      error: "The linked external tournament no longer exists",
      status: 404,
    };
  }

  if (tournament.state === "created") {
    return { ok: false, error: "This tournament has not started yet", status: 409 };
  }

  if (tournament.state === "completed") {
    return {
      ok: false,
      error: "This tournament is already complete",
      status: 409,
    };
  }

  if (tournament.state !== "started") {
    return {
      ok: false,
      error: `The external tournament reported a state FOM does not recognise ("${tournament.state}") and will not take a result`,
      status: 409,
    };
  }

  // Resolve FOM's match reference back to the provider's match: the reference is
  // recomposed from the round the provider reported plus the FOM participants its
  // sides map to, so it can only ever match a match of THIS competition.
  const fomIds = providerToFomParticipantIds(participants.rows);

  const match = matches.find((candidate) => {
    const participant1Id = candidate.participant1Id
      ? fomIds.get(candidate.participant1Id) ?? null
      : null;
    const participant2Id = candidate.participant2Id
      ? fomIds.get(candidate.participant2Id) ?? null
      : null;

    return (
      toMatchReference({ round: candidate.round, participant1Id, participant2Id }) ===
      matchRef
    );
  });

  if (!match) {
    return {
      ok: false,
      error: "This match is not part of this tournament",
      status: 404,
    };
  }

  if (match.state === "completed") {
    return { ok: false, error: "This match already has a result", status: 409 };
  }

  if (match.state !== "ready") {
    return {
      ok: false,
      error: "This match is not ready for a result yet",
      status: 409,
    };
  }

  // The provider's participant id for the selected winner, and proof that the
  // selected winner really is one of this match's two sides.
  const winnerProviderParticipantId =
    fomToProviderParticipantIds(participants.rows).get(winnerParticipantId) ?? null;

  if (
    !winnerProviderParticipantId ||
    (winnerProviderParticipantId !== match.participant1Id &&
      winnerProviderParticipantId !== match.participant2Id)
  ) {
    return {
      ok: false,
      error: "The selected winner is not a participant in this match",
      status: 400,
    };
  }

  try {
    const reported = await provider.reportMatchResult(link.providerTournamentId, {
      matchId: match.matchId,
      participant1Score: input.participant1Score,
      participant2Score: input.participant2Score,
      winnerParticipantId: winnerProviderParticipantId,
    });

    return {
      ok: true,
      data: {
        link,
        match: reported,
        participants: mappedEventParticipants(participants.rows),
      },
    };
  } catch (error) {
    return mapProviderFailure(error, "reportEventMatchResult");
  }
}

/**
 * Read the competition's bracket in FOM terms.
 *
 *   provider match → FOM-neutral TournamentMatch (+ FOM participant identities)
 *
 * The mapping from provider participant ids back to
 * competition_participants.id is resolved here, so the rest of FOM never needs
 * to know what a provider participant id is.
 */
export async function getEventTournamentBracket(
  eventId: string,
  viewerProfileId: string,
): Promise<CompetitionMutationResult<EventTournamentBracket>> {
  const denied = await requireManager(eventId, viewerProfileId);
  if (denied) return denied;

  const loaded = await loadLinkedEventTournament(eventId);
  if (!loaded.ok) return loaded;

  const { event } = loaded;
  const link = linkOf(event);

  const participants = await loadEventParticipantRows(event.id);
  if (!participants.ok) return participants;

  let provider: TournamentProvider;
  let tournament: Tournament | null;
  let matches: TournamentMatch[] = [];

  try {
    provider = providerForEvent(event.provider);
    tournament = await provider.getTournament(link.providerTournamentId);

    // A tournament that has not started has no bracket yet; reading matches
    // would be meaningless, so it is skipped rather than reported as an error.
    if (tournament && tournament.state !== "created") {
      matches = await provider.getMatches(link.providerTournamentId);
    }
  } catch (error) {
    return mapProviderFailure(error, "getEventTournamentBracket");
  }

  if (!tournament) {
    return {
      ok: false,
      error: "The linked external tournament no longer exists",
      status: 404,
    };
  }

  return {
    ok: true,
    data: {
      link,
      tournament,
      matches,
      participants: mappedEventParticipants(participants.rows),
    },
  };
}

/**
 * Finalize the external tournament and read the champion.
 *
 * The provider's engine needs an explicit finalize step after the last result
 * (this is a provider contract operation, so the words behind it stay in the
 * adapter). Idempotent: an already-completed tournament returns its state with
 * `finalized: false`.
 *
 * Whether the tournament is READY to be finalized is the provider's verdict, not
 * FOM's: nothing here counts matches or reimplements an "all matches complete"
 * rule. A provider refusal is surfaced as-is (see `mapProviderFailure`).
 *
 * The champion comes from `getWinner()` — never from FOM's reading of the match
 * results — and is resolved back to a `competition_participants.id` so the UI can
 * show a normal FOM participant.
 */
export async function finalizeEventTournament(
  eventId: string,
  profileId: string,
): Promise<CompetitionMutationResult<EventTournamentFinalization>> {
  const denied = await requireManager(eventId, profileId);
  if (denied) return denied;

  const loaded = await loadLinkedEventTournament(eventId);
  if (!loaded.ok) return loaded;

  const { event } = loaded;
  const link = linkOf(event);

  let provider: TournamentProvider;
  let current: Tournament | null;

  try {
    provider = providerForEvent(event.provider);
    current = await provider.getTournament(link.providerTournamentId);
  } catch (error) {
    return mapProviderFailure(error, "finalizeEventTournament");
  }

  if (!current) {
    return {
      ok: false,
      error: "The linked external tournament no longer exists",
      status: 404,
    };
  }

  if (current.state === "created") {
    return {
      ok: false,
      error: "The external tournament has not started yet",
      status: 409,
    };
  }

  if (current.state !== "started" && current.state !== "completed") {
    return {
      ok: false,
      error: `The external tournament reported a state FOM does not recognise ("${current.state}") and will not be finalized`,
      status: 409,
    };
  }

  const alreadyComplete = current.state === "completed";

  try {
    const tournament = alreadyComplete
      ? current
      : await provider.finalizeTournament(link.providerTournamentId);

    // The champion is the provider's answer; FOM never derives one.
    const winner = await provider.getWinner(link.providerTournamentId);
    const winnerProviderParticipantId = winner?.providerParticipantId ?? null;

    let winnerParticipantId: string | null = null;
    if (winnerProviderParticipantId) {
      const participants = await loadEventParticipantRows(event.id);
      if (!participants.ok) return participants;

      winnerParticipantId =
        providerToFomParticipantIds(participants.rows).get(
          winnerProviderParticipantId,
        ) ?? null;
    }

    return {
      ok: true,
      data: {
        link,
        tournament,
        config: configOf(event),
        winnerProviderParticipantId,
        winnerParticipantId,
        finalized: !alreadyComplete,
      },
    };
  } catch (error) {
    return mapProviderFailure(error, "finalizeEventTournament");
  }
}

/**
 * A compact status view of the competition's external tournament: the recorded
 * configuration, state, whether it is complete, how many matches are reportable,
 * and the champion resolved back to the FOM participant row.
 */
export async function getEventTournamentSummary(
  eventId: string,
  viewerProfileId: string,
): Promise<CompetitionMutationResult<EventTournamentSummary>> {
  const denied = await requireManager(eventId, viewerProfileId);
  if (denied) return denied;

  const loaded = await loadLinkedEventTournament(eventId);
  if (!loaded.ok) return loaded;

  const { event } = loaded;
  const link = linkOf(event);

  let provider: TournamentProvider;
  let tournament: Tournament | null;
  let openMatchCount = 0;
  let winnerProviderParticipantId: string | null = null;

  try {
    provider = providerForEvent(event.provider);
    tournament = await provider.getTournament(link.providerTournamentId);

    if (tournament && tournament.state !== "created") {
      const matches = await provider.getMatches(link.providerTournamentId);
      openMatchCount = matches.filter((match) => match.state === "ready").length;
    }

    // Only a completed tournament has a champion.
    if (tournament && isTournamentComplete(tournament)) {
      const winner = await provider.getWinner(link.providerTournamentId);
      winnerProviderParticipantId = winner?.providerParticipantId ?? null;
    }
  } catch (error) {
    return mapProviderFailure(error, "getEventTournamentSummary");
  }

  if (!tournament) {
    return {
      ok: false,
      error: "The linked external tournament no longer exists",
      status: 404,
    };
  }

  let winnerParticipantId: string | null = null;
  if (winnerProviderParticipantId) {
    const participants = await loadEventParticipantRows(event.id);
    if (!participants.ok) return participants;

    winnerParticipantId =
      providerToFomParticipantIds(participants.rows).get(
        winnerProviderParticipantId,
      ) ?? null;
  }

  return {
    ok: true,
    data: {
      link,
      tournament,
      config: configOf(event),
      isComplete: isTournamentComplete(tournament),
      openMatchCount,
      winnerProviderParticipantId,
      winnerParticipantId,
    },
  };
}

/**
 * The tournament formats FOM models, each with whether the competition's
 * provider can actually create it.
 *
 * This is the capability seam the UI renders its format selector from: the
 * vocabulary of formats belongs to FOM, but what may actually be offered is
 * decided by the provider adapter, so a format that cannot be created is shown
 * as unavailable instead of being submitted (or silently replaced). Nothing
 * here exposes the provider's own vocabulary.
 */
export async function getEventTournamentFormatOptions(
  eventId: string,
  viewerProfileId: string,
): Promise<CompetitionMutationResult<EventTournamentFormatOption[]>> {
  const denied = await requireManager(eventId, viewerProfileId);
  if (denied) return denied;

  const loaded = await loadEventTournament(eventId);
  if (!loaded.ok) return loaded;

  try {
    const provider = providerForEvent(loaded.event.provider);
    return {
      ok: true,
      data: TOURNAMENT_FORMATS.map((format) => ({
        format,
        supported: provider.supportsFormat(format),
      })),
    };
  } catch (error) {
    return mapProviderFailure(error, "getEventTournamentFormatOptions");
  }
}
