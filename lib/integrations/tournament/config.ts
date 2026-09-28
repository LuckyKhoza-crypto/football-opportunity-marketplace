/**
 * TOURN-001 — Tournament-provider configuration resolution.
 *
 * Reads the server-only environment variables and fails SAFELY when required
 * configuration is missing. Values are read lazily (at call time), so nothing
 * is captured at module load and a missing key is reported only when a provider
 * call is actually made.
 *
 * SECURITY:
 * - The key is read only from `process.env.CHALLONGE_API_KEY` (never
 *   `NEXT_PUBLIC_*`), is never returned to the browser and is never logged.
 * - Error messages list the missing variable NAME only, never its value.
 */

import { TournamentProviderConfigError } from "@/lib/integrations/tournament/errors";

/** The environment variable that authenticates the Challonge v1 API. */
export const CHALLONGE_API_KEY_ENV_VAR = "CHALLONGE_API_KEY";

/**
 * Resolve the Challonge API key.
 *
 * @throws {TournamentProviderConfigError} when it is missing — the error names
 *         the variable only and never includes a value.
 */
export function getChallongeApiKey(): string {
  const apiKey = process.env[CHALLONGE_API_KEY_ENV_VAR]?.trim();

  if (!apiKey) {
    throw new TournamentProviderConfigError(
      [CHALLONGE_API_KEY_ENV_VAR],
      "challonge",
    );
  }

  return apiKey;
}

/**
 * Non-throwing check used for diagnostics and to gate the live integration
 * test. Returns true only when the key is present.
 */
export function isChallongeConfigured(): boolean {
  try {
    getChallongeApiKey();
    return true;
  } catch {
    return false;
  }
}
