/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — Server-side "Email Users" helpers.
 *
 * Conventions match the other `*-server.ts` modules: `server-only`, service-role
 * client, discriminated-result error handling, no thrown errors.
 *
 * Every entry point:
 *   1. re-checks the ADMINISTRATOR capability (the same server-only
 *      `MULTI_TEAM_ADMIN_USER_ID` gate used by competition creation),
 *   2. derives the acting identity from the authenticated session (the caller
 *      passes the session profile id; a request body can never supply it),
 *   3. resolves the audience from the DATABASE at call time — a client-supplied
 *      recipient list or count is never trusted,
 *   4. returns COUNTS or a server-built preview only. Recipient addresses are
 *      never part of any result shape that reaches the browser.
 *
 * Audience sources (the authoritative user/registration data):
 *   * all users        → `profiles` (email is the canonical address),
 *   * previous event   → `competition_participants` rows of that event joined to
 *     `profiles` — HISTORICAL rows are included (a completed event, or a
 *     participant who later withdrew, is still "participated in").
 *
 * Optional promoted competition:
 *   * recipients already holding an ACTIVE registration (`removed_at IS NULL`)
 *     for the promoted competition are excluded by PROFILE IDENTITY, for BOTH
 *     audiences,
 *   * the registration link is resolved by `resolvePromotionJoinLink`
 *     (reused when an active link already exists, otherwise created once).
 */

import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isEmailConfigured } from "@/lib/email/config";
import {
  getCompetitionEvent,
  isCompetitionCreationAdmin,
  type CompetitionMutationResult,
} from "@/lib/competition-server";
import {
  deriveAnnouncementState,
  isAnnouncementId,
  normalizeAnnouncementAudience,
  resolveAnnouncementAudience,
  validateAnnouncementInput,
  type AnnouncementAudienceRow,
  type AnnouncementRecipient,
} from "@/lib/email-announcements";
import { buildEmailAnnouncementEmail } from "@/lib/email/templates/email-announcement";
import { resolvePromotionJoinLink } from "@/lib/email-announcements-join-link";
import {
  processAnnouncementBatch,
  scheduleAnnouncementProcessing,
} from "@/lib/email-announcements-delivery";
import {
  ANNOUNCEMENT_IMAGE_BUCKET,
  type EmailAnnouncementAudienceSummary,
  type EmailAnnouncementAudienceType,
  type EmailAnnouncementBatchSummary,
  type EmailAnnouncementCompetitionOption,
  type EmailAnnouncementPreview,
} from "@/types/email-announcement";

/** Recipient rows are inserted in chunked requests (never one huge insert). */
const RECIPIENT_INSERT_CHUNK_SIZE = 250;

/** Page size / safety cap for audience reads (Supabase caps a response at 1000). */
const AUDIENCE_PAGE_SIZE = 1000;
const AUDIENCE_MAX_ROWS = 50000;

/**
 * The administrator capability for this feature: the SAME server-only
 * `MULTI_TEAM_ADMIN_USER_ID` gate that already protects competition creation
 * (COMP-007). Fails CLOSED when the variable is missing.
 */
export function isAnnouncementsAdmin(
  profileId: string | null | undefined,
): boolean {
  return isCompetitionCreationAdmin(profileId);
}

// ─── Paged reads ────────────────────────────────────────────────────────────

interface PagedQuery<T> {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * Read EVERY row of a query by paging, so an audience larger than Supabase's
 * 1000-row response cap is never silently truncated.
 */
async function fetchAllPages<T>(
  label: string,
  makeQuery: () => PagedQuery<T>,
): Promise<T[] | null> {
  const all: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await makeQuery().range(
      from,
      from + AUDIENCE_PAGE_SIZE - 1,
    );

    if (error) {
      console.error(`${label}: query failed`, {
        code: (error as { code?: string } | null)?.code,
      });
      return null;
    }

    const batch = (data ?? []) as T[];
    all.push(...batch);

    if (batch.length < AUDIENCE_PAGE_SIZE) break;
    from += AUDIENCE_PAGE_SIZE;
    if (all.length >= AUDIENCE_MAX_ROWS) break;
  }

  return all;
}

// ─── Audience resolution (server-authoritative) ─────────────────────────────

interface RawProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
}

interface RawParticipantRow {
  profile_id: string;
  profile: { email: string | null; full_name: string | null } | null;
}

async function loadAllUserRows(): Promise<AnnouncementAudienceRow[] | null> {
  const rows = await fetchAllPages<RawProfileRow>("loadAllUserRows", () =>
    supabaseAdmin
      .from("profiles")
      .select("id, email, full_name")
      .not("email", "is", null) as unknown as PagedQuery<RawProfileRow>,
  );

  if (!rows) return null;
  return rows.map((row) => ({
    profileId: row.id,
    email: row.email,
    fullName: row.full_name,
  }));
}

async function loadPreviousCompetitionRows(
  eventId: string,
): Promise<AnnouncementAudienceRow[] | null> {
  // HISTORICAL registrations are included: `removed_at` is deliberately NOT
  // filtered, and the event's status is irrelevant (completed events count).
  const rows = await fetchAllPages<RawParticipantRow>(
    "loadPreviousCompetitionRows",
    () =>
      supabaseAdmin
        .from("competition_participants")
        .select(
          "profile_id, profile:profiles!competition_participants_profile_id_fkey(email, full_name)",
        )
        .eq("event_id", eventId) as unknown as PagedQuery<RawParticipantRow>,
  );

  if (!rows) return null;
  return rows.map((row) => ({
    profileId: row.profile_id,
    email: row.profile?.email ?? null,
    fullName: row.profile?.full_name ?? null,
  }));
}

/**
 * Profiles that already hold an ACTIVE registration for the promoted event.
 * Identity based (profile ids), never email matching.
 */
async function loadRegisteredProfileIds(
  eventId: string,
): Promise<Set<string> | null> {
  const rows = await fetchAllPages<{ profile_id: string }>(
    "loadRegisteredProfileIds",
    () =>
      supabaseAdmin
        .from("competition_participants")
        .select("profile_id")
        .eq("event_id", eventId)
        .is("removed_at", null) as unknown as PagedQuery<{
        profile_id: string;
      }>,
  );

  if (!rows) return null;
  return new Set(rows.map((row) => row.profile_id));
}

interface AudienceResolution {
  recipients: AnnouncementRecipient[];
  summary: EmailAnnouncementAudienceSummary;
}

/** Resolve the deliverable audience (never returned to the browser raw). */
async function resolveAudience(input: {
  audienceType: EmailAnnouncementAudienceType;
  previousCompetitionId: string | null;
  promotionCompetitionId: string | null;
}): Promise<CompetitionMutationResult<AudienceResolution>> {
  const rows =
    input.audienceType === "previous_competition"
      ? await loadPreviousCompetitionRows(input.previousCompetitionId as string)
      : await loadAllUserRows();

  if (!rows) {
    return { ok: false, error: "Failed to resolve the audience", status: 500 };
  }

  let registeredProfileIds = new Set<string>();
  if (input.promotionCompetitionId) {
    const loaded = await loadRegisteredProfileIds(input.promotionCompetitionId);
    if (!loaded) {
      return {
        ok: false,
        error: "Failed to check existing registrations",
        status: 500,
      };
    }
    registeredProfileIds = loaded;
  }

  return {
    ok: true,
    data: resolveAnnouncementAudience(rows, {
      audienceType: input.audienceType,
      promotionEventId: input.promotionCompetitionId,
      registeredProfileIds,
    }),
  };
}



// ─── Batch row mapping ──────────────────────────────────────────────────────

const BATCH_COLUMNS =
  "id, audience_type, previous_event_id, promotion_event_id, promotion_url, image_url, subject, created_at, eligible_count, invalid_count, duplicate_count, excluded_registered_count";

interface BatchRow {
  id: string;
  audience_type: string;
  previous_event_id: string | null;
  promotion_event_id: string | null;
  promotion_url: string | null;
  image_url: string | null;
  subject: string;
  created_at: string;
  eligible_count: number;
  invalid_count: number;
  duplicate_count: number;
  excluded_registered_count: number;
}

function audienceFromBatchRow(row: BatchRow): EmailAnnouncementAudienceSummary {
  const eligible = row.eligible_count ?? 0;
  const invalid = row.invalid_count ?? 0;
  const duplicate = row.duplicate_count ?? 0;
  const excluded = row.excluded_registered_count ?? 0;
  return {
    audienceType: row.audience_type as EmailAnnouncementAudienceType,
    baseCount: eligible + invalid + duplicate + excluded,
    eligibleCount: eligible,
    invalidCount: invalid,
    duplicateCount: duplicate,
    excludedRegisteredCount: excluded,
    promotionEventId: row.promotion_event_id ?? null,
  };
}

/** Count the recorded per-recipient outcomes of a batch (status only). */
async function getBatchOutcomeCounts(batchId: string): Promise<{
  acceptedCount: number;
  failedCount: number;
  pendingCount: number;
}> {
  const { data, error } = await supabaseAdmin
    .from("email_announcement_recipients")
    .select("status")
    .eq("batch_id", batchId);

  if (error) {
    console.error("getBatchOutcomeCounts: query failed", {
      batchId,
      code: (error as { code?: string }).code,
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
): Promise<EmailAnnouncementBatchSummary> {
  const counts = await getBatchOutcomeCounts(row.id);
  const audience = audienceFromBatchRow(row);

  return {
    id: row.id,
    subject: row.subject,
    createdAt: row.created_at,
    audience,
    acceptedCount: counts.acceptedCount,
    failedCount: counts.failedCount,
    pendingCount: counts.pendingCount,
    state: deriveAnnouncementState({
      eligibleCount: audience.eligibleCount,
      acceptedCount: counts.acceptedCount,
      failedCount: counts.failedCount,
      pendingCount: counts.pendingCount,
    }),
    promotionEventId: row.promotion_event_id ?? null,
    imageIncluded: !!row.image_url,
  };
}

// ─── Image URL validation ───────────────────────────────────────────────────

/**
 * Whether an image URL belongs to this feature's public Supabase Storage
 * bucket. Prevents an announcement from embedding an arbitrary external URL.
 */
export function isAllowedAnnouncementImageUrl(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return false;
  return url.startsWith(
    `${base}/storage/v1/object/public/${ANNOUNCEMENT_IMAGE_BUCKET}/`,
  );
}

// ─── Competition options ────────────────────────────────────────────────────

/** Every competition (any status) — the previous-audience dropdown. */
export async function listAnnouncementCompetitionOptions(): Promise<
  CompetitionMutationResult<EmailAnnouncementCompetitionOption[]>
> {
  const { data, error } = await supabaseAdmin
    .from("competition_events")
    .select("id, name, event_date, status")
    .order("event_date", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) {
    console.error("listAnnouncementCompetitionOptions: query failed", {
      code: (error as { code?: string }).code,
    });
    return { ok: false, error: "Failed to load competitions", status: 500 };
  }

  const events = ((data ?? []) as {
    id: string;
    name: string;
    event_date: string | null;
    status: EmailAnnouncementCompetitionOption["status"];
  }[]).map((row) => ({
    id: row.id,
    name: row.name,
    eventDate: row.event_date,
    status: row.status,
  }));

  return { ok: true, data: events };
}

// ─── Compose inputs ─────────────────────────────────────────────────────────

export interface AnnouncementComposeInput {
  /** The acting profile id — ALWAYS the authenticated session profile. */
  actorProfileId: string;
  subject: unknown;
  message: unknown;
  audienceType: unknown;
  previousCompetitionId: unknown;
  promotionCompetitionId: unknown;
  imageUrl: unknown;
  /** Trusted request origin used to build the absolute registration link. */
  origin: string;
}

export interface AnnouncementSendInput extends AnnouncementComposeInput {
  /** Client-supplied idempotency key for THIS compose session (a UUID). */
  requestId: unknown;
}

/** A UUID v4-shaped string (the shape `crypto.randomUUID()` produces). */
function isRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

interface ResolvedPromotion {
  eventId: string;
  name: string;
  url: string;
}

/**
 * Resolve the optional promoted competition: its display name plus the
 * registration URL. Reuses an existing active link when one has already been
 * resolved for this feature (never regenerates on every preview refresh).
 */
async function resolvePromotion(
  promotionEventId: string | null,
  actorProfileId: string,
  origin: string,
): Promise<CompetitionMutationResult<ResolvedPromotion | null>> {
  if (!promotionEventId) return { ok: true, data: null };

  const link = await resolvePromotionJoinLink(
    promotionEventId,
    actorProfileId,
    origin,
  );
  if (!link.ok) return link;

  const event = await getCompetitionEvent(promotionEventId);
  if (!event) {
    return { ok: false, error: "Promoted competition not found", status: 404 };
  }

  return {
    ok: true,
    data: { eventId: promotionEventId, name: event.name, url: link.data.url },
  };
}

// ─── Audience counts (no send) ──────────────────────────────────────────────

export interface AnnouncementAudienceQueryInput {
  actorProfileId: string;
  audienceType: unknown;
  previousCompetitionId: unknown;
  promotionCompetitionId: unknown;
}

/**
 * Resolve and return ONLY the audience counts (recipient count after
 * exclusions). Nothing is sent and nothing is stored — this is what the panel
 * calls when the audience selection changes.
 */
export async function getAnnouncementAudience(
  input: AnnouncementAudienceQueryInput,
): Promise<CompetitionMutationResult<EmailAnnouncementAudienceSummary>> {
  if (!input.actorProfileId) {
    return {
      ok: false,
      error: "Administrator profile is required",
      status: 400,
    };
  }
  if (!isAnnouncementsAdmin(input.actorProfileId)) {
    return {
      ok: false,
      error: "Not authorized to resolve this audience",
      status: 403,
    };
  }

  const audience = normalizeAnnouncementAudience({
    audienceType: input.audienceType,
    previousCompetitionId: input.previousCompetitionId,
    promotionCompetitionId: input.promotionCompetitionId,
  });
  if (!audience.ok) {
    return { ok: false, error: audience.error, status: 400 };
  }

  const resolved = await resolveAudience({
    audienceType: audience.audienceType,
    previousCompetitionId: audience.previousCompetitionId,
    promotionCompetitionId: audience.promotionCompetitionId,
  });
  if (!resolved.ok) return resolved;

  return { ok: true, data: resolved.data.summary };
}

// ─── Preview ────────────────────────────────────────────────────────────────

/**
 * Build a server-rendered preview of the email (and the current audience count)
 * WITHOUT sending anything. Authorization and validation both apply.
 *
 * The preview is built by the SAME template and the SAME renderer the delivery
 * processor uses, so what the administrator previews is what a recipient
 * receives (including the registration link and the escaping).
 */
export async function previewEmailAnnouncement(
  input: AnnouncementComposeInput,
): Promise<CompetitionMutationResult<EmailAnnouncementPreview>> {
  if (!input.actorProfileId) {
    return {
      ok: false,
      error: "Administrator profile is required",
      status: 400,
    };
  }
  if (!isAnnouncementsAdmin(input.actorProfileId)) {
    return {
      ok: false,
      error: "Not authorized to send user announcements",
      status: 403,
    };
  }

  const validation = validateAnnouncementInput({
    subject: input.subject,
    message: input.message,
    audienceType: input.audienceType,
    previousCompetitionId: input.previousCompetitionId,
    promotionCompetitionId: input.promotionCompetitionId,
    imageUrl: input.imageUrl,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.error, status: 400 };
  }
  if (
    validation.imageUrl &&
    !isAllowedAnnouncementImageUrl(validation.imageUrl)
  ) {
    return {
      ok: false,
      error: "The attached image is not a valid uploaded image.",
      status: 400,
    };
  }

  const resolved = await resolveAudience({
    audienceType: validation.audienceType,
    previousCompetitionId: validation.previousCompetitionId,
    promotionCompetitionId: validation.promotionCompetitionId,
  });
  if (!resolved.ok) return resolved;

  const promotion = await resolvePromotion(
    validation.promotionCompetitionId,
    input.actorProfileId,
    input.origin,
  );
  if (!promotion.ok) return promotion;

  // The preview uses a fixed placeholder recipient; no real address is read,
  // stored or returned.
  const email = buildEmailAnnouncementEmail({
    to: "recipient@example.com",
    recipientName: null,
    subject: validation.subject,
    message: validation.message,
    imageUrl: validation.imageUrl,
    promotion: promotion.data
      ? { name: promotion.data.name, url: promotion.data.url }
      : null,
  });

  return {
    ok: true,
    data: {
      subject: email.subject,
      html: email.html,
      text: email.text ?? "",
      audience: resolved.data.summary,
    },
  };
}


// ─── Send ───────────────────────────────────────────────────────────────────

/** Fetch a batch by its idempotency key. */
async function findBatchByRequest(
  requestId: string,
): Promise<BatchRow | null> {
  const { data, error } = await supabaseAdmin
    .from("email_announcement_batches")
    .select(BATCH_COLUMNS)
    .eq("request_id", requestId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as BatchRow;
}

/** Remove a batch that could not be fully enqueued (cascades its recipients). */
async function deleteBatch(batchId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("email_announcement_batches")
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
 * Enqueue a batch (one message per recipient) and schedule processing.
 *
 * Order of operations:
 *   1. authorize the administrator — a failed authorize/validate sends NOTHING,
 *   2. validate the subject/message/audience/image (untrusted input),
 *   3. validate the idempotency `requestId`,
 *   4. fail fast (and honestly) when the Brevo transport is unconfigured,
 *   5. RE-resolve the audience from the database (never a client-supplied list),
 *   6. resolve the promoted competition's registration link (reused when it has
 *      already been resolved for this feature),
 *   7. create the batch + one recipient row per deliverable address, then
 *   8. schedule the first delivery attempt after the response via `after()`.
 *
 * Idempotency: the first request for a given `requestId` wins; a repeat (double
 * click / retry) returns the EXISTING batch and sends nothing new.
 *
 * Nothing is reported as delivered here — the batch starts fully `pending`.
 */
export async function sendEmailAnnouncement(
  input: AnnouncementSendInput,
): Promise<CompetitionMutationResult<EmailAnnouncementBatchSummary>> {
  const { actorProfileId } = input;
  if (!actorProfileId) {
    return {
      ok: false,
      error: "Administrator profile is required",
      status: 400,
    };
  }
  if (!isAnnouncementsAdmin(actorProfileId)) {
    return {
      ok: false,
      error: "Not authorized to send user announcements",
      status: 403,
    };
  }

  const validation = validateAnnouncementInput({
    subject: input.subject,
    message: input.message,
    audienceType: input.audienceType,
    previousCompetitionId: input.previousCompetitionId,
    promotionCompetitionId: input.promotionCompetitionId,
    imageUrl: input.imageUrl,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.error, status: 400 };
  }
  if (
    validation.imageUrl &&
    !isAllowedAnnouncementImageUrl(validation.imageUrl)
  ) {
    return {
      ok: false,
      error: "The attached image is not a valid uploaded image.",
      status: 400,
    };
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

  // Fail fast (and honestly) when the transport is unconfigured, instead of
  // queueing a batch that can only fail.
  if (!isEmailConfigured()) {
    return {
      ok: false,
      error: "Email is not configured on this deployment.",
      status: 503,
    };
  }

  // Idempotency: an existing batch for this request is returned as-is.
  const existing = await findBatchByRequest(requestId);
  if (existing) {
    return { ok: true, data: await buildBatchSummary(existing) };
  }

  // Re-resolve the eligible audience at SEND time (server-truth).
  const resolved = await resolveAudience({
    audienceType: validation.audienceType,
    previousCompetitionId: validation.previousCompetitionId,
    promotionCompetitionId: validation.promotionCompetitionId,
  });
  if (!resolved.ok) return resolved;
  const { recipients, summary } = resolved.data;


  // Resolve the promoted competition's link BEFORE creating the batch, so a
  // missing ambassador / closed competition is a clean error and no batch is
  // queued. The resolved URL is stored on the batch, guaranteeing that the
  // delivered email uses the exact same link as the preview.
  const promotion = await resolvePromotion(
    validation.promotionCompetitionId,
    actorProfileId,
    input.origin,
  );
  if (!promotion.ok) return promotion;

  const batchId = randomUUID();
  const { error: batchError } = await supabaseAdmin
    .from("email_announcement_batches")
    .insert({
      id: batchId,
      audience_type: validation.audienceType,
      previous_event_id: validation.previousCompetitionId,
      promotion_event_id: promotion.data ? promotion.data.eventId : null,
      promotion_url: promotion.data ? promotion.data.url : null,
      image_url: validation.imageUrl,
      subject: validation.subject,
      body_text: validation.message,
      sent_by_profile_id: actorProfileId,
      request_id: requestId,
      eligible_count: summary.eligibleCount,
      invalid_count: summary.invalidCount,
      duplicate_count: summary.duplicateCount,
      excluded_registered_count: summary.excludedRegisteredCount,
    });

  if (batchError) {
    // A concurrent request with the same request id won the race: return it.
    if ((batchError as { code?: string }).code === "23505") {
      const winner = await findBatchByRequest(requestId);
      if (winner) return { ok: true, data: await buildBatchSummary(winner) };
    }
    console.error("sendEmailAnnouncement: batch insert failed", {
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
        .from("email_announcement_recipients")
        .insert(chunk);

      if (recipientError) {
        // Never leave a batch that claims recipients it does not have: delete it
        // (the cascade removes any recipients already inserted). Nothing has been
        // sent yet, so this is safe.
        console.error("sendEmailAnnouncement: recipient insert failed", {
          batchId,
          code: recipientError.code,
        });
        await deleteBatch(batchId);
        return { ok: false, error: "Failed to queue the message", status: 500 };
      }
    }

    // First attempt after the response is sent — the request never waits on Brevo.
    scheduleAnnouncementProcessing(batchId);
  }

  return {
    ok: true,
    data: {
      id: batchId,
      subject: validation.subject,
      createdAt: new Date().toISOString(),
      audience: summary,
      acceptedCount: 0,
      failedCount: 0,
      pendingCount: recipients.length,
      state: deriveAnnouncementState({
        eligibleCount: summary.eligibleCount,
        acceptedCount: 0,
        failedCount: 0,
        pendingCount: recipients.length,
      }),
      promotionEventId: promotion.data ? promotion.data.eventId : null,
      imageIncluded: !!validation.imageUrl,
    },
  };
}


// ─── Batch lookup / drain ───────────────────────────────────────────────────

/** List the most recent announcement batches (summaries only). */
export async function listEmailAnnouncementBatches(
  actorProfileId: string,
  limit = 5,
): Promise<CompetitionMutationResult<EmailAnnouncementBatchSummary[]>> {
  if (!actorProfileId) {
    return {
      ok: false,
      error: "Administrator profile is required",
      status: 400,
    };
  }
  if (!isAnnouncementsAdmin(actorProfileId)) {
    return {
      ok: false,
      error: "Not authorized to view announcement batches",
      status: 403,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("email_announcement_batches")
    .select(BATCH_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 20)));

  if (error) {
    console.error("listEmailAnnouncementBatches: query failed", {
      code: error.code,
    });
    return {
      ok: false,
      error: "Failed to load announcement batches",
      status: 500,
    };
  }

  const batches = await Promise.all(
    ((data ?? []) as unknown as BatchRow[]).map((row) => buildBatchSummary(row)),
  );

  return { ok: true, data: batches };
}

/** Fetch one announcement batch's recorded outcomes (administrator only). */
export async function getEmailAnnouncementBatch(
  batchId: string,
  actorProfileId: string,
): Promise<CompetitionMutationResult<EmailAnnouncementBatchSummary>> {
  if (!batchId || !actorProfileId) {
    return { ok: false, error: "Batch and profile are required", status: 400 };
  }
  if (!isAnnouncementsAdmin(actorProfileId)) {
    return {
      ok: false,
      error: "Not authorized to view this announcement batch",
      status: 403,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("email_announcement_batches")
    .select(BATCH_COLUMNS)
    .eq("id", batchId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Announcement batch not found", status: 404 };
  }

  return {
    ok: true,
    data: await buildBatchSummary(data as unknown as BatchRow),
  };
}

/**
 * Drain the remaining pending recipients of one batch (administrator only).
 *
 * Only `pending` rows are attempted — accepted or permanently failed recipients
 * are never re-sent, so this is the safe way to continue/retry a partially
 * failed announcement.
 */
export async function processEmailAnnouncementBatch(
  batchId: string,
  actorProfileId: string,
): Promise<CompetitionMutationResult<EmailAnnouncementBatchSummary>> {
  if (!batchId || !actorProfileId) {
    return { ok: false, error: "Batch and profile are required", status: 400 };
  }
  if (!isAnnouncementsAdmin(actorProfileId)) {
    return {
      ok: false,
      error: "Not authorized to send this announcement batch",
      status: 403,
    };
  }

  const existing = await getEmailAnnouncementBatch(batchId, actorProfileId);
  if (!existing.ok) return existing;

  await processAnnouncementBatch(batchId);
  return getEmailAnnouncementBatch(batchId, actorProfileId);
}

