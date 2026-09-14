"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Bell, Loader2, UserPlus, RefreshCw, MessageSquare } from "lucide-react";
import { useNotificationsRealtime } from "@/lib/use-notifications-realtime";
import type { AppNotification, NotificationType } from "@/types";

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function NotificationIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case "application_received":
      return <UserPlus className="h-4 w-4" />;
    case "application_status_changed":
      return <RefreshCw className="h-4 w-4" />;
    case "message_received":
      return <MessageSquare className="h-4 w-4" />;
    default:
      return <Bell className="h-4 w-4" />;
  }
}

function getIconColor(type: NotificationType): string {
  switch (type) {
    case "application_received":
      return "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400";
    case "application_status_changed":
      return "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400";
    case "message_received":
      return "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function NotificationBell() {
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/notifications?limit=5");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to fetch notifications");
        return;
      }
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unread_count ?? 0);
    } catch {
      setError("Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Fetch on mount and when user changes
  useEffect(() => {
    if (userId) {
      fetchNotifications();
    }
  }, [userId, fetchNotifications]);

  // Realtime updates — when a new notification arrives for this user,
  // update the unread badge and prepend to the dropdown if open.
  const handleRealtimeNotification = useCallback(
    (notification: AppNotification) => {
      setNotifications((prev) => {
        // Deduplicate by ID
        if (prev.some((n) => n.id === notification.id)) return prev;
        return [notification, ...prev].slice(0, 5);
      });
      setUnreadCount((prev) => prev + 1);
    },
    [],
  );

  useNotificationsRealtime({
    userId,
    onNotification: handleRealtimeNotification,
    enabled: !!userId,
  });

  const handleClickNotification = async (notification: AppNotification) => {
    setOpen(false);

    // Mark as read if unread
    if (!notification.read_at) {
      try {
        await fetch(`/api/notifications/${notification.id}/read`, {
          method: "PATCH",
        });
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n,
          ),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch {
        // If marking read fails, still navigate
      }
    }

    // Navigate to the notification's link
    if (notification.link) {
      router.push(notification.link);
    }
  };

  if (!userId) return null;

  return (
    <div className="relative" ref={bellRef}>
      {/* Bell button */}
      <button
        onClick={() => {
          setOpen(!open);
          if (!open) fetchNotifications();
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-accent"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-md">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {unreadCount} unread
              </span>
            )}
          </div>

          {/* Body */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">{error}</p>
                <button
                  onClick={fetchNotifications}
                  className="mt-2 text-sm font-medium text-primary hover:underline"
                >
                  Retry
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No notifications yet.
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {notifications.map((notification) => {
                  const isUnread = !notification.read_at;
                  return (
                    <button
                      key={notification.id}
                      onClick={() => handleClickNotification(notification)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 ${
                        isUnread ? "bg-primary/5" : ""
                      }`}
                    >
                      <div
                        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${getIconColor(notification.type)}`}
                      >
                        <NotificationIcon type={notification.type} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={`text-sm font-medium ${
                              isUnread ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {notification.title}
                          </p>
                          <span className="flex-shrink-0 text-xs text-muted-foreground">
                            {formatRelativeTime(notification.created_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {notification.body}
                        </p>
                      </div>
                      {isUnread && (
                        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t">
            <button
              onClick={() => {
                setOpen(false);
                router.push("/notifications");
              }}
              className="block w-full px-4 py-2.5 text-center text-sm font-medium text-primary transition-colors hover:bg-accent/50"
            >
              View all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}