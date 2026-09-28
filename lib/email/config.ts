/**
 * Brevo / transactional-email configuration resolution.
 *
 * Reads the server-only environment variables and fails SAFELY when required
 * configuration is missing. This module must never be imported from client
 * code — it is only reachable through the server-only email service.
 *
 * Required variables:
 *   BREVO_API_KEY      — secret, server-only, never exposed to the browser
 *   BREVO_FROM_EMAIL   — the verified Brevo sender address
 *   BREVO_FROM_NAME    — the display name for the sender
 *
 * Values are read lazily (at call time) so nothing is captured at module load
 * and missing configuration is reported only when an email is actually sent.
 */

import { EmailConfigError } from "@/lib/email/errors";

export interface EmailConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

/** Names of the required variables, in a stable order for error messages. */
const REQUIRED_ENV_VARS = [
  "BREVO_API_KEY",
  "BREVO_FROM_EMAIL",
  "BREVO_FROM_NAME",
] as const;

/**
 * Resolve and validate the email configuration.
 *
 * @throws {EmailConfigError} when one or more required variables are missing.
 *         The error lists only the variable NAMES, never their values.
 */
export function getEmailConfig(): EmailConfig {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const fromEmail = process.env.BREVO_FROM_EMAIL?.trim();
  const fromName = process.env.BREVO_FROM_NAME?.trim();

  const missing = REQUIRED_ENV_VARS.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === "";
  });

  if (missing.length > 0) {
    throw new EmailConfigError([...missing]);
  }

  return {
    apiKey: apiKey as string,
    fromEmail: fromEmail as string,
    fromName: fromName as string,
  };
}

/**
 * Non-throwing check used to gate development-only tooling.
 * Returns true only when all required variables are present.
 */
export function isEmailConfigured(): boolean {
  try {
    getEmailConfig();
    return true;
  } catch {
    return false;
  }
}