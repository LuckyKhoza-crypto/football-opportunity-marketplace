/**
 * Server-only transactional email service.
 *
 * This is the ONLY entry point the rest of the application should use. It
 * exposes generic email concepts and hides the Brevo provider detail behind
 * `lib/email/providers/brevo`.
 *
 * Scope (EMAIL-001): one recipient, no CC/BCC, no attachments, no scheduling,
 * no campaigns. A database outbox/queue is intentionally out of scope.
 *
 * Usage (server-side only):
 *
 *   import { sendTransactionalEmail } from "@/lib/email/email-service";
 *
 *   await sendTransactionalEmail({
 *     to: { email: "player@example.com", name: "Alex" },
 *     subject: "…",
 *     html: "…",
 *     text: "…",
 *   });
 */

import "server-only";
import { EmailRecipientError } from "@/lib/email/errors";
import { sendWithBrevo } from "@/lib/email/providers/brevo";
import type {
  SendTransactionalEmailResult,
  TransactionalEmail,
} from "@/lib/email/types";

/**
 * Minimal, permissive email-address check.
 *
 * We intentionally do NOT try to fully validate RFC 5322 here — Brevo performs
 * authoritative validation. This only rejects obviously malformed input before
 * making a network call.
 */
export function isValidRecipientEmail(email: string): boolean {
  const value = email.trim();
  if (value.length === 0 || value.length > 320) return false;
  // Exactly one "@", non-empty local part, and a dotted domain with no spaces.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Send a transactional email.
 *
 * @returns `{ success: true, messageId }` on success.
 * @throws {EmailConfigError}          missing Brevo configuration.
 * @throws {EmailRecipientError}       malformed recipient address.
 * @throws {EmailProviderRequestError} provider unreachable.
 * @throws {EmailProviderError}        provider returned a non-2xx response.
 */
export async function sendTransactionalEmail(
  email: TransactionalEmail,
): Promise<SendTransactionalEmailResult> {
  if (!isValidRecipientEmail(email.to.email)) {
    throw new EmailRecipientError();
  }

  // Normalise the recipient (trim) while preserving the optional name.
  const normalised: TransactionalEmail = {
    ...email,
    to: {
      email: email.to.email.trim(),
      ...(email.to.name ? { name: email.to.name } : {}),
    },
  };

  const result = await sendWithBrevo(normalised);

  // Safe logging: type, recipient domain only, and the provider message id.
  // Never log the API key or the full email body.
  console.info("[email] transactional email sent", {
    type: "transactional",
    recipientDomain: normalised.to.email.split("@")[1] ?? "",
    messageId: result.messageId,
  });

  return result;
}