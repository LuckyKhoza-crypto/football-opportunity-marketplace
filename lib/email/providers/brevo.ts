/**
 * Brevo transactional-email provider (server-only).
 *
 * Uses a direct `fetch()` call to Brevo's current v3 transactional email
 * endpoint (https://api.brevo.com/v3/smtp/email) rather than the official SDK,
 * to avoid adding a dependency. Authentication uses the server-only
 * `BREVO_API_KEY` via the `api-key` header.
 *
 * SECURITY:
 * - Never import this module from client code.
 * - The API key is only ever sent to Brevo. It is never logged and never
 *   included in thrown errors.
 * - Only the recipient, sender, subject and body are forwarded to Brevo.
 */

import "server-only";
import { getEmailConfig } from "@/lib/email/config";
import {
  EmailProviderError,
  EmailProviderRequestError,
} from "@/lib/email/errors";
import type {
  SendTransactionalEmailResult,
  TransactionalEmail,
} from "@/lib/email/types";

export const BREVO_TRANSACTIONAL_EMAIL_ENDPOINT =
  "https://api.brevo.com/v3/smtp/email";

/** The exact JSON payload Brevo's v3 /smtp/email endpoint expects. */
export interface BrevoTransactionalEmailPayload {
  sender: { name: string; email: string };
  to: Array<{ email: string; name?: string }>;
  subject: string;
  htmlContent: string;
  textContent?: string;
}

/**
 * Build the Brevo request payload from a generic transactional email.
 *
 * Sender identity always comes from the server-side environment
 * (`BREVO_FROM_NAME` / `BREVO_FROM_EMAIL`); callers cannot override it.
 */
export function buildBrevoPayload(
  email: TransactionalEmail,
): BrevoTransactionalEmailPayload {
  const { fromName, fromEmail } = getEmailConfig();

  const payload: BrevoTransactionalEmailPayload = {
    sender: { name: fromName, email: fromEmail },
    to: [
      email.to.name
        ? { email: email.to.email, name: email.to.name }
        : { email: email.to.email },
    ],
    subject: email.subject,
    htmlContent: email.html,
  };

  if (email.text !== undefined) {
    payload.textContent = email.text;
  }

  return payload;
}

/** A 2xx Brevo response body (only the field we use). */
interface BrevoSuccessBody {
  messageId?: string;
}

/** Extract a safe, human-readable error message from a Brevo error body. */
function safeProviderErrorMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    // Brevo typically returns { code, message }. `message` is safe to relay.
    if (typeof record.message === "string" && record.message.length > 0) {
      return record.message;
    }
  }
  return "Brevo rejected the transactional email request.";
}

/**
 * Send a transactional email through Brevo.
 *
 * @throws {EmailConfigError}          when Brevo configuration is missing.
 * @throws {EmailProviderRequestError} when the provider is unreachable.
 * @throws {EmailProviderError}        when Brevo returns a non-2xx response.
 */
export async function sendWithBrevo(
  email: TransactionalEmail,
): Promise<SendTransactionalEmailResult> {
  const { apiKey } = getEmailConfig();
  const payload = buildBrevoPayload(email);

  let response: Response;
  try {
    response = await fetch(BREVO_TRANSACTIONAL_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Network/DNS/abort failure. Deliberately do not surface the underlying
    // cause text, which could include request internals.
    throw new EmailProviderRequestError(
      "Failed to reach the Brevo transactional email API.",
    );
  }

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new EmailProviderError(safeProviderErrorMessage(body), {
      status: response.status,
    });
  }

  let body: BrevoSuccessBody | null = null;
  try {
    body = (await response.json()) as BrevoSuccessBody;
  } catch {
    // A 2xx with an unparsable body is still a success at the transport level.
  }

  const messageId =
    body && typeof body.messageId === "string" && body.messageId.length > 0
      ? body.messageId
      : "";

  if (!messageId) {
    throw new EmailProviderError(
      "Brevo accepted the request but did not return a message id.",
      { status: response.status },
    );
  }

  return { success: true, messageId };
}