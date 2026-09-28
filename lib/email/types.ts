/**
 * Generic transactional-email types.
 *
 * These types intentionally use provider-agnostic email concepts so the rest of
 * the application never needs to know that Brevo is the transport underneath.
 */

/** A single transactional email recipient. */
export interface EmailRecipient {
  email: string;
  name?: string;
}

/**
 * The minimal shape for a transactional email.
 *
 * Scope (EMAIL-001): one recipient, no CC/BCC, no attachments, no scheduling,
 * no campaigns / contact lists / marketing.
 */
export interface TransactionalEmail {
  to: EmailRecipient;
  subject: string;
  html: string;
  text?: string;
}

/** Successful result returned by the email service. */
export interface SendTransactionalEmailResult {
  success: true;
  /** Provider-assigned message id (Brevo `messageId`). */
  messageId: string;
}