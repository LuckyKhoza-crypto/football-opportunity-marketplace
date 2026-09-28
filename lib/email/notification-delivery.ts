/**
 * EMAIL-002 — Durable email notification outbox (server-only).
 *
 * This module is the ONLY place that:
 *   * enqueues an email delivery row for an email-enabled notification, and
 *   * processes pending delivery rows and hands them to the EMAIL-001 service.
 *
 * Design constraints (see the EMAIL-002 ticket):
 *   * `notifications` stays the canonical event/source layer.
 *   * Emails are NEVER sent synchronously from createNotification().
 *   * Brevo failures never fail the marketplace operation that raised the
 *     notification — enqueue is best-effort and logs safely.
 *   * Delivery claiming is concurrency-safe (PostgreSQL FOR UPDATE SKIP LOCKED
 *     inside the `claim_next_email_delivery` RPC, migration 0021).
 *   * Retries are bounded with exponential backoff driven by `available_at`.
 *   * A crashed worker cannot permanently strand a row in `sending`.
 *
 * The delivery table is not exposed to clients (RLS with no policies); all
 * access here is through the service-role client.
 */

import "server-only";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildFomEmailShell, escapeHtml } from "@/lib/email/templates/fom-email-shell";
import { sendTransactionalEmail } from "@/lib/email/email-service";
import type { TransactionalEmail } from "@/lib/email/types";
import { parseNotificationData } from "@/lib/notification-data";
import { buildOutreachMessageEmail } from "@/lib/email/templates/outreach-message";
import { buildApplicationStatusEmail } from "@/lib/email/templates/application-status";

// ─── Email-enabled notification types (centralized allowlist) ───────────────
//
// The initial architecture explicitly supports TWO categories. Keep this list
// small and centralized so the decision "should this notification email?"
// is easy to find and change. Do NOT grow this into a rules engine.
//
// The parameter is a plain `string` (not the NotificationType union) to avoid a
// runtime circular import with lib/notifications.ts.

const EMAIL_ENABLED_NOTIFICATION_TYPES: readonly string[] = [
  "message_received",
  "application_status_changed",
];

/** Whether a notification type should currently generate an email delivery. */
export function isEmailNotificationType(type: string): boolean {
  return EMAIL_ENABLED_NOTIFICATION_TYPES.includes(type);
}

// ─── Delivery processor configuration ───────────────────────────────────────

/** Maximum number of send attempts before a delivery is marked `failed`. */
export const EMAIL_DELIVERY_MAX_ATTEMPTS = 5;

/**
 * A row left in `sending` for longer than this is assumed to belong to a
 * crashed worker and is requeued (see migration 0021).
 */
export const EMAIL_DELIVERY_STALE_SECONDS = 300;

/** Default number of rows processed per processor invocation. */
export const EMAIL_DELIVERY_BATCH_SIZE = 25;

const RETRY_BASE_DELAY_SECONDS = 60;
const RETRY_MAX_DELAY_SECONDS = 6 * 60 * 60; // 6 hours

/**
 * Exponential backoff: 60s, 120s, 240s, ... capped at 6h.
 * `attempts` is the number of attempts already made for the delivery.
 */
export function computeRetryDelaySeconds(attempts: number): number {
  if (attempts <= 0) return RETRY_BASE_DELAY_SECONDS;
  const delay = RETRY_BASE_DELAY_SECONDS * 2 ** (attempts - 1);
  return Math.min(delay, RETRY_MAX_DELAY_SECONDS);
}

// ─── Enqueue ────────────────────────────────────────────────────────────────

export interface EnqueueEmailDeliveryInput {
  notificationId: string;
  userId: string;
  type: string;
}

export interface EnqueueEmailDeliveryResult {
  enqueued: boolean;
  /** True when an existing delivery row already existed (dedupe). */
  deduplicated?: boolean;
  skipped?: boolean;
}

/**
 * Resolve a user's recipient email from profiles.email (the canonical
 * recipient relationship: notifications.user_id → profiles.id → profiles.email).
 *
 * NEVER uses auth.users. Returns null when the profile has no usable email.
 */
async function resolveRecipientEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;
  const email = (data as { email?: string | null }).email;
  return email && email.trim().length > 0 ? email.trim() : null;
}

/**
 * Create the email delivery row for a successfully-created notification.
 *
 * This runs AFTER the notification row exists and is intentionally isolated:
 * any failure here is swallowed (logged safely) so the original marketplace
 * operation and the notification are unaffected.
 *
 * Dedupe: `notification_id` is UNIQUE, so a duplicate insert returns 23505 and
 * is treated as already-enqueued.
 */
export async function enqueueEmailDeliveryForNotification(
  input: EnqueueEmailDeliveryInput,
): Promise<EnqueueEmailDeliveryResult> {
  const { notificationId, userId, type } = input;

  if (!isEmailNotificationType(type)) {
    return { enqueued: false, skipped: true };
  }

  try {
    const recipientEmail = await resolveRecipientEmail(userId);
    if (!recipientEmail) {
      // No usable recipient address — nothing to enqueue. Not an error.
      return { enqueued: false, skipped: true };
    }

    const { error } = await supabaseAdmin
      .from("email_notification_deliveries")
      .insert({
        notification_id: notificationId,
        recipient_email: recipientEmail,
        status: "pending",
      });

    if (error) {
      if (error.code === "23505") {
        // Already enqueued for this notification — safe dedupe.
        return { enqueued: false, deduplicated: true };
      }
      // Infrastructure unavailable — never fail the caller.
      console.error(
        "[email] failed to enqueue notification delivery",
        { notificationId, code: error.code },
      );
      return { enqueued: false };
    }

    return { enqueued: true };
  } catch (err) {
    // Defensive: enqueue must never throw into createNotification().
    console.error("[email] unexpected error enqueuing notification delivery", {
      notificationId,
      message: err instanceof Error ? err.message : "unknown",
    });
    return { enqueued: false };
  }
}

// ─── Email construction ─────────────────────────────────────────────────────

interface NotificationContent {
  title: string;
  body: string;
  link: string | null;
  /** EMAIL-003: typed payload used to specialize certain notifications. */
  data?: unknown;
}

/** Build an absolute URL for an email CTA from a relative app link. */
function toAbsoluteUrl(link: string | null): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  const base = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  if (!base) return null;
  return link.startsWith("/") ? `${base}${link}` : `${base}/${link}`;
}

/**
 * Derive a transactional email from an in-app notification.
 *
 * EMAIL-003: when the notification carries a recognized typed payload, the
 * email is specialized (e.g. the "team contacted you" outreach email).
 * Otherwise this falls back to the generic EMAIL-001 shell + notification
 * copy, which preserves EMAIL-002 behavior for every other notification.
 *
 * EMAIL-004 (application status) can add its own branch here.
 */
export function buildNotificationEmail(
  notification: NotificationContent,
  recipientEmail: string,
): TransactionalEmail {
  const typed = parseNotificationData(notification.data);

  if (typed?.kind === "outreach") {
    return buildOutreachMessageEmail({
      to: recipientEmail,
      conversationUrl: toAbsoluteUrl(notification.link),
      data: typed,
    });
  }

  if (typed?.kind === "application_status_changed") {
    return buildApplicationStatusEmail({
      to: recipientEmail,
      applicationUrl: toAbsoluteUrl(notification.link),
      data: typed,
    });
  }

  const bodyHtml = `<p style="margin:0 0 12px 0;">${escapeHtml(
    notification.body,
  )}</p>`;

  const absolute = toAbsoluteUrl(notification.link);
  const { html, text } = buildFomEmailShell({
    title: notification.title,
    bodyHtml,
    bodyText: notification.body,
    cta: absolute ? { label: "View on FOM Sports", href: absolute } : undefined,
  });

  return {
    to: { email: recipientEmail },
    subject: notification.title,
    html,
    text,
  };
}

// ─── Safe error handling ────────────────────────────────────────────────────

/**
 * Produce a short, safe failure description.
 *
 * The EMAIL-001 errors never carry the API key, auth headers, or raw provider
 * bodies. As defense-in-depth this also redacts the configured key and common
 * secret-bearing header patterns, and truncates.
 */
export function sanitizeDeliveryError(error: unknown): string {
  let message = "Email delivery failed.";
  if (error instanceof Error && error.message) {
    message = error.message;
  } else if (typeof error === "string" && error.length > 0) {
    message = error;
  }

  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (apiKey && apiKey.length > 0) {
    message = message.split(apiKey).join("[redacted]");
  }
  message = message
    .replace(/api-key["'\s:=]+[A-Za-z0-9._\-]+/gi, "api-key [redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]");

  return message.slice(0, 500);
}

// ─── Processor ──────────────────────────────────────────────────────────────

export interface ProcessorOptions {
  /** Maximum rows to process this invocation. */
  limit?: number;
  /** Attempts before a delivery is marked failed. */
  maxAttempts?: number;
  /** Age (seconds) after which a `sending` row is considered stale. */
  staleSeconds?: number;
  /** Injectable for tests; defaults to the EMAIL-001 service. */
  sender?: (email: TransactionalEmail) => Promise<{ messageId: string }>;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export interface ProcessorResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

interface ClaimedDeliveryRow {
  id: string;
  notification_id: string;
  recipient_email: string;
  attempts: number;
}

/** Fetch the notification content needed to build the email. */
async function fetchNotificationContent(
  notificationId: string,
): Promise<NotificationContent | null> {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("title, body, link, data")
    .eq("id", notificationId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    title: string;
    body: string;
    link: string | null;
    data: unknown;
  };
  return {
    title: row.title,
    body: row.body,
    link: row.link ?? null,
    data: row.data ?? null,
  };
}

/**
 * Process pending email deliveries.
 *
 * For each claimed row:
 *   1. build the email from its notification,
 *   2. send via EMAIL-001,
 *   3. on success → `sent` + provider message id,
 *   4. on failure → bounded retry (`available_at` backoff) or `failed`.
 *
 * Claiming is atomic in the database, so concurrent invocations cannot send
 * the same email twice.
 */
export async function processEmailDeliveries(
  options: ProcessorOptions = {},
): Promise<ProcessorResult> {
  const limit = options.limit ?? EMAIL_DELIVERY_BATCH_SIZE;
  const maxAttempts = options.maxAttempts ?? EMAIL_DELIVERY_MAX_ATTEMPTS;
  const staleSeconds = options.staleSeconds ?? EMAIL_DELIVERY_STALE_SECONDS;
  const now = options.now ?? (() => new Date());
  const sender =
    options.sender ??
    (async (email: TransactionalEmail) => {
      const result = await sendTransactionalEmail(email);
      return { messageId: result.messageId };
    });

  const result: ProcessorResult = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
  };

  for (let i = 0; i < limit; i += 1) {
    const { data, error } = await supabaseAdmin.rpc("claim_next_email_delivery", {
      p_stale_seconds: staleSeconds,
      p_max_attempts: maxAttempts,
    });

    if (error) {
      console.error("[email] failed to claim delivery:", {
        code: (error as { code?: string }).code,
      });
      break;
    }

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const claimed = rows[0] as ClaimedDeliveryRow | undefined;
    if (!claimed) break;

    result.claimed += 1;

    const notification = await fetchNotificationContent(claimed.notification_id);
    if (!notification) {
      // The parent notification no longer exists (or is unreadable). There is
      // nothing to send; retrying cannot help. Mark failed with a safe reason.
      await markFailed(
        claimed.id,
        "Associated notification is no longer available.",
      );
      result.failed += 1;
      continue;
    }

    const email = buildNotificationEmail(
      notification,
      claimed.recipient_email,
    );

    try {
      const { messageId } = await sender(email);
      await markSent(claimed.id, messageId, now());
      result.sent += 1;
    } catch (err) {
      const safeError = sanitizeDeliveryError(err);
      if (claimed.attempts >= maxAttempts) {
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

// ─── Immediate (best-effort) processing trigger ─────────────────────────────
//
// EMAIL-002A: after a notification durably enqueues a NEW email delivery, we
// want the first attempt to happen as soon as possible WITHOUT making the
// marketplace request wait on Brevo.
//
// This reuses the EXISTING processor (processEmailDeliveries) and the EXISTING
// durable outbox/claim/retry mechanism. It is intentionally NOT a scheduler,
// cron, polling loop, timer or second processor.
//
// Next.js `after()` runs the callback AFTER the response has been sent, so the
// outreach/notification request returns immediately and Brevo latency is never
// on the user-facing critical path. The callback is fully guarded: any failure
// is logged safely and can never surface into the caller.
//
// LIMITATION (by design — no recurring scheduler in this project): this only
// performs the immediate first attempt. A failed delivery stays durably queued
// (`pending` + backoff `available_at`); without a recurring scheduler a future
// retry requires another invocation of this same processing path.
export function scheduleEmailDeliveryProcessing(
  options: ProcessorOptions = {},
): void {
  const run = () =>
    processEmailDeliveries(options).then(
      () => undefined,
      (err) => {
        console.error("[email] background delivery processing failed:", {
          message: err instanceof Error ? err.message : "unknown",
        });
      },
    );

  try {
    // Register the background task. `after()` must be called within a request
    // scope (route handler / server action); when unavailable (e.g. unit tests
    // or a non-request context) this is a harmless no-op.
    after(run);
  } catch {
    // No `after()` scope — best-effort only. Never break the caller.
  }
}

async function markSent(
  id: string,
  messageId: string,
  now: Date,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("email_notification_deliveries")
    .update({
      status: "sent",
      sent_at: now.toISOString(),
      provider_message_id: messageId || null,
      last_error: null,
    })
    .eq("id", id);

  if (error) {
    // The send succeeded; a persistence failure here only means the row will be
    // retried later. Log safely without secrets.
    console.error("[email] failed to persist sent delivery:", {
      id,
      code: error.code,
    });
  }
}

async function markFailed(id: string, lastError: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("email_notification_deliveries")
    .update({ status: "failed", last_error: lastError })
    .eq("id", id);

  if (error) {
    console.error("[email] failed to mark delivery failed:", {
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
    .from("email_notification_deliveries")
    .update({
      status: "pending",
      last_error: lastError,
      available_at: availableAt.toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[email] failed to schedule delivery retry:", {
      id,
      code: error.code,
    });
  }
}