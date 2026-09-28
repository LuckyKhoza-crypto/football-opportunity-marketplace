import "server-only";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  addEventParticipantsToTournament,
  createEventTournament,
  finalizeEventTournament,
  getEventTournamentBracket,
  getEventTournamentFormatOptions,
  getEventTournamentSummary,
  isTournamentComplete,
  reportEventMatchResult,
  startEventTournament,
} from "@/lib/integrations/tournament";
import type {
  EventTournamentBracket,
  EventTournamentFormatOption,
  EventTournamentParticipant,
  EventTournamentSummary,
  ReportEventMatchResultInput,
  Tournament,
  TournamentConfig,
  TournamentMatch,
} from "@/lib/integrations/tournament";
// The pure provider-neutral helpers, imported directly: they do no I/O, so the
// API layer validates the request body with exactly the same functions the
// service uses (no second implementation to drift).
import {
  isMatchReference,
  isValidMatchScoreValue,
  toMatchReference,
  toTournamentConfig,
} from "@/lib/integrations/tournament/contract";
import {
  TOURNAMENT_NOT_LINKED_CODE,
  UNMAPPED_PARTICIPANT_NAME,
  type TournamentViewBracket,
  type TournamentViewFinalization,
  type TournamentViewFormatOption,
  type TournamentViewMatch,
  type TournamentViewMatchSide,
  type TournamentViewStatus,
  type TournamentViewSummary,
} from "@/types/competition-tournament";

/**
 * TOURN-002 — Tournament management route handlers.
 * TOURN-003 — match result reporting, explicit finalization and the champion.
 *
 * The App Router route files under app/api/competitions/[id]/tournament/** are
 * thin wrappers around these handlers (the same convention as
 * lib/competition-api.ts / lib/competition-drawing-api.ts). Every handler:
 *
 *   1. authenticates (NextAuth session),
 *   2. calls ONE existing TOURN-001/003 service function (which authorizes with
 *      the existing `canManageEvent` rule — event creator or assigned ambassador),
 *   3. maps the discriminated result onto the project's HTTP conventions,
 *   4. returns a PROVIDER-NEUTRAL payload.
 *
 * There is no business logic, no Supabase access and no provider access here:
 * the provider abstraction and the FOM↔provider mapping stay in the tournament
 * service, so the browser only ever sees FOM vocabulary.
 *
 * THE CLIENT'S INPUTS are deliberately small:
 *   * creating a tournament — the tournament format (TOURN-002A);
 *   * reporting a result — FOM's match reference, the winning
 *     `competition_participants.id` and the two scores (TOURN-003). Provider
 *     participant ids, provider match ids and provider score fields are not
 *     accepted from the browser at all — the service resolves them.
 *   * finalizing — nothing: the server decides which tournament it is.
 * Everything else in a body (provider, slug, tournament name, participants,
 * provider ids) is ignored, and every other decision — the provider, the slug,
 * the tournament name, the mapped participants, the bracket, advancement and the
 * champion — is resolved server-side or by the provider, so the browser can never
 * influence or discover which tournament engine is used.
 */

async function requireProfileId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}

/** Any service failure keeps the service's own message and HTTP status. */
function failureResponse(result: { error: string; status: number }): NextResponse {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

/**
 * The summary/bracket read endpoints answer `409` when the competition has no
 * tournament yet. That is a state the UI renders (not an error), so it carries
 * a machine-readable `code` alongside the service's message.
 *
 * The summary additionally reports WHICH FORMATS may be chosen, because that
 * response is what the UI renders the creation form from (see
 * `loadTournamentFormatOptions`). It is the same request the panel already
 * makes, so no extra route or round-trip is needed — and the list comes from the
 * provider adapter, never from the browser.
 */
function notLinkedResponse(
  error: string,
  formats?: TournamentViewFormatOption[],
): NextResponse {
  return NextResponse.json(
    {
      error,
      code: TOURNAMENT_NOT_LINKED_CODE,
      ...(formats ? { formats } : {}),
    },
    { status: 409 },
  );
}

function internalErrorResponse(context: string, err: unknown): NextResponse {
  console.error(`${context} error:`, err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** A requested format FOM does not model is a client error, never a default. */
function invalidFormatResponse(format: unknown): NextResponse {
  return NextResponse.json(
    {
      error: `Unsupported tournament format "${String(format)}"`,
    },
    { status: 400 },
  );
}

// ── Request mapping (the client's format choice) ────────────────

/**
 * The parsed request body, or `{}` when there is no usable body.
 *
 * A bodyless request (the previous behaviour, and how a server-side caller may
 * post) and a malformed/non-object body both mean "no configuration given",
 * which `toTournamentConfig` turns into the default. Only a body carrying a
 * format FOM does not model is an error.
 */
async function readRequestBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.body) return {};

  try {
    const parsed: unknown = await request.json();
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// ── Neutral view mapping (provider ids never leave this module) ──

function toStatusView(
  tournament: Tournament,
  config: TournamentConfig,
): TournamentViewStatus {
  return {
    name: tournament.name,
    // FOM's recorded configuration: what the organiser chose (and what FOM will
    // act on later), expressed in FOM vocabulary.
    format: config.format,
    state: tournament.state,
    isComplete: isTournamentComplete(tournament),
    completedAt: tournament.completedAt,
  };
}

/** A format capability, copied field by field so nothing else can leak. */
function toFormatOptionView(
  option: EventTournamentFormatOption,
): TournamentViewFormatOption {
  return { format: option.format, supported: option.supported };
}

/**
 * The formats the organiser may choose, or an empty list when the capability
 * cannot be determined.
 *
 * Deliberately never throws: the read endpoint must still report "not linked"
 * even if capability resolution fails. An empty list makes the UI offer nothing
 * (and explain why) rather than guess at a format.
 */
async function loadTournamentFormatOptions(
  eventId: string,
  profileId: string,
): Promise<TournamentViewFormatOption[]> {
  try {
    const result = await getEventTournamentFormatOptions(eventId, profileId);
    if (!result.ok) return [];
    return result.data.map(toFormatOptionView);
  } catch (err) {
    console.error("Tournament format options error:", err);
    return [];
  }
}

function toSummaryView(summary: EventTournamentSummary): TournamentViewSummary {
  return {
    ...toStatusView(summary.tournament, summary.config),
    isComplete: summary.isComplete,
    openMatchCount: summary.openMatchCount,
    winnerParticipantId: summary.winnerParticipantId,
  };
}

/**
 * Resolve one side of a match to `competition_participants.id` + display name.
 *
 * provider participant ids never leave this module: an unmapped provider
 * participant is shown by a neutral placeholder instead. `null` means the side
 * is genuinely undecided (the provider has not fed this match yet).
 */
function createSideResolver(participants: EventTournamentParticipant[]) {
  const participantsById = new Map<
    string,
    TournamentViewBracket["participants"][number]
  >();

  for (const participant of participants) {
    participantsById.set(participant.providerParticipantId, {
      participantId: participant.participantId,
      name: participant.displayName,
    });
  }

  return function sideOf(
    providerParticipantId: string | null,
  ): TournamentViewMatchSide {
    if (!providerParticipantId) {
      return { participantId: null, name: null };
    }

    const mapped = participantsById.get(providerParticipantId);
    if (!mapped) {
      // Present on the provider but not mapped to a FOM participant.
      return { participantId: null, name: UNMAPPED_PARTICIPANT_NAME };
    }

    return { participantId: mapped.participantId, name: mapped.name };
  };
}

/** Resolves one side of a provider match to the FOM view. */
type MatchSideResolver = (
  providerParticipantId: string | null,
) => TournamentViewMatchSide;

/**
 * Translate one provider match into the provider-neutral view: both sides and
 * the winner are resolved to FOM participants, the provider's match id is dropped
 * (FOM's own `matchRef` replaces it) and the score is copied field by field.
 */
function toMatchView(
  match: TournamentMatch,
  sideOf: MatchSideResolver,
): TournamentViewMatch {
  const participant1 = sideOf(match.participant1Id);
  const participant2 = sideOf(match.participant2Id);

  return {
    // FOM addresses a result by this reference; it is built from the provider's
    // round and FOM participant ids only (see `toMatchReference`).
    matchRef: toMatchReference({
      round: match.round,
      participant1Id: participant1.participantId,
      participant2Id: participant2.participantId,
    }),
    round: match.round,
    state: match.state,
    participant1,
    participant2,
    score: match.score
      ? {
          participant1Score: match.score.participant1Score,
          participant2Score: match.score.participant2Score,
        }
      : null,
    winner: match.winnerParticipantId ? sideOf(match.winnerParticipantId) : null,
  };
}

/**
 * Translate the service's bracket into the provider-neutral view: provider
 * participant ids are resolved to `competition_participants.id` + display name,
 * and provider match ids are dropped entirely.
 */
function toBracketView(bracket: EventTournamentBracket): TournamentViewBracket {
  const sideOf = createSideResolver(bracket.participants);

  return {
    tournamentState: bracket.tournament.state,
    participants: bracket.participants.map((participant) => ({
      participantId: participant.participantId,
      name: participant.displayName,
    })),
    matches: bracket.matches.map((match) => toMatchView(match, sideOf)),
  };
}

// ── POST /api/competitions/[id]/tournament ─────────────────────
// Create/link the competition's external tournament with the organiser's chosen
// format. The format is the client's ONLY input; everything else is resolved
// server-side.
export async function createTournamentHandler(
  request: Request,
  eventId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) return unauthorizedResponse();

    // Never trust the client: an unmodellable format is rejected here, and the
    // service validates it (and the provider's capability) again.
    const body = await readRequestBody(request);
    const config = toTournamentConfig(body);
    if (!config) return invalidFormatResponse(body.format);

    const result = await createEventTournament(eventId, profileId, { config });
    if (!result.ok) return failureResponse(result);

    return NextResponse.json(
      { tournament: toStatusView(result.data.tournament, result.data.config) },
      { status: 201 },
    );
  } catch (err) {
    return internalErrorResponse("Tournament creation", err);
  }
}

// ── GET /api/competitions/[id]/tournament ──────────────────────
// Read the tournament status. `409` + `code: "not_linked"` = no tournament yet,
// in which case the response also carries the formats that may be created.
export async function getTournamentSummaryHandler(
  _request: Request,
  eventId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) return unauthorizedResponse();

    const result = await getEventTournamentSummary(eventId, profileId);
    if (!result.ok) {
      if (result.status === 409) {
        // No tournament yet: this is the response the panel renders the creation
        // form from, so it carries the provider's format capabilities.
        const formats = await loadTournamentFormatOptions(eventId, profileId);
        return notLinkedResponse(result.error, formats);
      }
      return failureResponse(result);
    }

    return NextResponse.json({ tournament: toSummaryView(result.data) });
  } catch (err) {
    return internalErrorResponse("Tournament summary", err);
  }
}

// ── POST /api/competitions/[id]/tournament/participants ────────
// Push the competition's unmapped participants onto the tournament.
export async function syncTournamentParticipantsHandler(
  _request: Request,
  eventId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) return unauthorizedResponse();

    const result = await addEventParticipantsToTournament(eventId, profileId);
    if (!result.ok) return failureResponse(result);

    const synced = result.data.added.length;
    const alreadyMapped = result.data.skipped;

    return NextResponse.json({
      synced,
      alreadyMapped,
      total: synced + alreadyMapped,
    });
  } catch (err) {
    return internalErrorResponse("Tournament participant sync", err);
  }
}

// ── POST /api/competitions/[id]/tournament/start ───────────────
// Start the tournament (generates the bracket). Idempotent on the provider side.
export async function startTournamentHandler(
  _request: Request,
  eventId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) return unauthorizedResponse();

    const result = await startEventTournament(eventId, profileId);
    if (!result.ok) return failureResponse(result);

    return NextResponse.json({
      started: result.data.started,
      tournament: toStatusView(result.data.tournament, result.data.config),
    });
  } catch (err) {
    return internalErrorResponse("Tournament start", err);
  }
}

// ── GET /api/competitions/[id]/tournament/matches ──────────────
// Read the read-only bracket (matches + mapped participants).
export async function getTournamentMatchesHandler(
  _request: Request,
  eventId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) return unauthorizedResponse();

    const result = await getEventTournamentBracket(eventId, profileId);
    if (!result.ok) {
      if (result.status === 409) return notLinkedResponse(result.error);
      return failureResponse(result);
    }

    return NextResponse.json(toBracketView(result.data));
  } catch (err) {
    return internalErrorResponse("Tournament matches", err);
  }
}

// ── Request mapping (the client's result) ───────────────────────

type ReportResultParse =
  | { ok: true; input: ReportEventMatchResultInput }
  | { ok: false; error: string };

/**
 * Read the provider-neutral result the browser submitted.
 *
 * Only three values are read — FOM's match reference (from the URL), the winning
 * `competition_participants.id` and the two scores — and they are validated with
 * the SAME helpers the service uses. Anything else in the body (a provider
 * participant id, a provider match id, a provider score field, ...) is ignored:
 * none of it can address a match or select a winner, so the browser can neither
 * influence nor discover the tournament provider.
 */
function toReportResultInput(
  body: Record<string, unknown>,
  matchRef: string,
): ReportResultParse {
  if (!isMatchReference(matchRef)) {
    return { ok: false, error: "A valid match reference is required" };
  }

  const winnerParticipantId =
    typeof body.winnerParticipantId === "string"
      ? body.winnerParticipantId.trim()
      : "";
  if (!winnerParticipantId) {
    return { ok: false, error: "A winning participant is required" };
  }

  if (
    !isValidMatchScoreValue(body.participant1Score) ||
    !isValidMatchScoreValue(body.participant2Score)
  ) {
    return {
      ok: false,
      error: "Match scores must be whole, non-negative numbers",
    };
  }

  // FOM tournaments do not model draws — never invent a tie-break here.
  if (body.participant1Score === body.participant2Score) {
    return {
      ok: false,
      error:
        "A match result needs a decisive score: this tournament does not support draws",
    };
  }

  return {
    ok: true,
    input: {
      matchRef,
      winnerParticipantId,
      participant1Score: body.participant1Score,
      participant2Score: body.participant2Score,
    },
  };
}

// ── POST /api/competitions/[id]/tournament/matches/[matchId]/result ──
// Report one match result. The provider advances the winner; FOM only reads the
// bracket again afterwards (GET .../matches), so the UI can show the updated
// round without FOM ever calculating a bracket.
export async function reportMatchResultHandler(
  request: Request,
  eventId: string,
  matchRef: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) return unauthorizedResponse();

    const body = await readRequestBody(request);
    const parsed = toReportResultInput(body, matchRef);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await reportEventMatchResult(eventId, profileId, parsed.input);
    if (!result.ok) return failureResponse(result);

    return NextResponse.json({
      match: toMatchView(
        result.data.match,
        createSideResolver(result.data.participants),
      ),
    });
  } catch (err) {
    return internalErrorResponse("Tournament match result", err);
  }
}

// ── POST /api/competitions/[id]/tournament/finalize ────────────
// Explicitly finalize the tournament (the provider's engine requires it after the
// last result) and report the champion. Whether the tournament MAY be finalized
// is the provider's decision — a refusal is surfaced as an honest,
// provider-neutral error rather than guessed at here.
export async function finalizeTournamentHandler(
  _request: Request,
  eventId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) return unauthorizedResponse();

    const result = await finalizeEventTournament(eventId, profileId);
    if (!result.ok) return failureResponse(result);

    const payload: TournamentViewFinalization = {
      finalized: result.data.finalized,
      winnerParticipantId: result.data.winnerParticipantId,
      tournament: toStatusView(result.data.tournament, result.data.config),
    };

    return NextResponse.json(payload);
  } catch (err) {
    return internalErrorResponse("Tournament finalization", err);
  }
}

