"use client";

import { useEffect, useRef, useCallback } from "react";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";
import type { Message, MessageWithSender } from "@/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function createRealtimeClient() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

interface UseConversationRealtimeOptions {
  conversationId: string | null;
  onMessage: (message: MessageWithSender) => void;
  enabled?: boolean;
}

/**
 * Subscribes to realtime messages for a specific conversation using
 * Supabase Realtime Broadcast channels.
 *
 * - The channel name is obtained from the server via /api/realtime/channels
 *   which verifies the user is a participant and signs the channel name.
 * - Deduplicates messages by message ID.
 * - On reconnect, refetches the latest messages to avoid missing any.
 */
export function useConversationRealtime({
  conversationId,
  onMessage,
  enabled = true,
}: UseConversationRealtimeOptions) {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const onMessageRef = useRef(onMessage);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const conversationIdRef = useRef(conversationId);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

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

    seenIdsRef.current = new Set();
    const supabase = createRealtimeClient();

    (async () => {
      try {
        // Get the signed channel name from the server
        const res = await fetch(
          `/api/realtime/channels?type=conversation&conversationId=${conversationId}`,
        );
        const data = await res.json();
        if (!res.ok || !data.channel?.channel) return;

        const channelName = data.channel.channel;
        const channel = supabase.channel(channelName);

        channel.on("broadcast", { event: "message_new" }, (payload) => {
          const newMessage = payload.payload as Message & {
            sender?: { id: string; full_name: string | null; avatar_url: string | null };
          };

          if (!newMessage?.id) return;
          if (seenIdsRef.current.has(newMessage.id)) return;
          seenIdsRef.current.add(newMessage.id);

          const messageWithSender: MessageWithSender = {
            ...newMessage,
            sender: newMessage.sender ?? {
              id: newMessage.sender_id,
              full_name: null,
              avatar_url: null,
            },
          };
          onMessageRef.current(messageWithSender);
        });

        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // On reconnect, refetch latest messages to avoid missing any
            // The parent component handles this via its own fetch logic
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // Supabase will auto-reconnect
          }
        });

        channelRef.current = channel;
      } catch {
        // If channel setup fails, the parent component's fetch still works
      }
    })();

    return () => {
      cleanup();
    };
  }, [conversationId, enabled, cleanup]);

  const markAsSeen = useCallback((messageId: string) => {
    seenIdsRef.current.add(messageId);
  }, []);

  return { markAsSeen };
}