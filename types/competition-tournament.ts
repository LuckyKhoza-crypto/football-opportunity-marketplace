/**
 * TOURN-002 — Provider-neutral tournament views for the FOM tournament UI.
 *
 * Kept in a dedicated module (mirroring types/competition-drawing.ts) so this
 * ticket adds no churn to unrelated type definitions.
 *
 * Design notes:
 *   * These are TRANSPORT/VIEW types: they describe what the tournament API
 *     returns to FOM clients, never what a tournament provider stores. Every
 *     provider-specific concept is removed before an object crosses this
 *     boundary — no provider tournament id, no provider participant id, no
 *     provider match id, no provider name and no provider URL.
 *   * Participants are identified by `competition_participants.id` (a FOM id)
 *     and a display name. Nothing else about a participant is exposed.
 *   * `state` reuses the provider-neutral unions from the TOURN-001 contract,
 *     so a newly supported format or state extends this module without the UI
 *     assuming single elimination, a fixed round count or a fixed bracket size.
 */

import type {
  TournamentFormat,
  TournamentMatchState,
  TournamentState,
} from "@/lib/integrations/tournament/types";

/** The neutral lifecycle status of a competition's external tournament. */
export interface TournamentViewStatus {
  /** Human-readable tournament name (the bracket title). */
  name: string;
  /** The tournament format FOM configured for this tournament. */
  format: TournamentFormat;
  state: TournamentState;
  isComplete: boolean;
  /** ISO timestamp the tournament completed, when the provider reports one. */
  completedAt: string | null;
}

/** Status plus the extra counts the tournament summary endpoint reports. */
export interface TournamentViewSummary extends TournamentViewStatus {
  /** Matches with both sides known and no result recorded yet. */
  openMatchCount: number;
  /** competition_participants.id of the champion, once the tournament is complete. */
  winnerParticipantId: string | null;
}

/**
 * A tournament format the organiser may choose when creating the tournament.
 *
 * `supported: false` means FOM models the format but the configured provider
 * cannot create it yet: the UI shows it as unavailable (never selectable), and
 * the server would reject it anyway. This is what keeps the client from
 * promising a capability the provider does not have.
 */
export interface TournamentViewFormatOption {
  format: TournamentFormat;
  supported: boolean;
}

/** A competition participant that is mapped onto the tournament. */
export interface TournamentViewParticipant {
  /** competition_participants.id — a FOM id, never a provider id. */
  participantId: string;
  name: string;
}

/** One side of a match. */
export interface TournamentViewMatchSide {
  /** competition_participants.id when this side is a known FOM participant. */
  participantId: string | null;
  /**
   * Display name of the side. `null` means the side is still undecided (the
   * match has not been fed by an earlier round yet).
   */
  name: string | null;
}

/** The score of one match, from participant 1's / participant 2's side. */
export interface TournamentViewScore {
  participant1Score: number;
  participant2Score: number;
}

/** A single match of the bracket, as FOM displays it. */
export interface TournamentViewMatch {
  /**
   * TOURN-003 — FOM's own reference for this match
   * (`r{round}:{participant1Id}:{participant2Id}`, see `toMatchReference`), used
   * to report a result. It is an opaque FOM identifier: no provider id is in it,
   * and it is never parsed by the UI.
   *
   * `null` means FOM cannot address the match (a side is still undecided, or is
   * not mapped to a competition participant), so no result can be reported for
   * it either.
   */
  matchRef: string | null;
  /** 1-based round number reported by the provider — never a fixed name. */
  round: number;
  state: TournamentMatchState;
  participant1: TournamentViewMatchSide;
  participant2: TournamentViewMatchSide;
  /** Null until a result has been recorded. */
  score: TournamentViewScore | null;
  /** Null while the match is undecided. */
  winner: TournamentViewMatchSide | null;
}

/** The read-only bracket: the tournament's mapped participants and matches. */
export interface TournamentViewBracket {
  tournamentState: TournamentState;
  /** Every competition participant currently mapped onto the tournament. */
  participants: TournamentViewParticipant[];
  matches: TournamentViewMatch[];
}

/**
 * The response of reporting a match result: the match as the provider now holds
 * it, expressed in FOM terms (see {@link TournamentViewMatch}). The bracket is
 * re-read separately — advancement happens inside the provider, never here.
 */
export interface TournamentViewMatchResult {
  match: TournamentViewMatch;
}

/**
 * TOURN-003 — the response of finalizing a tournament: the neutral tournament
 * status plus the champion resolved to a `competition_participants.id` (never a
 * provider participant id), which the UI shows alongside the bracket.
 */
export interface TournamentViewFinalization {
  /** false when the tournament was already complete (an idempotent call). */
  finalized: boolean;
  /** competition_participants.id of the champion, when the provider has one. */
  winnerParticipantId: string | null;
  tournament: TournamentViewStatus;
}

/**
 * Machine-readable marker on the `409` response of the tournament read
 * endpoints: the competition simply has no tournament yet. It lets the UI show
 * the "create tournament" state instead of treating the response as a failure.
 */
export const TOURNAMENT_NOT_LINKED_CODE = "not_linked";

/**
 * Shown for a bracket side that exists on the provider but is not mapped to a
 * competition participant, so a bracket never displays a blank entry.
 */
export const UNMAPPED_PARTICIPANT_NAME = "Unknown participant";

/** Display labels for the neutral tournament states. */
export const TOURNAMENT_STATE_LABELS: Record<TournamentState, string> = {
  created: "Not started",
  started: "Tournament Started",
  completed: "Tournament Completed",
  unknown: "Unknown",
};

/**
 * Display labels for the tournament formats. FOM's own copy — the API reports
 * format ids, never labels, so no provider wording can reach the browser.
 */
export const TOURNAMENT_FORMAT_LABELS: Record<TournamentFormat, string> = {
  single_elimination: "Single Elimination",
  double_elimination: "Double Elimination",
  round_robin: "Round Robin",
  swiss: "Swiss",
  group_stage_knockout: "Group Stage + Knockout",
};

/**
 * Appended to a format the configured provider cannot create yet, so an
 * unavailable option is explained instead of simply looking broken.
 */
export const TOURNAMENT_FORMAT_COMING_SOON_SUFFIX = "Coming soon";

/** Display labels for the neutral match states. */
export const TOURNAMENT_MATCH_STATE_LABELS: Record<TournamentMatchState, string> =
  {
    pending: "Pending",
    ready: "Ready",
    completed: "Completed",
    unknown: "Unknown",
  };
