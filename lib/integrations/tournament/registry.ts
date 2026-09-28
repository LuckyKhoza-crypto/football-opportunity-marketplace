/**
 * TOURN-001 — Tournament provider registry (server-only).
 *
 * The smallest mechanism that satisfies the replaceability requirement: a
 * provider id (persisted on the competition row) resolves to one adapter.
 *
 *   "challonge" → ChallongeProvider (providers/challonge.ts)
 *
 * The rest of FOM therefore never names a provider implementation — it asks the
 * registry for the provider recorded on the competition, and talks to it through
 * the generic TournamentProvider contract.
 *
 * Deliberately NOT included: dependency-injection containers, plugin discovery,
 * dynamic module loading, complex factories or a configuration framework. Adding
 * a second provider means adding one `case` here and one adapter file.
 */

import "server-only";
import { TournamentProviderError } from "@/lib/integrations/tournament/errors";
import {
  CHALLONGE_PROVIDER_ID,
  createChallongeProvider,
} from "@/lib/integrations/tournament/providers/challonge";
import type { TournamentProvider } from "@/lib/integrations/tournament/types";

/** Provider ids FOM can resolve today. */
export type TournamentProviderId = typeof CHALLONGE_PROVIDER_ID;

/** Re-exported so callers never import a provider module directly. */
export const CHALLONGE_TOURNAMENT_PROVIDER_ID: TournamentProviderId =
  CHALLONGE_PROVIDER_ID;

export const TOURNAMENT_PROVIDER_IDS: TournamentProviderId[] = [
  CHALLONGE_PROVIDER_ID,
];

/** Used when a competition has not chosen a provider yet. */
export const DEFAULT_TOURNAMENT_PROVIDER: TournamentProviderId =
  CHALLONGE_PROVIDER_ID;

/** Normalise a provider id coming from a database row or a request. */
export function normalizeTournamentProviderId(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Narrow an arbitrary value to a known provider id. */
export function isTournamentProviderId(
  value: unknown,
): value is TournamentProviderId {
  const normalized = normalizeTournamentProviderId(value);
  return (TOURNAMENT_PROVIDER_IDS as string[]).includes(normalized);
}

/**
 * Resolve a provider id to its adapter.
 *
 * Resolution does not require credentials: a provider instance is only
 * configured (and its key read) when an actual call is made, so an unknown or
 * unconfigured provider can never silently degrade into a no-op.
 *
 * @throws {TournamentProviderError} `provider_unknown` for an unregistered id.
 */
export function resolveTournamentProvider(
  providerId?: string | null,
): TournamentProvider {
  const normalized =
    normalizeTournamentProviderId(providerId) || DEFAULT_TOURNAMENT_PROVIDER;

  switch (normalized) {
    case CHALLONGE_PROVIDER_ID:
      return createChallongeProvider();
    default:
      throw new TournamentProviderError(
        "provider_unknown",
        `Unknown tournament provider "${String(providerId)}". Supported providers: ${TOURNAMENT_PROVIDER_IDS.join(
          ", ",
        )}.`,
      );
  }
}

/** The provider used when a competition has not chosen one. */
export function getDefaultTournamentProvider(): TournamentProvider {
  return resolveTournamentProvider(DEFAULT_TOURNAMENT_PROVIDER);
}
