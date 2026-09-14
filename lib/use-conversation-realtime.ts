"use client";

import { useEffect, useRef, useCallback } from "react";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";
import type { Message, MessageWithSender } from "@/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Create a lightweight Supabase client for realtime subscriptions
// We use the anon key so RLS policies are enforced
function createRealtimeClient() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

interface UseConversationRealtimeOptions {
  conversationId: string | null;
  onMessage: (message: MessageWithSender) => void;
  enabled?: boolean;
}

/**
 * Subscribes to realtime messages for a specific conversation.
 *
 * - Subscribes only when conversationId is provided and enabled is true
 * - Automatically cleans up the subscription when conversationId changes
 *   or the component unmounts
 * - Deduplicates messages by checking if the message ID already exists
 * - Handles reconnection gracefully (Supabase Realtime handles this internally)
 * - Only subscribes to INSERT events on the messages table
 *
 * The sender also receives their own message via this subscription,
 * so they see it appear immediately without needing optimistic updates.
 */
export function useConversationRealtime({
  conversationId,
  onMessage,
  enabled = true,
}: UseConversationRealtimeOptions) {
  // Track seen message IDs to prevent duplicates
  const seenIdsRef = useRef<Set<string>>(new Set());
  const onMessageRef = useRef(onMessage);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Keep the callback ref up to date — use effect to avoid ref access during render
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

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
    if (!conversationId || !enabled) {
      cleanup();
      return;
    }

    // Reset seen IDs for new conversation
    seenIdsRef.current = new Set();

    const supabase = createRealtimeClient();

    // Subscribe to messages for this conversation
    // Using the channel-based approach for scoped subscriptions
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const newMessage = payload.new as Message;

          // Deduplicate: skip if we've already seen this message ID
          if (seenIdsRef.current.has(newMessage.id)) {
            return;
          }
          seenIdsRef.current.add(newMessage.id);

          // Fetch the sender details to build a MessageWithSender
          try {
            const { data: sender } = await supabase
              .from("profiles")
              .select("id, full_name, avatar_url")
              .eq("id", newMessage.sender_id)
              .single();

            const messageWithSender: MessageWithSender = {
              ...newMessage,
              sender: sender ?? {
                id: newMessage.sender_id,
                full_name: null,
                avatar_url: null,
              },
            };

            onMessageRef.current(messageWithSender);
          } catch {
            // If sender fetch fails, still deliver the message
            const messageWithSender: MessageWithSender = {
              ...newMessage,
              sender: {
                id: newMessage.sender_id,
                full_name: null,
                avatar_url: null,
              },
            };
            onMessageRef.current(messageWithSender);
          }
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Connection established - could log or signal
        } else if (status === "CHANNEL_ERROR") {
          // Connection error - Supabase will auto-reconnect
          // The existing messages remain visible in the UI
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
  }, [conversationId, enabled, cleanup]);

  /**
   * Register a message ID as seen to prevent duplicates.
   * Useful for pre-loading initial messages.
   */
  const markAsSeen = useCallback((messageId: string) => {
    seenIdsRef.current.add(messageId);
  }, []);

  return { markAsSeen };
}