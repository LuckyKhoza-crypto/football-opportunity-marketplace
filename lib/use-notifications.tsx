"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";
import { useSession } from "next-auth/react";
import type { AppNotification } from "@/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

interface NotificationsContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  notifications: [],
  unreadCount: 0,
  loading: false,
  error: null,
  refresh: async () => {},
  markRead: async () => {},
  markAllRead: async () => {},
});

export function useNotifications() {
  return useContext(NotificationsContext);
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/notifications");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to fetch notifications");
        return;
      }
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unread_count ?? 0);
      // Mark loaded IDs as seen to prevent realtime duplicates
      (data.notifications ?? []).forEach((n: AppNotification) => {
        seenIdsRef.current.add(n.id);
      });
    } catch {
      setError("Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime subscription
  useEffect(() => {
    if (!userId) return;
    seenIdsRef.current = new Set();

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    (async () => {
      try {
        const res = await fetch(`/api/realtime/channels?type=notification`);
        const data = await res.json();
        if (!res.ok || !data.channel?.channel) return;

        const { channel } = data.channel;
        if (!channel) return;

        const ch = supabase.channel(channel);
        ch.on("broadcast", { event: "notification_new" }, (payload) => {
          const notif = payload.payload as AppNotification & {
            _signed?: unknown;
          };
          if (!notif?.id) return;
          if (seenIdsRef.current.has(notif.id)) return;
          seenIdsRef.current.add(notif.id);

          setNotifications((prev) => {
            if (prev.some((n) => n.id === notif.id)) return prev;
            return [notif, ...prev];
          });
          setUnreadCount((prev) => prev + 1);
        });

        ch.on("broadcast", { event: "notification_read" }, (payload) => {
          const { id, readAt } = payload.payload as {
            id: string;
            readAt?: string;
          };
          if (!id) return;
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === id ? { ...n, read_at: readAt ?? new Date().toISOString() } : n,
            ),
          );
          setUnreadCount((prev) => Math.max(0, prev - 1));
        });

        ch.on("broadcast", { event: "notifications_read_all" }, () => {
          setNotifications((prev) =>
            prev.map((n) => ({
              ...n,
              read_at: n.read_at ?? new Date().toISOString(),
            })),
          );
          setUnreadCount(0);
        });

        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // If channel was suspended/reconnected, refetch
            refresh();
          }
        });
        channelRef.current = ch;
      } catch {
        // Relload fallback
      }
    })();

    return () => {
      try {
        channelRef.current?.unsubscribe();
      } catch {
        // ignore
      }
      channelRef.current = null;
    };
  }, [userId, refresh]);

  const markRead = useCallback(async (id: string) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, read_at: new Date().toISOString() } : n,
      ),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    try {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: "PATCH",
      });
      if (!res.ok) {
        // Reconcile: refetch from server
        await refresh();
      }
    } catch {
      // Refetch to reconcile
      await refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => ({
        ...n,
        read_at: n.read_at ?? new Date().toISOString(),
      })),
    );
    setUnreadCount(0);

    try {
      const res = await fetch("/api/notifications/read-all", {
        method: "PATCH",
      });
      if (!res.ok) {
        await refresh();
      }
    } catch {
      await refresh();
    }
  }, [refresh]);

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        error,
        refresh,
        markRead,
        markAllRead,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}