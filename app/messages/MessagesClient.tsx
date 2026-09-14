"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, Inbox } from "lucide-react";
import { useAppView } from "@/lib/use-app-view";
import { APPLICATION_STATUS_COLORS, APPLICATION_STATUS_LABELS, type ApplicationStatus } from "@/types";

interface ConversationListItem {
  id: string;
  application_id: string;
  created_at: string;
  updated_at: string;
  display_name: string;
  opportunity_title: string;
  opportunity_position: string | null;
  application_status: string;
  latest_message: {
    id: string;
    body: string;
    sender_id: string;
    created_at: string;
  } | null;
  unread_count: number;
  other_participant: {
    full_name: string | null;
    avatar_url: string | null;
  } | null;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function MessagesClient() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isPlayerView } = useAppView();

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/messages");
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to fetch conversations");
        return;
      }

      setConversations(data.conversations ?? []);
    } catch {
      setError("Failed to load messages. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">Loading conversations...</p>
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
              Error loading conversations
            </p>
            <p className="mt-1 text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={fetchConversations}
            >
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state - no conversations
  if (conversations.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Inbox className="h-8 w-8 text-muted-foreground" />
          </div>
          {isPlayerView ? (
            <>
              <h2 className="mb-2 text-xl font-bold">
                You don't have any conversations yet.
              </h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                Apply to an opportunity to start communicating with a team.
              </p>
              <Link href="/player/find-team">
                <Button size="lg">Find a Team</Button>
              </Link>
            </>
          ) : (
            <>
              <h2 className="mb-2 text-xl font-bold">
                You don't have any conversations yet.
              </h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                Applications from players will appear here.
              </p>
              <Link href="/team/applications">
                <Button size="lg">View Applications</Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {conversations.map((conv) => {
        const statusColor =
          APPLICATION_STATUS_COLORS[conv.application_status as ApplicationStatus] ??
          "bg-gray-100 text-gray-800";
        const statusLabel =
          APPLICATION_STATUS_LABELS[conv.application_status as ApplicationStatus] ??
          conv.application_status;

        return (
          <Link
            key={conv.id}
            href={`/messages/${conv.id}`}
            className="block"
          >
            <Card
              className={`transition-shadow hover:shadow-md ${
                conv.unread_count > 0
                  ? "border-l-4 border-l-primary"
                  : ""
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                    {conv.other_participant?.avatar_url ? (
                      <img
                        src={conv.other_participant.avatar_url}
                        alt=""
                        className="h-12 w-12 rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-lg font-semibold text-primary">
                        {conv.display_name.charAt(0)?.toUpperCase() ?? "?"}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-sm font-semibold">
                        {conv.display_name}
                        {conv.unread_count > 0 && (
                          <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                            {conv.unread_count}
                          </span>
                        )}
                      </h3>
                      {conv.latest_message && (
                        <span className="flex-shrink-0 text-xs text-muted-foreground">
                          {formatRelativeTime(conv.latest_message.created_at)}
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {conv.opportunity_title}
                      {conv.opportunity_position && (
                        <> &middot; {conv.opportunity_position}</>
                      )}
                    </p>

                    <div className="mt-1 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor}`}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    {conv.latest_message ? (
                      <p className="mt-1.5 truncate text-sm text-muted-foreground">
                        {conv.latest_message.body}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-sm italic text-muted-foreground">
                        No messages yet. Start the conversation!
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}