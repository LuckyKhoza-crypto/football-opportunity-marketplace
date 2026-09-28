/**
 * TOURN-001 — Pure (provider-neutral) contract helpers.
 *
 * No I/O, no Supabase, no provider imports: these functions can be used from
 * any layer and unit-tested in isolation.
 */

import type {
  Tournament,
  TournamentConfig,
  TournamentFormat,
} from "@/lib/integrations/tournament/types";

/**
 * Every format the FOM DOMAIN models.
 *
 * This list is the VOCABULARY, not the capability list: whether a format can
 * actually be created is decided by the provider adapter
 * (`TournamentProvider.supportsFormat`) and reported to the UI by the tournament
 * API. A format in this list is never silently mapped onto another one.
 */
export const TOURNAMENT_FORMATS: TournamentFormat[] = [
  "single_elimination",
  "double_elimination",
  "round_robin",
  "swiss",
  "group_stage_knockout",
];

/**
 * The format used when a caller does not choose one — and the format every
 * tournament created before TOURN-002A was created with (the POC verified that
 * format end to end). This is what keeps existing competitions behaving exactly
 * as they did, and what a competition with no recorded format is read as.
 */
export const DEFAULT_TOURNAMENT_FORMAT: TournamentFormat = "single_elimination";

/** Narrow an arbitrary value to a TournamentFormat FOM models. */
export function isTournamentFormat(
  value: unknown,
): value is TournamentFormat {
  return (
    typeof value === "string" &&
    (TOURNAMENT_FORMATS as string[]).includes(value)
  );
}

/**
 * Narrow an arbitrary value (a request body, a service option, a stored column)
 * to a TournamentConfig.
 *
 * Deliberately distinguishes "nothing was chosen" from "an impossible choice":
 *
 *   undefined / null / {}            → { format: DEFAULT_TOURNAMENT_FORMAT }
 *   { format: "single_elimination" } → { format: "single_elimination" }
 *   { format: "not_a_format" }       → null  (the caller must reject it)
 *
 * A format is never converted into another format, and a value that is not a
 * configuration object at all is rejected rather than defaulted.
 */
export function toTournamentConfig(value: unknown): TournamentConfig | null {
  if (value === undefined || value === null) {
    return { format: DEFAULT_TOURNAMENT_FORMAT };
  }

  if (typeof value !== "object") return null;

  const format = (value as { format?: unknown }).format;

  if (format === undefined || format === null) {
    return { format: DEFAULT_TOURNAMENT_FORMAT };
  }

  return isTournamentFormat(format) ? { format } : null;
}

/**
 * Whether a tournament has finished.
 *
 * Only the `completed` state counts: a tournament whose bracket is fully played
 * but not yet finalized is still `started` and has no confirmed champion.
 */
export function isTournamentComplete(
  tournament: Pick<Tournament, "state"> | null | undefined,
): boolean {
  return tournament?.state === "completed";
}

/**
 * Whether a match result is well formed. Scores are whole numbers and never
 * negative; the provider-neutral rule is deliberately strict so garbage cannot
 * reach a provider's bracket.
 */
export function isValidMatchScoreValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Prefix of every FOM match reference (`r1:...`). */
export const MATCH_REFERENCE_PREFIX = "r";

/** `r{round}:{participant1Id}:{participant2Id}` — both ids are FOM ids. */
const MATCH_REFERENCE_PATTERN = /^r\d+:[^:]+:[^:]+$/;

/**
 * TOURN-003 — FOM's own reference for one match of a bracket.
 *
 * A result is reported against a match, and FOM must not expose a provider match
 * id to the browser (and does not mirror matches in Supabase), so FOM needs a
 * reference of its own. It is composed from two provider-neutral facts only: the
 * round the provider reported and the two `competition_participants.id` values
 * the provider's sides resolved to.
 *
 *   r{round}:{participant1Id}:{participant2Id}
 *
 * This is an IDENTIFIER, not bracket logic. Nothing is ever derived from it — no
 * next round, no bracket position, no winner path — and the provider remains the
 * only authority on the bracket: reporting a result only tells the provider what
 * happened, and the bracket is re-read from the provider afterwards.
 *
 * Returns null when the match cannot be addressed by FOM — at least one side is
 * still undecided, or is not mapped to a competition participant — in which case
 * no result can be reported for it either.
 */
export function toMatchReference(input: {
  round: number;
  participant1Id: string | null | undefined;
  participant2Id: string | null | undefined;
}): string | null {
  const participant1Id = String(input.participant1Id ?? "").trim();
  const participant2Id = String(input.participant2Id ?? "").trim();
  if (!participant1Id || !participant2Id) return null;

  const round = Number.isFinite(input.round) ? Math.trunc(input.round) : 0;
  return `${MATCH_REFERENCE_PREFIX}${round}:${participant1Id}:${participant2Id}`;
}

/**
 * Narrow an arbitrary value (typically a URL segment) to a well-formed match
 * reference. Malformed input is rejected as a client error, never parsed
 * leniently or turned into a different reference.
 */
export function isMatchReference(value: unknown): value is string {
  return typeof value === "string" && MATCH_REFERENCE_PATTERN.test(value);
}

/** Prefix used when a FOM participant has no name to show on a bracket. */
export const FALLBACK_PARTICIPANT_NAME_PREFIX = "Player";

/**
 * The name FOM shows for a competition participant on an external bracket.
 *
 * The participant's own name is used when they have one; otherwise a stable
 * fallback derived from their position in the competition is used, so a bracket
 * never shows a blank entry. `position` is 1-based and derived from the
 * competition's own participant ordering (never from a provider response).
 *
 * No personal data beyond the participant's own display name is ever sent, and
 * email addresses are deliberately never used as a bracket name.
 */
export function participantDisplayName(
  fullName: string | null | undefined,
  position: number,
): string {
  const trimmed = String(fullName ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (trimmed) return trimmed;

  const safePosition = Number.isFinite(position) ? Math.max(1, Math.trunc(position)) : 1;
  return `${FALLBACK_PARTICIPANT_NAME_PREFIX} ${safePosition}`;
}
