import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  canManageEvent,
  getCompetitionEvent,
  type CompetitionMutationResult,
} from "@/lib/competition-server";
import { isEmailConfigured } from "@/lib/email/config";
import {
  deriveBatchState,
  resolveBulkEmailAudience,
  validateBulkEmailInput,
  type BulkEmailAudienceResolution,
  type BulkEmailAudienceRow,
} from "@/lib/competition-bulk-email";
import { buildCompetitionParticipantMessageEmail } from "@/lib/email/templates/competition-participant-message";
import {
  processBulkEmailBatchForEvent,
  scheduleBulkEmailProcessing,
} from "@/lib/competition-bulk-email-delivery";
import type {
  CompetitionBulkEmailAudienceSummary,
  CompetitionBulkEmailBatchSummary,
  CompetitionBulkEmailPreview,
} from "@/types/competition-bulk-email";

/**
 * T-BULK-1 — Server-side "Email Participants" helpers.
 *
 * Conventions match the other competition `*-server.ts` modules: `server-only`,
 * service-role client, discriminated-result error handling, no thrown errors.
 *
 * Every entry point:
 *   1. re-checks authorization with the EXISTING `canManageEvent` rule (event
 *      creator OR assigned ambassador — never profiles.role),
 *   2. derives the acting identity from the authenticated session (the caller
 *      passes the session profile id; a request body can never supply it),
 *   3. resolves the audience from the DATABASE at call time — a client-supplied
 *      recipient list or count is never trusted,
 *   4. returns COUNTS or a server-built preview only. Recipient addresses are
 *      never part of any result shape that reaches the browser.
 *
 * Recipient selection uses the EXISTING relationships: `competition_participants`
 * rows of the event with `removed_at IS NULL` (T-REM-1/T-REM-4 active rule),
 * joined to `profiles` through the existing
 * `competition_participants_profile_id_fkey` FK — `profiles.email` is the
 * canonical address (NOT auth.users, NOT player_profiles).
 */

/** Recipient rows are inserted in chunked requests so one send never becomes a
 * single oversized database request. */
const RECIPIENT_INSERT_CHUNK_SIZE = 250;

// ─── Batch row mapping ──────────────────────────────────────────────────────

interface BatchRow {
  id: string;
  event_id: string;
  subject: string;
  created_at: string;
  eligible_count: number;
  invalid_count: number;
  duplicate_count: number;
}

function audienceFromBatchRow(row: BatchRow): CompetitionBulkEmailAudienceSummary {
  // activeCount is not stored on the batch; the stored snapshot is the
  // eligible/invalid/duplicate split (the only counts a sender is shown).
  return {
    activeCount:
      (row.eligible_count ?? 0) + (row.invalid_count ?? 0) + (row.duplicate_count ?? 0),
    eligibleCount: row.eligible_count ?? 0,
    invalidCount: row.invalid_count ?? 0,
    duplicateCount: row.duplicate_count ?? 0,
  };
}

/**
 * Count the recorded per-recipient outcomes of a batch. Only the `status`
 * column is read — never an address.
 */
async function getBatchOutcomeCounts(batchId: string): Promise<{
  acceptedCount: number;
  failedCount: number;
  pendingCount: number;
}> {
  const { data, error } = await supabaseAdmin
    .from("competition_bulk_email_recipients")
    .select("status")
    .eq("batch_id", batchId);

  if (error) {
    console.error("getBatchOutcomeCounts: query failed", {
      batchId,
      code: error.code,
    });
    return { acceptedCount: 0, failedCount: 0, pendingCount: 0 };
  }

  let acceptedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  for (const row of (data ?? []) as { status: string }[]) {
    if (row.status === "sent") acceptedCount += 1;
    else if (row.status === "failed") failedCount += 1;
    else pendingCount += 1;
  }
  return { acceptedCount, failedCount, pendingCount };
}


/** Build the display summary of a persisted batch from recorded outcomes. */
async function buildBatchSummary(
  row: BatchRow,
): Promise<CompetitionBulkEmailBatchSummary> {
  const counts = await getBatchOutcomeCounts(row.id);
  const audience = audienceFromBatchRow(row);

  return {
    id: row.id,
    eventId: row.event_id,
    subject: row.subject,
    createdAt: row.created_at,
    audience,
    acceptedCount: counts.acceptedCount,
    failedCount: counts.failedCount,
    pendingCount: counts.pendingCount,
    state: deriveBatchState({
      eligibleCount: audience.eligibleCount,
      acceptedCount: counts.acceptedCount,
      failedCount: counts.failedCount,
      pendingCount: counts.pendingCount,
    }),
  };
}

// ─── Audience resolution (server-authoritative) ──────────────────────────────

/**
 * Read the event's ACTIVE registrations and resolve the deliverable audience.
 *
 * `removed_at IS NULL` is applied in the QUERY (the authoritative rule) and
 * re-applied by `resolveBulkEmailAudience`. Checked-in and not-yet-checked-in
 * participants are both included — this is a reminder, not bracket
 * synchronization.
 *
 * Returns an empty resolution on error (matching the `*-server.ts` convention).
 */
async function resolveAudienceForEvent(
  eventId: string,
): Promise<BulkEmailAudienceResolution> {
  const { data, error } = await supabaseAdmin
    .from("competition_participants")
    .select(
      "profile_id, removed_at, profile:profiles!competition_participants_profile_id_fkey(email, full_name)",
    )
    .eq("event_id", eventId)
    .is("removed_at", null);

  if (error) {
    console.error("resolveAudienceForEvent: query failed", {
      eventId,
      code: error.code,
    });
    return resolveBulkEmailAudience([]);
  }

  const rows = ((data ?? []) as unknown as {
    profile_id: string;
    removed_at: string | null;
    profile: { email: string | null; full_name: string | null } | null;
  }[]).map<BulkEmailAudienceRow>((row) => ({
    profileId: row.profile_id,
    email: row.profile?.email ?? null,
    fullName: row.profile?.full_name ?? null,
    removedAt: row.removed_at ?? null,
  }));

  return resolveBulkEmailAudience(rows);
}

/**
 * GET audience summary — authorized (creator OR assigned ambassador).
 *
 * Only COUNTS are returned; the resolved addresses never leave this module.
 */
export async function getCompetitionBulkEmailAudience(
  eventId: string,
  actorProfileId: string,
): Promise<CompetitionMutationResult<CompetitionBulkEmailAudienceSummary>> {
  if (!eventId || !actorProfileId) {
    return { ok: false, error: "Event and profile are required", status: 400 };
  }
  if (!(await canManageEvent(eventId, actorProfileId))) {
    return {
      ok: false,
      error: "Not authorized to email participants of this competition",
      status: 403,
    };
  }

  const { summary } = await resolveAudienceForEvent(eventId);
  return { ok: true, data: summary };
}


// ─── Compose inputs ─────────────────────────────────────────────────────────

export interface BulkEmailComposeInput {
  eventId: string;
  /** The acting profile id — ALWAYS the authenticated session profile. */
  actorProfileId: string;
  subject: unknown;
  message: unknown;
}

export interface BulkEmailSendInput extends BulkEmailComposeInput {
  /** Client-supplied idempotency key for THIS compose session (a UUID). */
  requestId: unknown;
}

/** A UUID v4-shaped string (the shape `crypto.randomUUID()` produces). */
function isRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Build the email EXACTLY as the processor will build it for a recipient. */
function buildRecipientEmail(options: {
  eventName: string;
  eventDate: string | null;
  location: string | null;
  challengeName: string | null;
  subject: string;
  message: string;
  to: string;
  recipientName: string | null;
}) {
  return buildCompetitionParticipantMessageEmail({
    to: options.to,
    recipientName: options.recipientName,
    competitionName: options.eventName,
    subject: options.subject,
    message: options.message,
    eventDate: options.eventDate,
    location: options.location,
    challengeName: options.challengeName,
  });
}

// ─── Preview ────────────────────────────────────────────────────────────────

/**
 * Build a server-rendered preview of the email (and the current audience count)
 * WITHOUT sending anything. Authorization and validation both apply.
 *
 * The preview is built by the SAME template the processor uses, so what the
 * sender previews is what a participant receives (including escaping).
 */
export async function previewCompetitionBulkEmail(
  input: BulkEmailComposeInput,
): Promise<CompetitionMutationResult<CompetitionBulkEmailPreview>> {
  if (!input.eventId || !input.actorProfileId) {
    return { ok: false, error: "Event and profile are required", status: 400 };
  }

  const validation = validateBulkEmailInput({
    subject: input.subject,
    message: input.message,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.error, status: 400 };
  }

  if (!(await canManageEvent(input.eventId, input.actorProfileId))) {
    return {
      ok: false,
      error: "Not authorized to email participants of this competition",
      status: 403,
    };
  }

  const event = await getCompetitionEvent(input.eventId);
  if (!event) {
    return { ok: false, error: "Competition not found", status: 404 };
  }

  const { summary } = await resolveAudienceForEvent(input.eventId);

  // The preview uses a fixed placeholder recipient; no real address is read,
  // stored or returned.
  const email = buildRecipientEmail({
    eventName: event.name,
    eventDate: event.event_date ?? null,
    location: event.location ?? null,
    challengeName: event.challenge_name ?? null,
    subject: validation.subject,
    message: validation.message,
    to: "participant@example.com",
    recipientName: null,
  });

  return {
    ok: true,
    data: {
      subject: email.subject,
      html: email.html,
      text: email.text ?? "",
      audience: summary,
    },
  };
}

// ─── Send ───────────────────────────────────────────────────────────────────

/**
 * Enqueue a batch (one message per recipient) and schedule processing.
 *
 * Order of operations:
 *   1. validate the subject/message (untrusted input),
 *   2. validate the idempotency `requestId`,
 *   3. authorize (creator OR assigned ambassador) — a failed authorize/validate
 *      sends NOTHING,
 *   4. RE-resolve the audience from the database (never a client-supplied list),
 *   5. create the batch + one recipient row per deliverable address
 *      (deduplicated, normalized), then
 *   6. schedule the first delivery attempt after the response via `after()`.
 *
 * Idempotency: the first request for a given (event, requestId) wins; a repeat
 * (double click / retry) returns the EXISTING batch and sends nothing new.
 *
 * Nothing is reported as delivered here — the batch starts fully `pending`.
 */
export async function sendCompetitionBulkEmail(
  input: BulkEmailSendInput,
): Promise<CompetitionMutationResult<CompetitionBulkEmailBatchSummary>> {
  const { eventId, actorProfileId } = input;
  if (!eventId || !actorProfileId) {
    return { ok: false, error: "Event and profile are required", status: 400 };
  }

  const validation = validateBulkEmailInput({
    subject: input.subject,
    message: input.message,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.error, status: 400 };
  }

  const requestId =
    typeof input.requestId === "string" ? input.requestId.trim() : "";
  if (!isRequestId(requestId)) {
    return {
      ok: false,
      error: "A valid request id is required to send this message.",
      status: 400,
    };
  }

  if (!(await canManageEvent(eventId, actorProfileId))) {
    return {
      ok: false,
      error: "Not authorized to email participants of this competition",
      status: 403,
    };
  }

  const event = await getCompetitionEvent(eventId);
  if (!event) {
    return { ok: false, error: "Competition not found", status: 404 };
  }

  // Fail fast (and honestly) when the transport is unconfigured, instead of
  // queueing a batch that can only fail.
  if (!isEmailConfigured()) {
    return {
      ok: false,
      error: "Email is not configured on this deployment.",
      status: 503,
    };
  }

  // Idempotency: an existing batch for this (event, request) is returned as-is.
  const existing = await findBatchByRequest(eventId, requestId);
  if (existing) {
    return { ok: true, data: await buildBatchSummary(existing) };
  }

  // Re-resolve the eligible audience at SEND time (server-truth).
  const { recipients, summary } = await resolveAudienceForEvent(eventId);

  const batchId = randomUUID();
  const { error: batchError } = await supabaseAdmin
    .from("competition_bulk_emails")
    .insert({
      id: batchId,
      event_id: eventId,
      sent_by_profile_id: actorProfileId,
      request_id: requestId,
      subject: validation.subject,
      body_text: validation.message,
      eligible_count: summary.eligibleCount,
      invalid_count: summary.invalidCount,
      duplicate_count: summary.duplicateCount,
    });

  if (batchError) {
    // A concurrent request with the same request id won the race: return it.
    if ((batchError as { code?: string }).code === "23505") {
      const winner = await findBatchByRequest(eventId, requestId);
      if (winner) return { ok: true, data: await buildBatchSummary(winner) };
    }
    console.error("sendCompetitionBulkEmail: batch insert failed", {
      eventId,
      code: batchError.code,
    });
    return { ok: false, error: "Failed to queue the message", status: 500 };
  }

  if (recipients.length > 0) {
    const rows = recipients.map((recipient) => ({
      batch_id: batchId,
      profile_id: recipient.profileId,
      recipient_email: recipient.email,
      recipient_name: recipient.name,
      status: "pending" as const,
    }));

    for (let i = 0; i < rows.length; i += RECIPIENT_INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + RECIPIENT_INSERT_CHUNK_SIZE);
      const { error: recipientError } = await supabaseAdmin
        .from("competition_bulk_email_recipients")
        .insert(chunk);

      if (recipientError) {
        // Never leave a batch that claims recipients it does not have: delete it
        // (the cascade removes any recipients already inserted). Nothing has been
        // sent yet, so this is safe.
        console.error("sendCompetitionBulkEmail: recipient insert failed", {
          batchId,
          code: recipientError.code,
        });
        await deleteBatch(batchId);
        return { ok: false, error: "Failed to queue the message", status: 500 };
      }
    }
  }

  // First attempt after the response is sent — the request never waits on Brevo.
  if (recipients.length > 0) {
    scheduleBulkEmailProcessing(batchId);
  }

  return {
    ok: true,
    data: {
      id: batchId,
      eventId,
      subject: validation.subject,
      createdAt: new Date().toISOString(),
      audience: summary,
      acceptedCount: 0,
      failedCount: 0,
      pendingCount: recipients.length,
      state: deriveBatchState({
        eligibleCount: summary.eligibleCount,
        acceptedCount: 0,
        failedCount: 0,
        pendingCount: recipients.length,
      }),
    },
  };
}


// ─── Batch lookup ───────────────────────────────────────────────────────────

const BATCH_COLUMNS =
  "id, event_id, subject, created_at, eligible_count, invalid_count, duplicate_count";

/** Fetch a batch by its (event, request) idempotency key. */
async function findBatchByRequest(
  eventId: string,
  requestId: string,
): Promise<BatchRow | null> {
  const { data, error } = await supabaseAdmin
    .from("competition_bulk_emails")
    .select(BATCH_COLUMNS)
    .eq("event_id", eventId)
    .eq("request_id", requestId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as BatchRow;
}

/** Remove a batch that could not be fully enqueued (cascades its recipients). */
async function deleteBatch(batchId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("competition_bulk_emails")
    .delete()
    .eq("id", batchId);

  if (error) {
    console.error("deleteBatch: cleanup failed", {
      batchId,
      code: error.code,
    });
  }
}

/**
 * GET one batch's recorded outcomes — authorized (creator OR assigned ambassador).
 * The batch must belong to the event in the route, so a manager of one
 * competition can never read another competition's batch.
 */
export async function getCompetitionBulkEmailBatch(
  eventId: string,
  batchId: string,
  actorProfileId: string,
): Promise<CompetitionMutationResult<CompetitionBulkEmailBatchSummary>> {
  if (!eventId || !batchId || !actorProfileId) {
    return {
      ok: false,
      error: "Event, batch and profile are required",
      status: 400,
    };
  }
  if (!(await canManageEvent(eventId, actorProfileId))) {
    return {
      ok: false,
      error: "Not authorized to view this message batch",
      status: 403,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("competition_bulk_emails")
    .select(BATCH_COLUMNS)
    .eq("id", batchId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Message batch not found", status: 404 };
  }

  return { ok: true, data: await buildBatchSummary(data as unknown as BatchRow) };
}

/**
 * List the most recent batches of an event — authorized (creator OR assigned
 * ambassador). Summaries only: no addresses, no message bodies.
 */
export async function listCompetitionBulkEmailBatches(
  eventId: string,
  actorProfileId: string,
  limit = 5,
): Promise<CompetitionMutationResult<CompetitionBulkEmailBatchSummary[]>> {
  if (!eventId || !actorProfileId) {
    return { ok: false, error: "Event and profile are required", status: 400 };
  }
  if (!(await canManageEvent(eventId, actorProfileId))) {
    return {
      ok: false,
      error: "Not authorized to view message batches",
      status: 403,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("competition_bulk_emails")
    .select(BATCH_COLUMNS)
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 20)));

  if (error) {
    console.error("listCompetitionBulkEmailBatches: query failed", {
      eventId,
      code: error.code,
    });
    return { ok: false, error: "Failed to load message batches", status: 500 };
  }

  const batches = await Promise.all(
    ((data ?? []) as unknown as BatchRow[]).map((row) => buildBatchSummary(row)),
  );

  return { ok: true, data: batches };
}


/**
 * Drain the remaining pending recipients of one batch (authorized).
 *
 * This is the "send remaining / continue" action the composing screen uses
 * after the first bounded attempt, and the safe way to retry a partially failed
 * batch: ONLY pending rows are attempted — accepted or permanently failed
 * recipients are never re-sent.
 *
 * The batch must belong to the event in the route (cross-competition draining
 * is impossible) and authorization is re-checked with `canManageEvent`.
 */
export async function processCompetitionBulkEmailBatch(
  eventId: string,
  batchId: string,
  actorProfileId: string,
): Promise<CompetitionMutationResult<CompetitionBulkEmailBatchSummary>> {
  if (!eventId || !batchId || !actorProfileId) {
    return {
      ok: false,
      error: "Event, batch and profile are required",
      status: 400,
    };
  }
  if (!(await canManageEvent(eventId, actorProfileId))) {
    return {
      ok: false,
      error: "Not authorized to send this message batch",
      status: 403,
    };
  }

  const drained = await processBulkEmailBatchForEvent(eventId, batchId);
  if (!drained) {
    return { ok: false, error: "Message batch not found", status: 404 };
  }

  return getCompetitionBulkEmailBatch(eventId, batchId, actorProfileId);
}
