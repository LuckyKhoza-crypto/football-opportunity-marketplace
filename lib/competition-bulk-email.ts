/**
 * T-BULK-1 — Pure (client-safe) helpers for the competition "Email
 * Participants" feature.
 *
 * No I/O, no Supabase, no `server-only`: this module holds the small, testable
 * policy pieces (input validation, address normalization/deduplication and the
 * plain-text → HTML conversion) that BOTH the UI and the server use, so the
 * browser and the server can never disagree about what is valid.
 *
 * SECURITY: the message is UNTRUSTED user input. It is escaped here and never
 * rendered as raw HTML.
 */

import { escapeHtml } from "@/lib/email/templates/fom-email-shell";
import {
  BULK_EMAIL_MESSAGE_MAX_LENGTH,
  BULK_EMAIL_SUBJECT_MAX_LENGTH,
  type CompetitionBulkEmailAudienceSummary,
  type CompetitionBulkEmailBatchState,
} from "@/types/competition-bulk-email";

// ─── Input validation ───────────────────────────────────────────────────────

export type BulkEmailInputValidation =
  | { ok: true; subject: string; message: string }
  | { ok: false; error: string };

/**
 * Validate and normalize a host-supplied subject + message.
 *
 * Rules (enforced on the SERVER; the UI mirrors them for a fast hint):
 *   * both are required and must be non-empty after trimming,
 *   * the subject may not exceed BULK_EMAIL_SUBJECT_MAX_LENGTH characters,
 *   * the message may not exceed BULK_EMAIL_MESSAGE_MAX_LENGTH characters,
 *   * the subject may not contain CR/LF — a header-injection guard, since the
 *     subject is a header, not a body field.
 */
export function validateBulkEmailInput(input: {
  subject: unknown;
  message: unknown;
}): BulkEmailInputValidation {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";

  if (subject.length === 0) {
    return { ok: false, error: "A subject is required." };
  }
  if (/[\r\n]/.test(subject)) {
    return {
      ok: false,
      error: "The subject must be a single line (no line breaks).",
    };
  }
  if (subject.length > BULK_EMAIL_SUBJECT_MAX_LENGTH) {
    return {
      ok: false,
      error: `The subject must be ${BULK_EMAIL_SUBJECT_MAX_LENGTH} characters or fewer.`,
    };
  }
  if (message.length === 0) {
    return { ok: false, error: "A message is required." };
  }
  if (message.length > BULK_EMAIL_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `The message must be ${BULK_EMAIL_MESSAGE_MAX_LENGTH} characters or fewer.`,
    };
  }

  return { ok: true, subject, message };
}

// ─── Recipient addresses ────────────────────────────────────────────────────

/**
 * Normalize an address for comparison/deduplication: trimmed and lowercased.
 * Returns null when there is nothing usable (null/undefined/blank).
 */
export function normalizeRecipientEmail(
  email: string | null | undefined,
): string | null {
  if (typeof email !== "string") return null;
  const value = email.trim().toLowerCase();
  return value.length > 0 ? value : null;
}

/**
 * Minimal, permissive deliverable-address check.
 *
 * This mirrors `isValidRecipientEmail` in `lib/email/email-service.ts` (which is
 * `server-only`). Brevo remains the authoritative validator; this only rejects
 * obviously malformed input so a bad address can never be enqueued.
 */
export function isDeliverableRecipientEmail(
  email: string | null | undefined,
): boolean {
  const value = normalizeRecipientEmail(email);
  if (!value || value.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}


// ─── Audience resolution ────────────────────────────────────────────────────

/** One active-registration row resolved with its profile's address/name. */
export interface BulkEmailAudienceRow {
  profileId: string;
  email: string | null | undefined;
  fullName?: string | null;
  /** T-REM-1/T-REM-4: a non-null value means the participant was removed. */
  removedAt?: string | null;
}

/** A single resolved recipient — never returned to the browser. */
export interface BulkEmailRecipient {
  profileId: string;
  /** Normalized (trimmed + lowercased) address. */
  email: string;
  name: string | null;
}

export interface BulkEmailAudienceResolution {
  recipients: BulkEmailRecipient[];
  summary: CompetitionBulkEmailAudienceSummary;
}

/**
 * Resolve the deliverable audience from active-registration rows.
 *
 * The authoritative `removed_at IS NULL` filter lives in the database query
 * (`getCompetitionBulkEmailAudience`); this helper RE-APPLIES the same rule so a
 * caller that forgets it can never email a removed participant, mirrors the
 * T-REM-1 `isActiveParticipant` predicate, drops missing/invalid addresses, and
 * deduplicates by normalized address.
 *
 * Only counts ever leave the server: the returned recipients stay inside the
 * batch-enqueue step.
 */
export function resolveBulkEmailAudience(
  rows: readonly BulkEmailAudienceRow[],
): BulkEmailAudienceResolution {
  const recipients: BulkEmailRecipient[] = [];
  const seen = new Set<string>();
  let activeCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const row of rows) {
    // Defence-in-depth: the DB query already filters on `removed_at IS NULL`.
    if (row.removedAt != null) continue;
    activeCount += 1;

    if (!isDeliverableRecipientEmail(row.email)) {
      invalidCount += 1;
      continue;
    }

    const email = normalizeRecipientEmail(row.email) as string;
    if (seen.has(email)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(email);

    recipients.push({
      profileId: row.profileId,
      email,
      name: row.fullName?.trim() ? row.fullName.trim() : null,
    });
  }

  return {
    recipients,
    summary: {
      activeCount,
      eligibleCount: recipients.length,
      invalidCount,
      duplicateCount,
    },
  };
}

// ─── Message rendering ──────────────────────────────────────────────────────

/**
 * Convert the host's plain-text message into escaped, email-safe HTML.
 *
 * Blank lines become separate paragraphs and single line breaks become `<br />`.
 * The text is HTML-escaped, so a host can never inject markup, a link, or a
 * tracking pixel into a participant's email.
 */
export function messageToHtml(message: string): string {
  return message
    .split(/\r?\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => {
      const escaped = escapeHtml(paragraph).replace(/\r?\n/g, "<br />");
      return `<p style="margin:0 0 12px 0;">${escaped}</p>`;
    })
    .join("");
}

// ─── Outcome derivation ─────────────────────────────────────────────────────

/**
 * Derive the display state of a batch from its recorded per-recipient outcomes.
 * Never implies an inbox delivery: "sent" means the provider ACCEPTED every
 * message.
 */
export function deriveBatchState(counts: {
  eligibleCount: number;
  acceptedCount: number;
  failedCount: number;
  pendingCount: number;
}): CompetitionBulkEmailBatchState {
  if (counts.eligibleCount === 0) return "empty";
  if (counts.pendingCount > 0) return "processing";
  if (counts.failedCount === 0) return "sent";
  if (counts.acceptedCount === 0) return "failed";
  return "partial";
}

