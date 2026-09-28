/**
 * TOURN-001 — Challonge v1 tournament provider adapter (server-only).
 *
 * THIS FILE IS THE ONLY PLACE IN FOM THAT KNOWS CHALLONGE EXISTS.
 *
 * Everything Challonge-specific lives here: the API base URL, `api_key` query
 * authentication, the endpoint paths, the request/response envelopes
 * (`{ tournament: ... }`, `{ match: ... }`, `[{ participant: ... }]`), the
 * `scores_csv` / `player1_id` / `winner_id` field names, Challonge's tournament
 * states (`pending`, `underway`, `awaiting_review`, `complete`, ...) and the
 * required finalize step. None of those words may leak past this file.
 *
 * Behaviour implemented here was verified live against the real API by the
 * isolated POC (`lib/integrations/challonge-poc/`), which remains untouched as
 * the evidence artefact:
 *
 *   POST /tournaments.json                                  create
 *   GET  /tournaments/{id}.json                             read
 *   POST /tournaments/{id}/participants/bulk_add.json       add participants
 *   GET  /tournaments/{id}/participants.json                read participants
 *   POST /tournaments/{id}/start.json                       start
 *   GET  /tournaments/{id}/matches.json                     read matches
 *   PUT  /tournaments/{id}/matches/{match_id}.json          submit a result
 *   POST /tournaments/{id}/finalize.json                    finalize
 *
 * SECURITY:
 * - The API key is read from the server-only environment at call time and is
 *   only ever sent to Challonge as the `api_key` query parameter.
 * - The key is NEVER logged and never included in an error message. Error
 *   messages use the METHOD + PATH only (never the URL, which carries the key),
 *   and provider-supplied text is scrubbed of `api_key=...` before it is
 *   attached to an error.
 */

import "server-only";
import { getChallongeApiKey } from "@/lib/integrations/tournament/config";
import { TOURNAMENT_FORMATS } from "@/lib/integrations/tournament/contract";
import { TournamentProviderError } from "@/lib/integrations/tournament/errors";
import type {
  CreateTournamentInput,
  ProviderParticipantView,
  ReportMatchResultInput,
  Tournament,
  TournamentFormat,
  TournamentMatch,
  TournamentMatchScore,
  TournamentMatchState,
  TournamentParticipant,
  TournamentParticipantRef,
  TournamentProvider,
  TournamentState,
  TournamentWinner,
} from "@/lib/integrations/tournament/types";

export const CHALLONGE_PROVIDER_ID = "challonge";

/** Challonge v1 API base URL — the version verified by the POC. */
export const CHALLONGE_API_BASE_URL = "https://api.challonge.com/v1";

/** Challonge v1's name for the single-elimination format verified by the POC. */
export const CHALLONGE_SINGLE_ELIMINATION_TYPE = "single elimination";

/**
 * Formats this adapter can actually CREATE, mapped to their Challonge v1
 * `tournament_type`.
 *
 * Only formats whose creation is verified are listed. A format that is missing
 * here is REFUSED by `createTournament` — never mapped onto a format that is
 * present — so FOM can never pretend an unsupported format was created.
 *
 * This map is the single source of truth for the adapter's capability
 * (`CHALLONGE_SUPPORTED_FORMATS` and `supportsFormat`), which is what keeps the
 * advertised capabilities and the creation request from drifting apart.
 */
const CHALLONGE_TOURNAMENT_TYPES: Partial<Record<TournamentFormat, string>> = {
  single_elimination: CHALLONGE_SINGLE_ELIMINATION_TYPE,
};

/** Formats this adapter can create today (derived from the map above). */
export const CHALLONGE_SUPPORTED_FORMATS: TournamentFormat[] =
  TOURNAMENT_FORMATS.filter(challongeSupportsFormat);

/**
 * Challonge v1 `tournament_type` values FOM can TRANSLATE when reading.
 *
 * Reading is not creating: a tournament FOM cannot create (for example one made
 * by hand on the provider's site) must still be described honestly instead of
 * being reported as single elimination — and `group_stage_knockout` is
 * deliberately absent because v1 has no such type, so an unexpected value is
 * still rejected rather than guessed at.
 */
const CHALLONGE_FORMAT_NAMES: Record<string, TournamentFormat> = {
  singleelimination: "single_elimination",
  doubleelimination: "double_elimination",
  roundrobin: "round_robin",
  swiss: "swiss",
};

/** Whether this adapter can create a tournament in the given format. */
export function challongeSupportsFormat(format: TournamentFormat): boolean {
  return CHALLONGE_TOURNAMENT_TYPES[format] !== undefined;
}

/** Retry backoff for throttled (429) and server-error (5xx) responses. */
const DEFAULT_RETRY_DELAYS_MS = [500, 1000];

/** Cap on provider error text copied into an error message. */
const MAX_ERROR_DETAIL_LENGTH = 200;

/** Cap on a `retry-after` driven wait, so a bad header cannot stall FOM. */
const MAX_RETRY_AFTER_MS = 5_000;

// ---------------------------------------------------------------------------
// Raw Challonge response shapes (deliberately minimal and untrusted)
// ---------------------------------------------------------------------------

interface ChallongeTournament {
  id: number | string;
  name?: string | null;
  url?: string | null;
  state?: string | null;
  tournament_type?: string | null;
  full_challonge_url?: string | null;
  completed_at?: string | null;
}

interface ChallongeParticipant {
  id: number | string;
  name?: string | null;
}

interface ChallongeMatch {
  id: number | string;
  round?: number | null;
  player1_id?: number | string | null;
  player2_id?: number | string | null;
  winner_id?: number | string | null;
  state?: string | null;
  scores_csv?: string | null;
}

// ---------------------------------------------------------------------------
// Request layer
// ---------------------------------------------------------------------------

type HttpMethod = "GET" | "POST" | "PUT";

interface ChallongeRequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

interface ChallongeRequestContext {
  baseUrl: string;
  retryDelaysMs: number[];
}

/** Options for the adapter factory. Kept deliberately tiny (no DI framework). */
export interface ChallongeProviderOptions {
  /** Override the API base URL (used by tests). */
  baseUrl?: string;
  /** Backoff delays in ms; its length also sets the number of extra attempts. */
  retryDelaysMs?: number[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(response: Response, fallbackMs: number): number {
  const retryAfter = Number(response.headers?.get?.("retry-after") ?? "0");
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
  }
  return fallbackMs;
}

/**
 * Scrub anything that looks like an API key out of provider-supplied text.
 * Defence-in-depth: error text should never be able to carry the credential.
 */
export function sanitizeProviderDetail(text: string): string {
  return String(text ?? "")
    .replace(/api_key=[^&\s"'<>]+/gi, "api_key=***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_DETAIL_LENGTH);
}

/**
 * Extract a short, safe detail string from a provider error body.
 * Challonge returns `{"errors":["url has already been taken"]}`; anything else
 * falls back to a truncated raw body.
 */
export function extractProviderDetail(rawBody: string): string {
  const text = String(rawBody ?? "").trim();
  if (!text) return "";

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const detail = parsed.errors ?? parsed.error ?? parsed;
    return sanitizeProviderDetail(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  } catch {
    return sanitizeProviderDetail(text);
  }
}

function toProviderError(
  status: number,
  method: HttpMethod,
  path: string,
  rawBody: string,
): TournamentProviderError {
  const detail = extractProviderDetail(rawBody);
  const suffix = detail ? `: ${detail}` : ".";
  const base = { status, providerId: CHALLONGE_PROVIDER_ID };

  if (status === 401 || status === 403) {
    return new TournamentProviderError(
      "provider_auth_failed",
      `The tournament provider rejected the server credentials (HTTP ${status} on ${method} ${path})${suffix}`,
      base,
    );
  }

  if (status === 404) {
    return new TournamentProviderError(
      "provider_not_found",
      `The tournament provider has no such object (HTTP 404 on ${method} ${path}).`,
      base,
    );
  }

  if (status === 429 || status >= 500) {
    return new TournamentProviderError(
      "provider_unavailable",
      `The tournament provider is unavailable (HTTP ${status} on ${method} ${path})${suffix}`,
      base,
    );
  }

  return new TournamentProviderError(
    "provider_invalid_request",
    `The tournament provider rejected the request (HTTP ${status} on ${method} ${path})${suffix}`,
    base,
  );
}

/**
 * Perform an authenticated Challonge v1 request.
 *
 * Throttled (429) and server-error (5xx) responses are retried a bounded number
 * of times with backoff, honouring `retry-after`. Every non-2xx response becomes
 * a typed TournamentProviderError — this function never returns a value that
 * could be mistaken for success.
 */
async function challongeRequest<T>(
  ctx: ChallongeRequestContext,
  method: HttpMethod,
  path: string,
  options: ChallongeRequestOptions = {},
): Promise<T> {
  const apiKey = getChallongeApiKey();

  const url = new URL(ctx.baseUrl + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  // Challonge v1 authentication. The URL is never logged.
  url.searchParams.set("api_key", apiKey);

  const headers: Record<string, string> = { accept: "application/json" };
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const maxAttempts = ctx.retryDelaysMs.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (cause) {
      throw new TournamentProviderError(
        "provider_request_failed",
        `The tournament provider could not be reached (${method} ${path}).`,
        { providerId: CHALLONGE_PROVIDER_ID, cause },
      );
    }

    if (isRetryableStatus(response.status) && attempt < maxAttempts) {
      await sleep(retryDelayMs(response, ctx.retryDelaysMs[attempt - 1] ?? 0));
      continue;
    }

    const text = await response.text();

    if (!response.ok) {
      throw toProviderError(response.status, method, path, text);
    }

    if (!text) return null as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new TournamentProviderError(
        "provider_response_invalid",
        `The tournament provider returned a malformed JSON response (${method} ${path}).`,
        { status: response.status, providerId: CHALLONGE_PROVIDER_ID },
      );
    }
  }

  // Every attempt was retryable and none succeeded.
  throw new TournamentProviderError(
    "provider_unavailable",
    `The tournament provider is unavailable (${method} ${path}).`,
    { providerId: CHALLONGE_PROVIDER_ID },
  );
}

// ---------------------------------------------------------------------------
// Translation: Challonge → FOM-neutral
// ---------------------------------------------------------------------------

/**
 * Challonge v1 tournament states mapped onto FOM's lifecycle.
 * Unmodelled states become `unknown` rather than being silently coerced.
 */
const CHALLONGE_TOURNAMENT_STATES: Record<string, TournamentState> = {
  pending: "created",
  checking_in: "created",
  checked_in: "created",
  started: "started",
  underway: "started",
  awaiting_review: "started",
  awaiting_verification: "started",
  group_stages_underway: "started",
  group_stages_awaiting_review: "started",
  group_stages_complete: "started",
  complete: "completed",
  completed: "completed",
};

/** Challonge v1 match states mapped onto FOM's match lifecycle. */
const CHALLONGE_TOURNAMENT_MATCH_STATES: Record<string, TournamentMatchState> = {
  pending: "pending",
  open: "ready",
  complete: "completed",
  completed: "completed",
};

export function toTournamentState(state: unknown): TournamentState {
  const key = String(state ?? "").toLowerCase().trim().replace(/\s+/g, "_");
  return CHALLONGE_TOURNAMENT_STATES[key] ?? "unknown";
}

export function toMatchState(state: unknown): TournamentMatchState {
  const key = String(state ?? "").toLowerCase().trim();
  return CHALLONGE_TOURNAMENT_MATCH_STATES[key] ?? "unknown";
}

/**
 * Map Challonge's `tournament_type` onto a FOM format.
 *
 * `formatHint` is used only when the provider omits the field (for example on a
 * creation response), which keeps FOM's own request authoritative.
 *
 * A type FOM has no value for is reported as an invalid provider response
 * instead of being guessed at or coerced into single elimination. Note that
 * TRANSLATING a format here does not make it creatable — see
 * `toChallongeTournamentType` and `challongeSupportsFormat`.
 */
export function toTournamentFormat(
  type: unknown,
  formatHint?: TournamentFormat,
): TournamentFormat {
  const normalized = String(type ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

  if (!normalized) {
    if (formatHint) return formatHint;
    throw new TournamentProviderError(
      "provider_response_invalid",
      "The tournament provider did not report a tournament format.",
      { providerId: CHALLONGE_PROVIDER_ID },
    );
  }

  const format = CHALLONGE_FORMAT_NAMES[normalized];
  if (format) return format;

  throw new TournamentProviderError(
    "provider_response_invalid",
    "The tournament provider returned a tournament format FOM does not support.",
    { providerId: CHALLONGE_PROVIDER_ID },
  );
}

/**
 * FOM format → Challonge `tournament_type`, for CREATION only.
 *
 * Only formats this adapter can actually create are mapped; every other format
 * (modelled by FOM or not) is refused, so an unsupported format can never be
 * turned into a supported one on the provider's side.
 */
export function toChallongeTournamentType(format: TournamentFormat): string {
  const tournamentType = CHALLONGE_TOURNAMENT_TYPES[format];

  if (tournamentType) return tournamentType;

  throw new TournamentProviderError(
    "tournament_invalid_input",
    `The tournament format "${String(format)}" is not supported.`,
    { providerId: CHALLONGE_PROVIDER_ID },
  );
}

/**
 * Translate a Challonge match score into FOM's paired score.
 *
 * Challonge encodes scores as a CSV string ("3-1", or "3-1,2-1" for multi-leg
 * matches). FOM models a single paired score, so only the first leg is mapped —
 * FOM always submits a single leg. An unparseable value yields null (an
 * unplayed/unknown score) rather than a fabricated one.
 */
export function toMatchScore(scoresCsv: unknown): TournamentMatchScore | null {
  if (typeof scoresCsv !== "string" || scoresCsv.trim() === "") return null;

  const firstLeg = scoresCsv.split(",")[0]?.trim() ?? "";
  const parsed = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(firstLeg);
  if (!parsed) return null;

  return {
    participant1Score: Number(parsed[1]),
    participant2Score: Number(parsed[2]),
  };
}

/** FOM's paired score → the Challonge `scores_csv` wire format. */
export function toChallongeScoresCsv(score: TournamentMatchScore): string {
  return `${score.participant1Score}-${score.participant2Score}`;
}

function toOptionalId(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function toTournamentMatch(raw: ChallongeMatch): TournamentMatch {
  if (!raw || raw.id === null || raw.id === undefined) {
    throw new TournamentProviderError(
      "provider_response_invalid",
      "The tournament provider returned a match without an id.",
      { providerId: CHALLONGE_PROVIDER_ID },
    );
  }

  return {
    matchId: String(raw.id),
    round: Number.isFinite(raw.round) ? Number(raw.round) : 0,
    participant1Id: toOptionalId(raw.player1_id),
    participant2Id: toOptionalId(raw.player2_id),
    state: toMatchState(raw.state),
    score: toMatchScore(raw.scores_csv),
    winnerParticipantId: toOptionalId(raw.winner_id),
  };
}

export function toTournament(
  raw: ChallongeTournament,
  options?: { formatHint?: TournamentFormat },
): Tournament {
  if (!raw || raw.id === null || raw.id === undefined) {
    throw new TournamentProviderError(
      "provider_response_invalid",
      "The tournament provider returned a tournament without an id.",
      { providerId: CHALLONGE_PROVIDER_ID },
    );
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const externalUrl =
    typeof raw.full_challonge_url === "string" && raw.full_challonge_url.trim()
      ? raw.full_challonge_url.trim()
      : null;

  return {
    providerTournamentId: String(raw.id),
    name,
    format: toTournamentFormat(raw.tournament_type, options?.formatHint),
    state: toTournamentState(raw.state),
    externalUrl,
    completedAt:
      typeof raw.completed_at === "string" && raw.completed_at.trim()
        ? raw.completed_at
        : null,
  };
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

function encodeId(value: string): string {
  return encodeURIComponent(String(value ?? "").trim());
}

function responseInvalid(message: string): TournamentProviderError {
  return new TournamentProviderError("provider_response_invalid", message, {
    providerId: CHALLONGE_PROVIDER_ID,
  });
}

function requireTournament(
  response: { tournament?: ChallongeTournament } | null,
  context: string,
): ChallongeTournament {
  const tournament = response?.tournament;
  if (!tournament) {
    throw responseInvalid(
      `The tournament provider did not return a tournament (${context}).`,
    );
  }
  return tournament;
}

function requireArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw responseInvalid(
      `The tournament provider returned an unexpected response (${context}).`,
    );
  }
  return value;
}

/**
 * Challonge participant ids are integers; they are sent back as numbers when
 * they look numeric so the v1 API receives the type it expects.
 */
function toChallongeParticipantId(value: string): number | string {
  return /^\d+$/.test(value) ? Number(value) : value;
}

/**
 * Create a Challonge v1 provider adapter.
 *
 * The returned object implements the FOM TournamentProvider contract; it is the
 * only thing FOM code ever receives, so no caller can reach Challonge directly.
 */
export function createChallongeProvider(
  options: ChallongeProviderOptions = {},
): TournamentProvider {
  const ctx: ChallongeRequestContext = {
    baseUrl: options.baseUrl ?? CHALLONGE_API_BASE_URL,
    retryDelaysMs: options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
  };

  function notFound(providerTournamentId: string): TournamentProviderError {
    return new TournamentProviderError(
      "provider_not_found",
      `The tournament provider has no tournament "${providerTournamentId}".`,
      { status: 404, providerId: CHALLONGE_PROVIDER_ID },
    );
  }

  /** Read a raw tournament, mapping a definitive 404 to null. */
  async function fetchTournament(
    providerTournamentId: string,
  ): Promise<ChallongeTournament | null> {
    try {
      const response = await challongeRequest<{
        tournament: ChallongeTournament;
      }>(ctx, "GET", `/tournaments/${encodeId(providerTournamentId)}.json`);
      return requireTournament(response, "read tournament");
    } catch (error) {
      if (
        error instanceof TournamentProviderError &&
        error.code === "provider_not_found"
      ) {
        return null;
      }
      throw error;
    }
  }

  async function fetchMatches(
    providerTournamentId: string,
  ): Promise<TournamentMatch[]> {
    const response = await challongeRequest<unknown>(
      ctx,
      "GET",
      `/tournaments/${encodeId(providerTournamentId)}/matches.json`,
    );

    return requireArray(response, "list matches").map((row) => {
      const match = (row as { match?: ChallongeMatch } | null)?.match;
      if (!match) {
        throw responseInvalid(
          "The tournament provider returned a match entry without a match.",
        );
      }
      return toTournamentMatch(match);
    });
  }

  /**
   * Derive the winning side from the scores when the caller did not name one.
   * A level score without an explicit winner is rejected: FOM tournaments do not
   * model draws, and reporting one would leave the provider's bracket stuck.
   */
  async function resolveWinner(
    providerTournamentId: string,
    matchId: string,
    score: TournamentMatchScore,
  ): Promise<string> {
    const matches = await fetchMatches(providerTournamentId);
    const match = matches.find((candidate) => candidate.matchId === matchId);

    if (!match) {
      throw new TournamentProviderError(
        "provider_not_found",
        `The tournament provider has no match "${matchId}" in this tournament.`,
        { status: 404, providerId: CHALLONGE_PROVIDER_ID },
      );
    }

    if (score.participant1Score > score.participant2Score) {
      if (!match.participant1Id) {
        throw responseInvalid(
          "The match has no participant on side 1 to attribute the win to.",
        );
      }
      return match.participant1Id;
    }

    if (score.participant2Score > score.participant1Score) {
      if (!match.participant2Id) {
        throw responseInvalid(
          "The match has no participant on side 2 to attribute the win to.",
        );
      }
      return match.participant2Id;
    }

    throw new TournamentProviderError(
      "tournament_invalid_input",
      "A match result needs a decisive winner: the scores are level and no winner was given.",
      { providerId: CHALLONGE_PROVIDER_ID },
    );
  }

  return {
    id: CHALLONGE_PROVIDER_ID,

    /**
     * Only the formats this adapter can actually create are advertised; the UI
     * offers exactly these and the service refuses anything else.
     */
    supportsFormat(format: TournamentFormat): boolean {
      return challongeSupportsFormat(format);
    },

    async createTournament(input: CreateTournamentInput): Promise<Tournament> {
      const response = await challongeRequest<{
        tournament: ChallongeTournament;
      }>(ctx, "POST", "/tournaments.json", {
        body: {
          tournament: {
            name: input.name,
            url: input.slug,
            // FOM's neutral configuration is translated HERE and nowhere else.
            tournament_type: toChallongeTournamentType(input.config.format),
            // FOM brackets are private to the organiser by default (as in the POC).
            private: true,
          },
        },
      });

      return toTournament(requireTournament(response, "create tournament"), {
        formatHint: input.config.format,
      });
    },

    async getTournament(
      providerTournamentId: string,
    ): Promise<Tournament | null> {
      const raw = await fetchTournament(providerTournamentId);
      return raw ? toTournament(raw) : null;
    },

    async addParticipants(
      providerTournamentId: string,
      participants: TournamentParticipantRef[],
    ): Promise<TournamentParticipant[]> {
      if (participants.length === 0) return [];

      const response = await challongeRequest<unknown>(
        ctx,
        "POST",
        `/tournaments/${encodeId(providerTournamentId)}/participants/bulk_add.json`,
        {
          body: {
            participants: participants.map((p) => ({ name: p.displayName })),
          },
        },
      );

      const rows = requireArray(response, "add participants").map(
        (row) =>
          (row as { participant?: ChallongeParticipant } | null)?.participant ??
          null,
      );

      // A different count means the response cannot be correlated safely;
      // refusing to map is safer than attaching a wrong provider id.
      if (rows.length !== participants.length) {
        throw responseInvalid(
          `The tournament provider confirmed ${rows.length} of ${participants.length} participants. No mapping was saved.`,
        );
      }

      return rows.map((raw, index) => {
        const ref = participants[index];
        if (!raw || raw.id === null || raw.id === undefined) {
          throw responseInvalid(
            `The tournament provider returned an unexpected participant at position ${index + 1}. No mapping was saved.`,
          );
        }
        // Defensive ordering check — the provider echoes submitted names in order.
        if (typeof raw.name === "string" && raw.name !== ref.displayName) {
          throw responseInvalid(
            `The tournament provider returned participants in an unexpected order (position ${index + 1}). No mapping was saved.`,
          );
        }
        return { ref: ref.ref, providerParticipantId: String(raw.id) };
      });
    },

    async getParticipants(
      providerTournamentId: string,
    ): Promise<ProviderParticipantView[]> {
      const response = await challongeRequest<unknown>(
        ctx,
        "GET",
        `/tournaments/${encodeId(providerTournamentId)}/participants.json`,
      );

      return requireArray(response, "list participants").map((row) => {
        const participant = (
          row as { participant?: ChallongeParticipant } | null
        )?.participant;
        if (
          !participant ||
          participant.id === null ||
          participant.id === undefined
        ) {
          throw responseInvalid(
            "The tournament provider returned a participant without an id.",
          );
        }
        return {
          providerParticipantId: String(participant.id),
          displayName:
            typeof participant.name === "string" ? participant.name : "",
        };
      });
    },

    async startTournament(providerTournamentId: string): Promise<Tournament> {
      await challongeRequest<unknown>(
        ctx,
        "POST",
        `/tournaments/${encodeId(providerTournamentId)}/start.json`,
      );

      // The start response envelope is not relied upon; the authoritative state
      // is read back (the POC did the same) so FOM always sees real state.
      const raw = await fetchTournament(providerTournamentId);
      if (!raw) throw notFound(providerTournamentId);
      return toTournament(raw);
    },

    async getMatches(providerTournamentId: string): Promise<TournamentMatch[]> {
      return fetchMatches(providerTournamentId);
    },

    async reportMatchResult(
      providerTournamentId: string,
      result: ReportMatchResultInput,
    ): Promise<TournamentMatch> {
      const matchId = String(result.matchId ?? "").trim();
      if (!matchId) {
        throw new TournamentProviderError(
          "tournament_invalid_input",
          "A match id is required to report a result.",
          { providerId: CHALLONGE_PROVIDER_ID },
        );
      }

      const score: TournamentMatchScore = {
        participant1Score: result.participant1Score,
        participant2Score: result.participant2Score,
      };

      const explicitWinner = String(result.winnerParticipantId ?? "").trim();
      const winnerParticipantId =
        explicitWinner ||
        (await resolveWinner(providerTournamentId, matchId, score));

      const response = await challongeRequest<{ match: ChallongeMatch }>(
        ctx,
        "PUT",
        `/tournaments/${encodeId(providerTournamentId)}/matches/${encodeId(
          matchId,
        )}.json`,
        {
          body: {
            match: {
              scores_csv: toChallongeScoresCsv(score),
              winner_id: toChallongeParticipantId(winnerParticipantId),
            },
          },
        },
      );

      const raw = response?.match;
      if (!raw) {
        throw responseInvalid(
          "The tournament provider did not confirm the submitted match result.",
        );
      }

      return toTournamentMatch(raw);
    },

    async finalizeTournament(providerTournamentId: string): Promise<Tournament> {
      const current = await fetchTournament(providerTournamentId);
      if (!current) throw notFound(providerTournamentId);

      const currentState = toTournamentState(current.state);

      // Idempotent: finalizing an already-finalized tournament is a no-op.
      if (currentState === "completed") return toTournament(current);

      if (currentState !== "started") {
        throw new TournamentProviderError(
          "provider_invalid_request",
          `Only a started tournament can be finalized (current state: "${currentState}").`,
          { providerId: CHALLONGE_PROVIDER_ID },
        );
      }

      try {
        await challongeRequest<unknown>(
          ctx,
          "POST",
          `/tournaments/${encodeId(providerTournamentId)}/finalize.json`,
        );
      } catch (error) {
        if (
          error instanceof TournamentProviderError &&
          error.code === "provider_invalid_request"
        ) {
          // v1 answers an unfinalizable request with HTTP 400 and an EMPTY body,
          // so the status is reported rather than a provider message.
          throw new TournamentProviderError(
            "provider_invalid_request",
            `The tournament provider refused to finalize the tournament (HTTP ${
              error.status ?? "unknown"
            }). The bracket may still have unreported matches.`,
            { status: error.status, providerId: CHALLONGE_PROVIDER_ID },
          );
        }
        throw error;
      }

      const after = await fetchTournament(providerTournamentId);
      if (!after) throw notFound(providerTournamentId);
      return toTournament(after);
    },

    async getWinner(
      providerTournamentId: string,
    ): Promise<TournamentWinner | null> {
      const current = await fetchTournament(providerTournamentId);
      if (!current) throw notFound(providerTournamentId);

      // A running tournament has no champion: the highest decided round may
      // still be a semi-final, so reporting one would be wrong.
      if (toTournamentState(current.state) !== "completed") return null;

      const decided = (await fetchMatches(providerTournamentId)).filter(
        (match) => match.state === "completed" && match.winnerParticipantId,
      );

      if (decided.length === 0) return null;

      const finalRound = Math.max(...decided.map((match) => match.round));
      const finalMatches = decided.filter((match) => match.round === finalRound);
      const lastFinal = finalMatches[finalMatches.length - 1];

      return { providerParticipantId: lastFinal.winnerParticipantId as string };
    },
  };
}
