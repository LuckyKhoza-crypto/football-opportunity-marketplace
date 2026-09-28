import { supabaseAdmin } from "@/lib/supabase-admin";
import { emitToUser } from "@/lib/realtime-broadcast";
import {
  enqueueEmailDeliveryForNotification,
  scheduleEmailDeliveryProcessing,
} from "@/lib/email/notification-delivery";
import type { NotificationData } from "@/lib/notification-data";

export type NotificationType =
  | "application_received"
  | "application_status_changed"
  | "message_received"
  | "player_joined_team";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  /** Logical source identifier for deduplication (e.g. message id, application id). */
  sourceId?: string;
  /**
   * EMAIL-003: optional typed presentation payload. Persisted as JSONB on the
   * notification (and broadcast to the recipient) so downstream consumers such
   * as the email layer can reliably render specialized notifications without
   * text heuristics. MUST contain only non-sensitive, email-safe copy.
   */
  data?: NotificationData;
}

/**
 * Create a notification for a user.
 *
 * This is a trusted server-side utility. It uses supabaseAdmin (service role)
 * to bypass RLS, which is intentional — notifications must only be created
 * by server-side application logic, never by clients.
 *
 * Deduplication is enforced at the database level via partial unique indexes:
 * - message_received notifications are unique per (user_id, source_id)
 * - application_received notifications are unique per (user_id, source_id)
 */
export async function createNotification({
  userId,
  type,
  title,
  body,
  link,
  sourceId,
  data,
}: CreateNotificationInput) {
  const { data: inserted, error } = await supabaseAdmin
    .from("notifications")
    .insert({
      user_id: userId,
      type,
      title,
      body,
      link: link ?? null,
      source_id: sourceId ?? null,
      // EMAIL-003: non-sensitive presentation metadata (e.g. outreach context).
      data: data ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // If the insert violates a dedup unique index, the notification already
    // exists for this source — that's fine, we just don't create a duplicate.
    // No email delivery is enqueued for a deduplicated notification.
    if (error.code === "23505") {
      return { data: null, error: null, deduplicated: true };
    }
    console.error("Failed to create notification:", error);
    return { data: null, error, deduplicated: false };
  }

  // EMAIL-002: enqueue durable email delivery work for email-enabled
  // notification types. This is intentionally NOT a synchronous email send:
  // a separate processor drains email_notification_deliveries and calls Brevo.
  //
  // The enqueue helper never throws and swallows its own errors, so email
  // infrastructure can never fail the marketplace operation that raised the
  // notification. Realtime behaviour below is unchanged.
  if (inserted) {
    const enqueueResult = await enqueueEmailDeliveryForNotification({
      notificationId: inserted.id,
      userId,
      type,
    }).catch(() => {
      // Defense-in-depth: the enqueue helper already handles its own errors,
      // but email infrastructure must NEVER fail notification creation.
      return { enqueued: false as const };
    });

    // EMAIL-002A: only when a NEW delivery row was durably enqueued do we kick
    // the EXISTING processor for an immediate, best-effort first attempt. The
    // trigger schedules work after the response via Next.js `after()`, so the
    // marketplace request never waits on Brevo. Deduped/skipped/not-queued
    // notifications do NOT trigger processing. Failures here can never fail the
    // marketplace operation.
    if (enqueueResult?.enqueued) {
      try {
        scheduleEmailDeliveryProcessing();
      } catch {
        // Best-effort only — never fail notification creation.
      }
    }
  }

  // Emit realtime event for the recipient
  if (inserted) {
    await emitToUser(userId, "notification_new", {
      id: inserted.id,
      user_id: userId,
      type,
      title,
      body,
      link: link ?? null,
      source_id: sourceId ?? null,
      // Non-sensitive presentation payload; safe to deliver to the owner.
      data: data ?? null,
      read_at: null,
      created_at: new Date().toISOString(),
    }).catch(() => {
      // Realtime broadcast is best-effort; don't fail notification creation
    });
  }

  return { data: inserted, error: null, deduplicated: false };
}
