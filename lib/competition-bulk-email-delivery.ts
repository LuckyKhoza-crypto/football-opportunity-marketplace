/**
 * T-BULK-1 — Individual delivery of competition "Email Participants" batches
 * (server-only).
 *
 * This module is the ONLY place that turns a persisted
 * `competition_bulk_email_recipients` row into a real Brevo send. It mirrors the
 * EMAIL-002 outbox semantics (which the project already uses) instead of
 * introducing a job platform:
 *
 *   * ONE recipient per message — every send has a single `to`; the audience is
 *     NEVER placed in `To`/`CC`,
 *   * claiming is atomic in PostgreSQL
 *     (`claim_next_bulk_email_recipient`, `FOR UPDATE SKIP LOCKED`), so a
 *     duplicate/concurrent invocation cannot send the same message twice,
 *   * bounded retries with exponential backoff via `available_at`, capped at
 *     `BULK_EMAIL_MAX_ATTEMPTS`,
 *   * rows stranded in `sending` by a crashed worker are requeued by the claim
 *     RPC (stale timeout),
 *   * `sent` means the provider ACCEPTED the message (a Brevo message id was
 *     returned). It is NOT a claim of inbox delivery,
 *   * failures are recorded per recipient — a partially failed batch is never
 *     reported (or retried) as a whole,
 *   * per invocation the number of sends is BOUNDED (`BULK_EMAIL_PROCESS_LIMIT`)
 *     and sends are SEQUENTIAL, so a large audience can never become one large
 *     synchronous request and the provider's rate limits are respected.
 */

import "server-only";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendTransactionalEmail } from "@/lib/email/email-service";
import {
  EmailConfigError,
  EmailProviderError,
  EmailProviderRequestError,
  EmailRecipientError,
} from "@/lib/email/errors";
import {
  computeRetryDelaySeconds,
  sanitizeDeliveryError,
} from "@/lib/email/notification-delivery";
import { buildCompetitionParticipantMessageEmail } from "@/lib/email/templates/competition-participant-message";
import { isDeliverableRecipientEmail } from "@/lib/competition-bulk-email";
import type { TransactionalEmail } from "@/lib/email/types";

/** Recipients (individual messages) per processor invocation. */
export const BULK_EMAIL_PROCESS_LIMIT = 25;

/** Maximum send attempts per recipient before it is marked permanently failed. */
export const BULK_EMAIL_MAX_ATTEMPTS = 5;

/** Age (seconds) after which a `sending` row is treated as stranded. */
export const BULK_EMAIL_STALE_SECONDS = 300;

export interface BulkEmailProcessorOptions {
  /** Maximum number of individual messages to send in this invocation. */
  limit?: number;
  /** Attempts (inclusive) before a recipient is marked `failed`. */
  maxAttempts?: number;
  /** Age (seconds) after which a `sending` row is considered stale. */
  staleSeconds?: number;
  /** Injectable sender for tests; defaults to the EMAIL-001 Brevo service. */
  sender?: (email: TransactionalEmail) => Promise<{ messageId: string }>;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export interface BulkEmailProcessorResult {
  /** Recipients claimed (and attempted) in this invocation. */
  claimed: number;
  /** Recipients the provider accepted. */
  sent: number;
  /** Recipients permanently failed in this invocation. */
  failed: number;
  /** Recipients rescheduled for a later retry. */
  retried: number;
}

interface BatchDeliveryRow {
  id: string;
  event_id: string;
  subject: string;
  body_text: string;
}

interface ClaimedRecipientRow {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  attempts: number;
}

interface EventDeliveryDetails {
  name: string;
  event_date: string | null;
  location: string | null;
  challenge_name: string | null;
}

/**
 * Classify a provider failure.
 *
 * Retryable: network/transport failures, HTTP 429 (rate limited), 5xx provider
 * errors and missing configuration (an operator can fix it) plus unknown errors
 * (bounded by the attempts cap).
 *
 * Permanent: a provider rejection that will not change on retry (e.g. an invalid
 * recipient address — Brevo 4xx).
 */
export function isRetryableBulkEmailError(error: unknown): boolean {
  if (error instanceof EmailRecipientError) return false;
  if (error instanceof EmailProviderRequestError) return true;
  if (error instanceof EmailConfigError) return true;
  if (error instanceof EmailProviderError) {
    const status = error.status;
    if (status === undefined) return true;
    if (status === 429) return true;
    return status >= 500;
  }
  return true;
}

// ─── Persistence helpers (never throw) ──────────────────────────────────────

async function markSent(
  id: string,
  messageId: string,
  now: Date,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("competition_bulk_email_recipients")
    .update({
      status: "sent",
      sent_at: now.toISOString(),
      provider_message_id: messageId || null,
      last_error: null,
    })
    .eq("id", id);

  if (error) {
    // The provider accepted the message; a persistence failure only means the
    // row may be retried later. Log safely — never an address.
    console.error("bulkEmail.markSent: update failed", {
      id,
      code: error.code,
    });
  }
}

async function markFailed(id: string, lastError: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("competition_bulk_email_recipients")
    .update({ status: "failed", last_error: lastError })
    .eq("id", id);

  if (error) {
    console.error("bulkEmail.markFailed: update failed", {
      id,
      code: error.code,
    });
  }
}

async function scheduleRetry(
  id: string,
  lastError: string,
  delaySeconds: number,
  now: Date,
): Promise<void> {
  const availableAt = new Date(now.getTime() + delaySeconds * 1000);
  const { error } = await supabaseAdmin
    .from("competition_bulk_email_recipients")
    .update({
      status: "pending",
      last_error: lastError,
      available_at: availableAt.toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("bulkEmail.scheduleRetry: update failed", {
      id,
      code: error.code,
    });
  }
}

/** Load the persisted batch (the message is NEVER taken from the client here). */
async function loadBatch(batchId: string): Promise<BatchDeliveryRow | null> {
  const { data, error } = await supabaseAdmin
    .from("competition_bulk_emails")
    .select("id, event_id, subject, body_text")
    .eq("id", batchId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as BatchDeliveryRow;
}

/** Load the verified event details appended to the message (missing = omitted). */
async function loadEventDetails(
  eventId: string,
): Promise<EventDeliveryDetails | null> {
  const { data, error } = await supabaseAdmin
    .from("competition_events")
    .select("name, event_date, location, challenge_name")
    .eq("id", eventId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as EventDeliveryDetails;
}

/** Read the batch's event id (used to bind a batch to a route competition). */
async function findBatchEventId(batchId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("competition_bulk_emails")
    .select("event_id")
    .eq("id", batchId)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { event_id: string }).event_id ?? null;
}


/**
 * Process the pending recipients of ONE batch.
 *
 * Sends at most `limit` individual messages (sequentially), so the caller's
 * request can never become a large synchronous fan-out. Remaining `pending`
 * recipients stay durably queued for the next invocation.
 */
export async function processBulkEmailBatch(
  batchId: string,
  options: BulkEmailProcessorOptions = {},
): Promise<BulkEmailProcessorResult> {
  const result: BulkEmailProcessorResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    retried: 0,
  };
  if (!batchId) return result;

  const limit = options.limit ?? BULK_EMAIL_PROCESS_LIMIT;
  const maxAttempts = options.maxAttempts ?? BULK_EMAIL_MAX_ATTEMPTS;
  const staleSeconds = options.staleSeconds ?? BULK_EMAIL_STALE_SECONDS;
  const now = options.now ?? (() => new Date());
  const sender =
    options.sender ??
    (async (email: TransactionalEmail) => {
      const sent = await sendTransactionalEmail(email);
      return { messageId: sent.messageId };
    });

  const batch = await loadBatch(batchId);
  if (!batch) {
    // The batch no longer exists (deleted with its competition, or removed on a
    // failed enqueue) — there is nothing to deliver.
    return result;
  }

  const event = await loadEventDetails(batch.event_id);

  for (let i = 0; i < limit; i += 1) {
    const { data, error } = await supabaseAdmin.rpc(
      "claim_next_bulk_email_recipient",
      {
        p_batch_id: batchId,
        p_stale_seconds: staleSeconds,
        p_max_attempts: maxAttempts,
      },
    );

    if (error) {
      // Infrastructure problem — stop this invocation; the rows stay pending.
      console.error("bulkEmail: failed to claim recipient", {
        batchId,
        code: (error as { code?: string }).code,
      });
      break;
    }

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const claimed = rows[0] as ClaimedRecipientRow | undefined;
    if (!claimed) break;

    result.claimed += 1;

    // Defence-in-depth: the address was validated at enqueue time, but a stored
    // value is re-checked so a malformed address is never handed to the provider.
    if (!isDeliverableRecipientEmail(claimed.recipient_email)) {
      await markFailed(claimed.id, "Recipient address is invalid.");
      result.failed += 1;
      continue;
    }

    const email = buildCompetitionParticipantMessageEmail({
      to: claimed.recipient_email,
      recipientName: claimed.recipient_name,
      competitionName: event?.name ?? "your competition",
      subject: batch.subject,
      message: batch.body_text,
      eventDate: event?.event_date ?? null,
      location: event?.location ?? null,
      challengeName: event?.challenge_name ?? null,
    });

    try {
      const { messageId } = await sender(email);
      await markSent(claimed.id, messageId, now());
      result.sent += 1;
    } catch (err) {
      const safeError = sanitizeDeliveryError(err);
      if (!isRetryableBulkEmailError(err) || claimed.attempts >= maxAttempts) {
        await markFailed(claimed.id, safeError);
        result.failed += 1;
      } else {
        const delay = computeRetryDelaySeconds(claimed.attempts);
        await scheduleRetry(claimed.id, safeError, delay, now());
        result.retried += 1;
      }
    }
  }

  return result;
}

/**
 * Process the pending recipients of a batch KNOWN to belong to an event.
 * Returns null when the batch does not belong to that competition (so a manager
 * of one competition can never drain another competition's batch).
 */
export async function processBulkEmailBatchForEvent(
  eventId: string,
  batchId: string,
  options: BulkEmailProcessorOptions = {},
): Promise<BulkEmailProcessorResult | null> {
  const ownerEventId = await findBatchEventId(batchId);
  if (!ownerEventId || ownerEventId !== eventId) return null;
  return processBulkEmailBatch(batchId, options);
}

/**
 * Kick the first delivery attempt AFTER the API response is sent, so the
 * sender's request never waits on Brevo. Best-effort: any failure is logged
 * safely; pending rows simply remain durably queued.
 */
export function scheduleBulkEmailProcessing(
  batchId: string,
  options: BulkEmailProcessorOptions = {},
): void {
  const run = () =>
    processBulkEmailBatch(batchId, options).then(
      () => undefined,
      (err) => {
        console.error("bulkEmail: background processing failed", {
          batchId,
          message: sanitizeDeliveryError(err),
        });
      },
    );

  try {
    // `after()` must be called within a request scope; when unavailable (tests,
    // non-request contexts) this is a harmless no-op.
    after(run);
  } catch {
    // No request scope — best-effort only. Never break the caller.
  }
}
