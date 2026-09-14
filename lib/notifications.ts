import { supabaseAdmin } from "@/lib/supabase-admin";
import { emitToUser } from "@/lib/realtime-broadcast";

export type NotificationType =
  | "application_received"
  | "application_status_changed"
  | "message_received";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  /** Logical source identifier for deduplication (e.g. message id, application id). */
  sourceId?: string;
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
}: CreateNotificationInput) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .insert({
      user_id: userId,
      type,
      title,
      body,
      link: link ?? null,
      source_id: sourceId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // If the insert violates a dedup unique index, the notification already
    // exists for this source — that's fine, we just don't create a duplicate.
    if (error.code === "23505") {
      return { data: null, error: null, deduplicated: true };
    }
    console.error("Failed to create notification:", error);
    return { data: null, error, deduplicated: false };
  }

  // Emit realtime event for the recipient
  if (data) {
    await emitToUser(userId, "notification_new", {
      id: data.id,
      user_id: userId,
      type,
      title,
      body,
      link: link ?? null,
      source_id: sourceId ?? null,
      read_at: null,
      created_at: new Date().toISOString(),
    }).catch(() => {
      // Realtime broadcast is best-effort; don't fail notification creation
    });
  }

  return { data, error: null, deduplicated: false };
}
