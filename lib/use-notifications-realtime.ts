"use client";

import { useEffect, useRef, useCallback } from "react";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";
import type { AppNotification } from "@/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Create a lightweight Supabase client for realtime subscriptions
// We use the anon key so RLS policies are enforced
function createRealtimeClient() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

interface UseNotificationsRealtimeOptions {
  userId: string | null;
  onNotification: (notification: AppNotification) => void;
  enabled?: boolean;
}

/**
 * Subscribes to realtime notifications for the current user.
 *
 * - Subscribes only when userId is provided and enabled is true
 * - The channel name and filter are scoped to the user's ID, so a user
 *   can never receive another user's notifications
 * - Automatically cleans up the subscription when userId changes
 *   or the component unmounts
 * - Deduplicates notifications by checking if the notification ID already exists
 * - Handles reconnection gracefully (Supabase Realtime handles this internally)
 * - Only subscribes to INSERT events on the notifications table
 */
export function useNotificationsRealtime({
  userId,
  onNotification,
  enabled = true,
}: UseNotificationsRealtimeOptions) {
  // Track seen notification IDs to prevent duplicates
  const seenIdsRef = useRef<Set<string>>(new Set());
  const onNotificationRef = useRef(onNotification);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Keep the callback ref up to date
  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (channelRef.current) {
      try {
        channelRef.current.unsubscribe();
      } catch {
        // Ignore cleanup errors
      }
      channelRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!userId || !enabled) {
      cleanup();
      return;
    }

    // Reset seen IDs for new user
    seenIdsRef.current = new Set();

    const supabase = createRealtimeClient();

    // Subscribe to notifications for this user.
    // The channel name and filter are scoped to the user's ID so
    // realtime subscriptions cannot expose another user's notifications.
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotification = payload.new as AppNotification;

          // Deduplicate: skip if we've already seen this notification ID
          if (seenIdsRef.current.has(newNotification.id)) {
            return;
          }
          seenIdsRef.current.add(newNotification.id);

          onNotificationRef.current(newNotification);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Connection established
        } else if (status === "CHANNEL_ERROR") {
          // Connection error - Supabase will auto-reconnect
        } else if (status === "TIMED_OUT") {
          // Timeout - Supabase will retry
        } else if (status === "CLOSED") {
          // Channel closed - will be cleaned up
        }
      });

    channelRef.current = channel;

    return () => {
      cleanup();
    };
  }, [userId, enabled, cleanup]);

  /**
   * Register a notification ID as seen to prevent duplicates.
   * Useful for pre-loading initial notifications.
   */
  const markAsSeen = useCallback((notificationId: string) => {
    seenIdsRef.current.add(notificationId);
  }, []);

  return { markAsSeen };
}