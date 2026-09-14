"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  Send,
  ChevronUp,
  Building,
  MapPin,
  Star,
  User,
  ExternalLink,
} from "lucide-react";
import { useConversationRealtime } from "@/lib/use-conversation-realtime";
import { useSession } from "next-auth/react";
import { useAppView } from "@/lib/use-app-view";
import {
  APPLICATION_STATUS_COLORS,
  APPLICATION_STATUS_LABELS,
  POSITION_LABELS,
  type ApplicationStatus,
  type MessageWithSender,
} from "@/types";

interface ConversationDetailProps {
  conversationId: string;
}

interface ConversationData {
  conversation: any;
  participants: any[];
  messages: MessageWithSender[];
  has_more: boolean;
  match_result: {
    score: number;
    classification: string;
  } | null;
}

interface Participant {
  user_id: string;
  last_read_at: string;
  user: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  };
}

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  if (isToday) {
    return time;
  }

  const dateStr_short = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return `${dateStr_short} ${time}`;
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function ConversationDetail({ conversationId }: ConversationDetailProps) {
  const { data: session } = useSession();
  const { isPlayerView, isTeamView } = useAppView();
  const userId = session?.user?.id;

  const [data, setData] = useState<ConversationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // ── Fetch conversation data ──────────────────────────────────

  const fetchConversation = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/messages/${conversationId}`);
      const result = await res.json();

      if (!res.ok) {
        setError(result.error || "Failed to load conversation");
        return;
      }

      setData(result);

      // Mark as read
      await fetch(`/api/messages/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_read" }),
      }).catch(() => {
        // Silently fail - read state is not critical
      });
    } catch {
      setError("Failed to load conversation. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    fetchConversation();
  }, [fetchConversation]);

  // ── Realtime subscription ────────────────────────────────────

  const handleNewMessage = useCallback(
    (message: MessageWithSender) => {
      setData((prev) => {
        if (!prev) return prev;
        // Deduplicate: check if message already exists
        if (prev.messages.some((m) => m.id === message.id)) {
          return prev;
        }
        return {
          ...prev,
          messages: [...prev.messages, message],
          has_more: prev.has_more,
        };
      });

      // Auto-scroll to bottom if user was already at bottom
      if (autoScroll) {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      }
    },
    [autoScroll],
  );

  const { markAsSeen } = useConversationRealtime({
    conversationId,
    onMessage: handleNewMessage,
    enabled: true,
  });

  // Mark initial messages as seen
  useEffect(() => {
    if (data?.messages) {
      data.messages.forEach((m) => markAsSeen(m.id));
    }
  }, [data?.messages, markAsSeen]);

  // ── Auto-scroll on new messages ──────────────────────────────

  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [data?.messages, autoScroll]);

  // Track scroll position to determine if user is at bottom
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } =
      messagesContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isNearBottom);
  }, []);

  // ── Load older messages ──────────────────────────────────────

  const loadOlderMessages = useCallback(async () => {
    if (!data?.messages.length || loadingMore) return;

    const oldestMessage = data.messages[0];
    setLoadingMore(true);

    try {
      const res = await fetch(
        `/api/messages/${conversationId}?before=${oldestMessage.id}&limit=50`,
      );
      const result = await res.json();

      if (res.ok && result.messages?.length > 0) {
        setData((prev) => {
          if (!prev) return prev;

          // Deduplicate and merge
          const existingIds = new Set(prev.messages.map((m) => m.id));
          const newMessages = result.messages.filter(
            (m: any) => !existingIds.has(m.id),
          );

          return {
            ...prev,
            messages: [...newMessages, ...prev.messages],
            has_more: result.has_more,
          };
        });
      } else {
        setData((prev) =>
          prev ? { ...prev, has_more: false } : prev,
        );
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, data?.messages, loadingMore]);

  // ── Send message ─────────────────────────────────────────────

  const handleSendMessage = useCallback(async () => {
    const trimmed = messageInput.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setSendError(null);

    try {
      const res = await fetch(`/api/messages/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });

      const result = await res.json();

      if (!res.ok) {
        setSendError(result.error || "Failed to send message");
        return;
      }

      // Clear input
      setMessageInput("");

      // Add the message to the list (it will also come through realtime)
      setData((prev) => {
        if (!prev) return prev;
        // The realtime subscription will handle adding it,
        // but we add it immediately for responsiveness
        if (prev.messages.some((m) => m.id === result.message.id)) {
          return prev;
        }
        return {
          ...prev,
          messages: [...prev.messages, result.message],
        };
      });

      // Auto-scroll to bottom
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch {
      setSendError("Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  }, [messageInput, sending, conversationId]);

  // ── Keyboard handling ────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage],
  );

  // ── Loading state ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">
              Loading conversation...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────

  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-4xl">
          <Card className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20">
            <CardContent className="flex items-start gap-3 p-6">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
              <div>
                <p className="font-medium text-red-800 dark:text-red-300">
                  Error loading conversation
                </p>
                <p className="mt-1 text-sm text-red-700 dark:text-red-400">
                  {error || "Conversation not found"}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchConversation}
                  >
                    Try Again
                  </Button>
                  <Link href="/messages">
                    <Button variant="ghost" size="sm">
                      Back to Messages
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const conversation = data.conversation;
  const application = conversation?.application;
  const opportunity = application?.opportunity;
  const playerProfile = application?.player_profile;
  const participants = data.participants as Participant[];

  // Determine the display context
  const otherParticipant = participants.find((p) => p.user_id !== userId);

  const teamName = opportunity?.team?.team_name ?? "Unknown Team";
  const playerName = otherParticipant?.user?.full_name ?? "Unknown Player";
  const displayName = isPlayerView ? teamName : playerName;
  const positionLabel = opportunity?.position
    ? POSITION_LABELS[opportunity.position] ?? opportunity.position
    : "Any Position";

  return (
    <div className="container mx-auto flex h-[calc(100vh-4rem)] flex-col px-4 py-4">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
        {/* ── Back Navigation ─────────────────────────────────── */}
        <div className="mb-2 flex items-center gap-2">
          <Link href="/messages">
            <Button variant="ghost" size="sm" className="flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Messages</span>
            </Button>
          </Link>
        </div>

        {/* ── Conversation Header ─────────────────────────────── */}
        <Card className="mb-4 flex-shrink-0">
          <CardContent className="p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                    {isPlayerView ? (
                      <Building className="h-5 w-5 text-primary" />
                    ) : (
                      <User className="h-5 w-5 text-primary" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold">
                      {displayName}
                    </h2>
                    <p className="truncate text-sm text-muted-foreground">
                      {opportunity?.title ?? "Unknown Opportunity"}
                      {opportunity?.position && (
                        <> &middot; {positionLabel}</>
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      APPLICATION_STATUS_COLORS[
                        application?.status as ApplicationStatus
                      ] ?? "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {APPLICATION_STATUS_LABELS[
                      application?.status as ApplicationStatus
                    ] ?? application?.status}
                  </span>

                  {data.match_result && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                      <Star className="h-3 w-3" />
                      {data.match_result.score}% Match
                    </span>
                  )}

                  {opportunity?.team?.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {opportunity.team.location}
                    </span>
                  )}
                </div>
              </div>

              {/* Links */}
              <div className="mt-2 flex flex-wrap gap-2 sm:mt-0 sm:flex-shrink-0">
                {isPlayerView && opportunity && (
                  <Link
                    href={`/opportunities/${opportunity.id}`}
                    target="_blank"
                  >
                    <Button variant="outline" size="sm">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      <span className="hidden sm:inline">View Opportunity</span>
                      <span className="sm:hidden">View</span>
                    </Button>
                  </Link>
                )}
                {isTeamView && playerProfile && (
                  <Link href={`/players/${playerProfile.id}`} target="_blank">
                    <Button variant="outline" size="sm">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      <span className="hidden sm:inline">View Player</span>
                      <span className="sm:hidden">View</span>
                    </Button>
                  </Link>
                )}
                {isPlayerView && opportunity?.team && (
                  <Link href={`/teams/${opportunity.team.id}`} target="_blank">
                    <Button variant="outline" size="sm">
                      <Building className="mr-1 h-3.5 w-3.5" />
                      <span className="hidden sm:inline">View Team</span>
                      <span className="sm:hidden">Team</span>
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Messages Area ───────────────────────────────────── */}
        <Card className="flex flex-1 flex-col overflow-hidden">
          {/* Messages list */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 space-y-1 overflow-y-auto p-4"
          >
            {/* Load older messages */}
            {data.has_more && (
              <div className="flex justify-center py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadOlderMessages}
                  disabled={loadingMore}
                  className="flex items-center gap-1 text-xs"
                >
                  {loadingMore ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ChevronUp className="h-3 w-3" />
                  )}
                  Load older messages
                </Button>
              </div>
            )}

            {data.messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <svg
                    className="h-8 w-8 text-muted-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <h3 className="mb-1 text-lg font-semibold">
                  No messages yet
                </h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Send a message to start the conversation.
                </p>
              </div>
            ) : (
              <>
                {data.messages.map((message, index) => {
                  const isOwn = message.sender_id === userId;
                  const showDateSeparator =
                    index === 0 ||
                    new Date(message.created_at).toDateString() !==
                      new Date(
                        data.messages[index - 1].created_at,
                      ).toDateString();

                  return (
                    <div key={message.id}>
                      {showDateSeparator && (
                        <div className="flex justify-center py-2">
                          <span className="rounded-full bg-muted px-3 py-1 text-[10px] text-muted-foreground">
                            {formatDateSeparator(message.created_at)}
                          </span>
                        </div>
                      )}
                      <div
                        className={`flex ${
                          isOwn ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2 sm:max-w-[70%] ${
                            isOwn
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words text-sm">
                            {message.body}
                          </p>
                          <p
                            className={`mt-1 text-right text-[10px] ${
                              isOwn
                                ? "text-primary-foreground/70"
                                : "text-muted-foreground"
                            }`}
                          >
                            {formatMessageTime(message.created_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* ── Composer ───────────────────────────────────────── */}
          <div className="border-t p-4">
            {sendError && (
              <div className="mb-2 flex items-center gap-2 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/20 dark:text-red-400">
                <AlertCircle className="h-3 w-3 flex-shrink-0" />
                <span>{sendError}</span>
                <button
                  onClick={() => setSendError(null)}
                  className="ml-auto text-red-500 hover:text-red-700"
                  aria-label="Dismiss error"
                >
                  &times;
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                rows={1}
                maxLength={5000}
                className="min-h-[44px] flex-1 resize-none rounded-xl border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                disabled={sending}
                aria-label="Message input"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!messageInput.trim() || sending}
                size="icon"
                className="h-11 w-11 flex-shrink-0 rounded-xl"
                aria-label="Send message"
              >
                {sending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
            <p className="mt-1 text-right text-[10px] text-muted-foreground">
              {messageInput.length}/5000
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}