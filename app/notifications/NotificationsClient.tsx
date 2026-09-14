"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  AlertCircle,
  Bell,
  UserPlus,
  RefreshCw,
  MessageSquare,
  CheckCheck,
} from "lucide-react";
import { useNotifications } from "@/lib/use-notifications";
import type { AppNotification, NotificationType } from "@/types";

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) !== 1 ? "s" : ""} ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function NotificationIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case "application_received":
      return <UserPlus className="h-5 w-5" />;
    case "application_status_changed":
      return <RefreshCw className="h-5 w-5" />;
    case "message_received":
      return <MessageSquare className="h-5 w-5" />;
    default:
      return <Bell className="h-5 w-5" />;
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

export function NotificationsClient() {
  const router = useRouter();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const {
    notifications,
    unreadCount,
    loading,
    error,
    refresh,
    markRead,
    markAllRead,
  } = useNotifications();

  const handleClick = async (notification: AppNotification) => {
    // Mark as read if unread (optimistic update via shared hook)
    if (!notification.read_at) {
      setMarkingId(notification.id);
      await markRead(notification.id);
      setMarkingId(null);
    }

    // Navigate to the notification's link
    if (notification.link) {
      router.push(notification.link);
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    await markAllRead();
    setMarkingAll(false);
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="mt-4 text-lg text-muted-foreground">
          Loading notifications...
        </p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20">
        <CardContent className="flex items-start gap-3 p-6">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
          <div>
            <p className="font-medium text-red-800 dark:text-red-300">
              Error loading notifications
            </p>
            <p className="mt-1 text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={refresh}
            >
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (notifications.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-20 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <Bell className="h-10 w-10 text-muted-foreground" />
          </div>
          <h2 className="mb-3 text-2xl font-bold">No notifications yet.</h2>
          <p className="max-w-lg text-muted-foreground">
            When teams apply, update your application status, or send you
            messages, you'll see them here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mark all as read */}
      {unreadCount > 0 && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={markingAll}
          >
            {markingAll ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="mr-2 h-4 w-4" />
            )}
            Mark all as read
          </Button>
        </div>
      )}

      {/* Notification list */}
      <div className="space-y-2">
        {notifications.map((notification) => {
          const isUnread = !notification.read_at;
          const isMarking = markingId === notification.id;

          return (
            <button
              key={notification.id}
              onClick={() => handleClick(notification)}
              disabled={isMarking}
              className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                isUnread
                  ? "border-primary/20 bg-primary/5 hover:bg-primary/10"
                  : "border-transparent bg-card hover:bg-accent/50"
              }`}
            >
              {/* Icon */}
              <div
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${getIconColor(notification.type)}`}
              >
                <NotificationIcon type={notification.type} />
              </div>

              {/* Content */}
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
                <p
                  className={`mt-0.5 text-sm ${
                    isUnread ? "text-foreground/90" : "text-muted-foreground"
                  }`}
                >
                  {notification.body}
                </p>
              </div>

              {/* Unread indicator */}
              {isUnread && (
                <span className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}