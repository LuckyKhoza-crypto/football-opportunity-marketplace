/**
 * TOURN-001 — Deterministic, provider-safe tournament slug/name derivation.
 *
 * Pure functions, no I/O.
 *
 * WHY THE SLUG IS DETERMINISTIC AND DERIVED FROM THE COMPETITION ID
 * ----------------------------------------------------------------
 * Creating a tournament is an external side effect that cannot be rolled back
 * with a database transaction. If FOM creates a tournament and then crashes
 * before saving the provider id, a naive retry would create a SECOND
 * tournament on the provider.
 *
 * Instead the slug is derived from the FOM competition id, so a retry produces
 * the SAME slug. Providers enforce unique slugs, which lets the service
 * recognise a previous successful creation and adopt it (see
 * service.ts → createEventTournament) instead of duplicating it.
 *
 * Challonge v1 (verified in the POC) accepts only letters, numbers and
 * underscores in this field — hyphens are rejected with HTTP 422 — so the slug
 * is built from the competition UUID's hex characters.
 */

import { TournamentProviderError } from "@/lib/integrations/tournament/errors";

export const TOURNAMENT_SLUG_PREFIX = "fom_evt_";

/** Kept comfortably inside every provider's limit; FOM slugs are 40 chars. */
export const MAX_TOURNAMENT_SLUG_LENGTH = 64;

/** Provider bracket titles are for humans — keep them readable and bounded. */
export const MAX_TOURNAMENT_NAME_LENGTH = 120;

/**
 * Build the provider slug for a competition.
 *
 * @throws {TournamentProviderError} `tournament_invalid_input` when the id has
 *         no usable characters (which the service validates before calling).
 */
export function buildTournamentSlug(eventId: string): string {
  const compact = String(eventId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, MAX_TOURNAMENT_SLUG_LENGTH - TOURNAMENT_SLUG_PREFIX.length);

  if (!compact) {
    throw new TournamentProviderError(
      "tournament_invalid_input",
      "A tournament slug cannot be derived without a competition id.",
    );
  }

  return `${TOURNAMENT_SLUG_PREFIX}${compact}`;
}

/**
 * Build the human-readable tournament name from the competition name.
 * Whitespace is collapsed, the length is bounded, and an empty name falls back
 * to the slug so a provider never receives a blank title.
 */
export function buildTournamentName(
  eventName: string,
  fallbackSlug: string,
): string {
  const collapsed = String(eventName ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!collapsed) return fallbackSlug;

  return collapsed.slice(0, MAX_TOURNAMENT_NAME_LENGTH).trim();
}
