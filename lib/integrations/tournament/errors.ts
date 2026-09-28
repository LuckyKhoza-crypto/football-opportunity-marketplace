/**
 * TOURN-001 — Server-side errors for the tournament-provider integration.
 *
 * These errors are intentionally "safe": they carry an error `code`, a
 * human-readable `message` and (optionally) non-sensitive metadata (the HTTP
 * status the provider returned). They NEVER carry the API key, an
 * authenticated URL, auth headers, or a raw provider response body.
 *
 * The codes are provider-neutral, so the FOM-facing service can map any
 * provider's failure onto an HTTP status without knowing which provider failed.
 */

export type TournamentProviderErrorCode =
  /** The provider is not configured on the server (a required env var is missing). */
  | "provider_not_configured"
  /** The configured provider id does not resolve to an adapter. */
  | "provider_unknown"
  /** The provider rejected the server's credentials (HTTP 401/403). */
  | "provider_auth_failed"
  /** The provider does not have the requested object (HTTP 404). */
  | "provider_not_found"
  /** The provider rejected the request itself (HTTP 4xx other than 404). */
  | "provider_invalid_request"
  /** The provider could not be reached (network/DNS/abort). */
  | "provider_request_failed"
  /** The provider failed server-side, or kept throttling us (HTTP 5xx / 429). */
  | "provider_unavailable"
  /** The provider answered, but the response could not be understood. */
  | "provider_response_invalid"
  /** FOM-side input to the provider call was invalid (no provider involved). */
  | "tournament_invalid_input";

/** Base class so callers can catch any tournament-provider error at once. */
export class TournamentProviderError extends Error {
  readonly code: TournamentProviderErrorCode;
  /** HTTP status of the provider response, when applicable. */
  readonly status?: number;
  /** The provider id involved, when known. */
  readonly providerId?: string;

  constructor(
    code: TournamentProviderErrorCode,
    message: string,
    options?: { status?: number; providerId?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "TournamentProviderError";
    this.code = code;
    this.status = options?.status;
    this.providerId = options?.providerId;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Required provider configuration is missing.
 *
 * `missing` lists the NAMES of the missing environment variables only — never
 * their values.
 */
export class TournamentProviderConfigError extends TournamentProviderError {
  readonly missing: string[];

  constructor(missing: string[], providerId?: string) {
    super(
      "provider_not_configured",
      `The tournament provider is not configured. Missing required environment variable(s): ${missing.join(
        ", ",
      )}.`,
      { providerId },
    );
    this.name = "TournamentProviderConfigError";
    this.missing = missing;
  }
}
