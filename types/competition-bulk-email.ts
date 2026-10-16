/**
 * T-BULK-1 — Shared (client + server) types for the competition
 * "Email Participants" feature.
 *
 * These types are dependency-free so both the server helpers and the composing
 * UI can use them. They deliberately contain NO recipient email addresses: the
 * audience is always delivered to the browser as COUNTS only.
 */

/** Maximum length of a host-supplied subject (validated server-side). */
export const BULK_EMAIL_SUBJECT_MAX_LENGTH = 150;

/** Maximum length of a host-supplied plain-text message (validated server-side). */
export const BULK_EMAIL_MESSAGE_MAX_LENGTH = 5000;

/** Per-recipient delivery state stored in the outbox. */
export type BulkEmailRecipientStatus = "pending" | "sending" | "sent" | "failed";

/**
 * Derived batch state for display. This is computed from the recorded
 * per-recipient outcomes — it never claims an inbox delivery.
 *
 *   empty      → no deliverable recipient was resolved (nothing was sent)
 *   processing → at least one recipient is still pending/sending
 *   sent       → every recipient was ACCEPTED by the provider
 *   partial    → some accepted, some permanently failed
 *   failed     → nothing was accepted
 */
export type CompetitionBulkEmailBatchState =
  | "empty"
  | "processing"
  | "sent"
  | "partial"
  | "failed";

/**
 * Audience resolution summary. Counts only — never addresses.
 *
 *   activeCount      → active registrations found for the competition
 *   eligibleCount    → unique, deliverable recipients addressed by a send
 *   invalidCount     → active participants skipped: missing/invalid address
 *   duplicateCount   → active participants skipped: duplicate address
 */
export interface CompetitionBulkEmailAudienceSummary {
  activeCount: number;
  eligibleCount: number;
  invalidCount: number;
  duplicateCount: number;
}

/**
 * Recorded outcome of one batch. `acceptedCount` is what the provider ACCEPTED
 * (Brevo returned a message id) — never a claim of inbox delivery.
 */
export interface CompetitionBulkEmailBatchSummary {
  id: string;
  eventId: string;
  subject: string;
  createdAt: string;
  /** Audience snapshot taken server-side when the batch was created. */
  audience: CompetitionBulkEmailAudienceSummary;
  /** Recipients the provider accepted. */
  acceptedCount: number;
  /** Recipients that permanently failed (retries exhausted or provider refusal). */
  failedCount: number;
  /** Recipients still waiting to be sent (queued or awaiting a retry). */
  pendingCount: number;
  state: CompetitionBulkEmailBatchState;
}

/** Server-built preview of exactly what one recipient will receive. */
export interface CompetitionBulkEmailPreview {
  subject: string;
  html: string;
  text: string;
  audience: CompetitionBulkEmailAudienceSummary;
}
