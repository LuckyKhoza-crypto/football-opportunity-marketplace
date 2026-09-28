/**
 * Server-side errors for the transactional-email infrastructure.
 *
 * These errors are intentionally "safe": they carry an error `code`, a
 * human-readable `message`, and (optionally) non-sensitive provider metadata
 * (HTTP status, provider message id). They NEVER carry the API key, auth
 * headers, or raw provider response bodies.
 */

export type EmailErrorCode =
  | "email_config_missing"
  | "email_invalid_recipient"
  | "email_provider_request_failed"
  | "email_provider_error";

/** Base class so callers can catch any email error with a single `instanceof`. */
export class EmailError extends Error {
  readonly code: EmailErrorCode;
  /** HTTP status of the provider response, when applicable. */
  readonly status?: number;
  /** Provider-assigned message id, when the provider returned one. */
  readonly messageId?: string;

  constructor(
    code: EmailErrorCode,
    message: string,
    options?: { status?: number; messageId?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "EmailError";
    this.code = code;
    this.status = options?.status;
    this.messageId = options?.messageId;
    if (options?.cause !== undefined) {
      // `cause` is supported on Node 16+; keep it non-enumerable-ish via super
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Required Brevo configuration is missing.
 *
 * `missing` lists the NAMES of the missing environment variables only — never
 * their values.
 */
export class EmailConfigError extends EmailError {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      "email_config_missing",
      `Email is not configured. Missing required environment variable(s): ${missing.join(
        ", ",
      )}.`,
    );
    this.name = "EmailConfigError";
    this.missing = missing;
  }
}

/** The recipient email address is malformed. */
export class EmailRecipientError extends EmailError {
  constructor() {
    super("email_invalid_recipient", "Recipient email address is invalid.");
    this.name = "EmailRecipientError";
  }
}

/** The provider could not be reached (network / DNS / abort). */
export class EmailProviderRequestError extends EmailError {
  constructor(message = "Failed to reach the email provider.") {
    super("email_provider_request_failed", message);
    this.name = "EmailProviderRequestError";
  }
}

/** The provider responded with a non-2xx status. */
export class EmailProviderError extends EmailError {
  constructor(message: string, options?: { status?: number }) {
    super("email_provider_error", message, { status: options?.status });
    this.name = "EmailProviderError";
  }
}