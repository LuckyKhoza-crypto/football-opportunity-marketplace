/**
 * TOURN-001 — The FOM tournament-provider contract (provider-neutral).
 *
 * This module is the ONLY vocabulary the rest of FOM is allowed to use when
 * talking to an external tournament engine. It deliberately describes FOM's
 * needs (create a tournament, add the registered participants, read the
 * bracket, report a result, finalize, read the champion) — NOT any particular
 * provider's API.
 *
 * Nothing here may reference provider-specific concepts. Words such as
 * `api_key`, `scores_csv`, `player1_id`, `tournament_type` or `awaiting_review`
 * belong inside a provider adapter (e.g. providers/challonge.ts), never here.
 *
 * All provider ids are exposed as STRINGS: FOM must not depend on a provider
 * using numeric ids.
 */

/**
 * Bracket format of an external tournament. This is a FOM-neutral concept: a
 * provider adapter is responsible for translating it into its own format name.
 *
 * All formats an organiser may eventually choose are modelled here. MODELLING a
 * format says nothing about being able to CREATE one: whether a provider can
 * create a format is a capability of that adapter
 * (`TournamentProvider.supportsFormat`), and only formats the configured
 * provider actually supports are ever offered or created. A format is never
 * silently mapped onto another one.
 */
export type TournamentFormat =
  | "single_elimination"
  | "double_elimination"
  | "round_robin"
  | "swiss"
  | "group_stage_knockout";

/**
 * FOM's provider-neutral tournament configuration: what a competition asks a
 * provider to create, and what FOM persists for its own use.
 *
 * Deliberately minimal — the format today. Only a setting that FOM can express
 * AND that a provider can honour may be added here, and never a provider field
 * name: an adapter decides how this configuration is represented on its side.
 */
export interface TournamentConfig {
  format: TournamentFormat;
}

/**
 * FOM's view of a tournament's lifecycle.
 *
 *  created   — the tournament exists but has not started (no bracket yet)
 *  started   — the bracket exists and matches can be reported
 *  completed — the tournament is finished and a champion can be resolved
 *  unknown   — the provider reported a state FOM does not model
 *
 * `unknown` exists so an unexpected provider state is surfaced honestly instead
 * of being silently coerced into a state FOM would then act on.
 */
export type TournamentState = "created" | "started" | "completed" | "unknown";

/**
 * FOM's view of a single match's playability.
 *
 *  pending   — at least one side is still undecided
 *  ready     — both sides are known and the match can be reported
 *  completed — a winner has been decided
 *  unknown   — the provider reported a state FOM does not model
 */
export type TournamentMatchState =
  | "pending"
  | "ready"
  | "completed"
  | "unknown";

/** The paired score of one match, from participant 1's / participant 2's side. */
export interface TournamentMatchScore {
  participant1Score: number;
  participant2Score: number;
}

/** A tournament as described by a provider. */
export interface Tournament {
  /** The provider's tournament id (always a string). Persisted on the event. */
  providerTournamentId: string;
  name: string;
  format: TournamentFormat;
  state: TournamentState;
  /** Provider-hosted page for this tournament, when the provider exposes one. */
  externalUrl: string | null;
  /** ISO timestamp of completion, when the provider reports one. */
  completedAt: string | null;
}

/** Input for creating a tournament on a provider. */
export interface CreateTournamentInput {
  /** Human-readable tournament name shown on the provider's bracket. */
  name: string;
  /**
   * Deterministic, provider-safe slug. FOM derives it from the competition id
   * so a retried creation can be recognised instead of duplicated.
   */
  slug: string;
  /** The provider-neutral configuration the tournament must be created with. */
  config: TournamentConfig;
}

/**
 * A participant FOM wants to place in the tournament.
 *
 * `ref` is a caller-supplied opaque reference (competition_participants.id) used
 * to correlate the provider's participant with FOM's own record. The provider
 * must return it unchanged in the result.
 */
export interface TournamentParticipantRef {
  ref: string;
  displayName: string;
}

/** A participant that exists on the provider, correlated back to FOM. */
export interface TournamentParticipant {
  ref: string;
  /** The provider's participant id (always a string). Persisted on the row. */
  providerParticipantId: string;
}

/** A participant as the provider reports it, without any FOM correlation. */
export interface ProviderParticipantView {
  providerParticipantId: string;
  displayName: string;
}

/** A match as described by a provider, already translated into FOM terms. */
export interface TournamentMatch {
  matchId: string;
  /** 1-based round number reported by the provider. */
  round: number;
  /** Provider participant id of side 1, or null while undecided. */
  participant1Id: string | null;
  /** Provider participant id of side 2, or null while undecided. */
  participant2Id: string | null;
  state: TournamentMatchState;
  /** Null until a result has been recorded. */
  score: TournamentMatchScore | null;
  /** Provider participant id of the winner, or null while undecided. */
  winnerParticipantId: string | null;
}

/**
 * FOM's result representation for a match. Providers translate this into their
 * own wire format inside their adapter.
 */
export interface ReportMatchResultInput {
  matchId: string;
  participant1Score: number;
  participant2Score: number;
  /**
   * Optional explicit winner (a provider participant id). When omitted, the
   * winner is derived from the scores — which therefore must be decisive.
   */
  winnerParticipantId?: string;
}

/** The champion of a completed tournament. */
export interface TournamentWinner {
  providerParticipantId: string;
}

/**
 * The contract every tournament provider must implement.
 *
 * Implementations are created by the registry (registry.ts) and are always
 * server-only. Errors must be reported as TournamentProviderError (errors.ts);
 * a provider must never return a value that pretends a failed operation
 * succeeded.
 */
export interface TournamentProvider {
  /** Stable provider identifier persisted on the competition ("challonge"). */
  readonly id: string;

  /**
   * Whether this adapter can actually CREATE a tournament in the given format.
   *
   * The adapter is the only authority on its own capabilities: FOM offers an
   * organiser only the formats the configured provider declares support for,
   * and refuses any other format instead of mapping it onto one the provider
   * does support.
   */
  supportsFormat(format: TournamentFormat): boolean;

  createTournament(input: CreateTournamentInput): Promise<Tournament>;

  /**
   * Read a tournament by its provider id or slug.
   *
   * Returns null ONLY for a definitive "not found" from the provider. Every
   * other failure (auth, network, malformed response) must throw.
   */
  getTournament(providerTournamentId: string): Promise<Tournament | null>;

  /**
   * Add participants to a not-yet-started tournament, returning each
   * participant's provider id correlated by `ref`.
   */
  addParticipants(
    providerTournamentId: string,
    participants: TournamentParticipantRef[],
  ): Promise<TournamentParticipant[]>;

  /** List the participants the provider currently holds for a tournament. */
  getParticipants(
    providerTournamentId: string,
  ): Promise<ProviderParticipantView[]>;

  /** Start the tournament, generating the bracket. */
  startTournament(providerTournamentId: string): Promise<Tournament>;

  /** Read every match of the tournament. */
  getMatches(providerTournamentId: string): Promise<TournamentMatch[]>;

  /**
   * Report a match result and return the updated match. Advancement of the
   * winner is the provider's responsibility (FOM never edits the bracket).
   */
  reportMatchResult(
    providerTournamentId: string,
    result: ReportMatchResultInput,
  ): Promise<TournamentMatch>;

  /**
   * Finalize the tournament after the last result. Must be idempotent for an
   * already-completed tournament.
   */
  finalizeTournament(providerTournamentId: string): Promise<Tournament>;

  /**
   * The champion of a COMPLETED tournament, or null while the tournament is
   * still running (an in-progress tournament has no champion yet).
   */
  getWinner(providerTournamentId: string): Promise<TournamentWinner | null>;
}
