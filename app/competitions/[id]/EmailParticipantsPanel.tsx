"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BULK_EMAIL_MESSAGE_MAX_LENGTH,
  BULK_EMAIL_SUBJECT_MAX_LENGTH,
  type CompetitionBulkEmailAudienceSummary,
  type CompetitionBulkEmailBatchSummary,
  type CompetitionBulkEmailPreview,
} from "@/types/competition-bulk-email";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  Mail,
  Send,
  Users,
} from "lucide-react";

/**
 * T-BULK-1 — "Email Participants" (host/ambassador reminder email).
 *
 * Shown on the competition-management page to the event CREATOR and to assigned
 * AMBASSADORS. The sender composes a subject and a plain-text message, sees the
 * intended recipient count and a server-rendered PREVIEW, confirms explicitly,
 * then sees the recorded outcome (eligible / accepted by the provider / failed /
 * still pending).
 *
 * The browser never decides anything authoritative:
 *   * the audience (and its count) is resolved server-side at send time,
 *   * the preview is rendered by the server with the SAME template that is sent,
 *   * a client-supplied recipient list is impossible — the request carries only
 *     the subject, the message and an idempotency request id,
 *   * the outcome comes from the recorded per-recipient results (never invented),
 *   * "accepted" always means the provider accepted the message — never a claim
 *     of inbox delivery.
 *
 * Sends are bounded per request, so after the first batch the panel continues
 * draining the remaining pending recipients (progress is visible) — it never
 * puts the whole audience into one request.
 */

/** A fresh idempotency id per compose session (a repeat click reuses it). */
function newRequestId(): string {
  const cryptoObj = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

const MAX_DRAIN_ROUNDS = 24;

function stateLabel(batch: CompetitionBulkEmailBatchSummary): string {
  switch (batch.state) {
    case "empty":
      return "Nothing to send";
    case "processing":
      return "Sending…";
    case "sent":
      return "Accepted by the provider";
    case "partial":
      return "Partially sent";
    case "failed":
      return "Failed";
  }
}

export function EmailParticipantsPanel({
  eventId,
  eventName,
  initialAudience,
  initialBatches,
}: {
  eventId: string;
  /** Competition name, used only for copy in the confirmation step. */
  eventName: string;
  /** Server-resolved audience summary (counts only — never addresses). */
  initialAudience: CompetitionBulkEmailAudienceSummary;
  /** Most recent batches of this competition (server-resolved, summarized). */
  initialBatches: CompetitionBulkEmailBatchSummary[];
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState<string>(() => newRequestId());
  const [audience, setAudience] =
    useState<CompetitionBulkEmailAudienceSummary>(initialAudience);
  const [batches, setBatches] =
    useState<CompetitionBulkEmailBatchSummary[]>(initialBatches);
  const [preview, setPreview] = useState<CompetitionBulkEmailPreview | null>(
    null,
  );
  const [batch, setBatch] = useState<CompetitionBulkEmailBatchSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Re-read the CURRENT audience + recent batches (explicit user action). */
  const loadPanel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/competitions/${eventId}/emails`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to load the recipient list");
      }
      setAudience(data.audience as CompetitionBulkEmailAudienceSummary);
      setBatches((data.batches ?? []) as CompetitionBulkEmailBatchSummary[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  const handlePreview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      const res = await fetch(`/api/competitions/${eventId}/emails/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to build the preview");
      }
      const built = data.preview as CompetitionBulkEmailPreview;
      setPreview(built);
      if (built.audience) setAudience(built.audience);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPreviewing(false);
    }
  };

  /**
   * Continue draining the remaining pending recipients, one bounded request at a
   * time. Accepted or permanently failed recipients are never re-sent.
   */
  const drainRemaining = useCallback(
    async (initial: CompetitionBulkEmailBatchSummary, batchId: string) => {
      let current = initial;
      setBatch(current);

      let rounds = 0;
      while (
        current.state === "processing" &&
        current.pendingCount > 0 &&
        rounds < MAX_DRAIN_ROUNDS
      ) {
        rounds += 1;
        const res = await fetch(
          `/api/competitions/${eventId}/emails/${batchId}/process`,
          { method: "POST" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            (data.error as string) ||
              "Some messages are still pending. You can retry safely.",
          );
          break;
        }
        current = data.batch as CompetitionBulkEmailBatchSummary;
        setBatch(current);
      }

      setBatches((prev) =>
        [current, ...prev.filter((item) => item.id !== current.id)].slice(0, 5),
      );
      // A completed send ends this compose session: the next send gets a new
      // idempotency id (so a later identical message is a NEW, intended send).
      setRequestId(newRequestId());
    },
    [eventId],
  );

  const handleSend = async () => {
    const count = audience?.eligibleCount ?? 0;
    const prompt =
      `Send this email to ${count} participant${count === 1 ? "" : "s"} of ` +
      `${eventName}?\n\nEach participant receives their own private message — ` +
      `recipients cannot see each other.`;
    if (!window.confirm(prompt)) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/competitions/${eventId}/emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message, requestId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to send the message");
      }
      const created = data.batch as CompetitionBulkEmailBatchSummary;
      await drainRemaining(created, created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  };

  const retryRemaining = async () => {
    if (!batch || sending) return;
    setSending(true);
    setError(null);
    try {
      await drainRemaining(batch, batch.id);
    } finally {
      setSending(false);
    }
  };

  const recipients = audience.eligibleCount;
  const canSend =
    !sending &&
    recipients > 0 &&
    subject.trim().length > 0 &&
    message.trim().length > 0;


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Mail className="h-5 w-5 text-primary" />
          Email Participants
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Send a reminder to everyone currently registered for this competition —
          arrival instructions, kickoff time, venue details or what to bring.
          Recipients are resolved automatically; each participant receives their
          own private copy.
        </p>

        {/* Audience */}
        <div className="rounded-lg border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Users className="h-4 w-4 text-primary" />
            {loading
              ? "Checking recipients…"
              : `${recipients} recipient${recipients === 1 ? "" : "s"} will receive this email`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {audience.activeCount} active registration
            {audience.activeCount === 1 ? "" : "s"}
            {audience.invalidCount > 0
              ? ` · ${audience.invalidCount} skipped (missing or invalid email address)`
              : ""}
            {audience.duplicateCount > 0
              ? ` · ${audience.duplicateCount} skipped (duplicate email address)`
              : ""}
          </p>
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadPanel()}
              disabled={loading || sending}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Users className="mr-2 h-4 w-4" />
              )}
              Refresh recipient count
            </Button>
          </div>
        </div>

        {/* Compose */}
        <div className="space-y-2">
          <Label htmlFor="bulk-email-subject">Subject</Label>
          <Input
            id="bulk-email-subject"
            value={subject}
            maxLength={BULK_EMAIL_SUBJECT_MAX_LENGTH}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Arrival instructions for match day"
            disabled={sending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bulk-email-message">Message</Label>
          <Textarea
            id="bulk-email-message"
            value={message}
            maxLength={BULK_EMAIL_MESSAGE_MAX_LENGTH}
            onChange={(event) => setMessage(event.target.value)}
            rows={8}
            placeholder={"Hi everyone,\n\nPlease arrive at the venue by 08:30…"}
            disabled={sending}
          />
          <p className="text-xs text-muted-foreground">
            Plain text. Line breaks are preserved; formatting is added
            automatically in the FOM Sports email style.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handlePreview()}
            disabled={previewing || sending || !subject.trim() || !message.trim()}
          >
            {previewing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            Preview email
          </Button>
          <Button type="button" onClick={() => void handleSend()} disabled={!canSend}>
            {sending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {sending
              ? "Sending…"
              : `Send to ${recipients} recipient${recipients === 1 ? "" : "s"}`}
          </Button>
        </div>

        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            {error}
          </p>
        )}
      </CardContent>

      {/* Preview */}
      {preview && (
        <CardContent className="space-y-3 border-t pt-6">
          <p className="text-sm font-medium">Preview</p>
          <p className="text-xs text-muted-foreground">
            Subject: <span className="font-medium">{preview.subject}</span> ·{" "}
            {preview.audience.eligibleCount} recipient
            {preview.audience.eligibleCount === 1 ? "" : "s"}
          </p>
          <iframe
            title="Email preview"
            srcDoc={preview.html}
            sandbox=""
            className="h-96 w-full rounded-lg border bg-white"
          />
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Plain-text version</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono">
              {preview.text}
            </pre>
          </details>
        </CardContent>
      )}

      {/* Outcome summary */}
      {batch && (
        <CardContent className="space-y-3 border-t pt-6">
          <p className="flex items-center gap-2 text-sm font-medium">
            {batch.state === "sent" ? (
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            ) : batch.state === "processing" ? (
              <Clock className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            )}
            {stateLabel(batch)}
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>Eligible recipients: {batch.audience.eligibleCount}</li>
            <li>Accepted by the provider: {batch.acceptedCount}</li>
            <li>Failed: {batch.failedCount}</li>
            <li>Still pending: {batch.pendingCount}</li>
            {batch.audience.invalidCount > 0 && (
              <li>
                Skipped (missing or invalid address):{" "}
                {batch.audience.invalidCount}
              </li>
            )}
            {batch.audience.duplicateCount > 0 && (
              <li>Skipped (duplicate address): {batch.audience.duplicateCount}</li>
            )}
          </ul>
          <p className="text-xs text-muted-foreground">
            &quot;Accepted&quot; means the email provider accepted the message for
            delivery. It is not a confirmation that it reached an inbox.
          </p>
          {batch.pendingCount > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void retryRemaining()}
              disabled={sending}
            >
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send remaining ({batch.pendingCount})
            </Button>
          )}
        </CardContent>
      )}

      {/* Recent sends */}
      {batches.length > 0 && (
        <CardContent className="space-y-2 border-t pt-6">
          <p className="text-sm font-medium">Recent sends</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {batches.map((item) => (
              <li key={item.id}>
                <span className="font-medium">{item.subject}</span> —{" "}
                {stateLabel(item)} · {item.acceptedCount} accepted,{" "}
                {item.failedCount} failed, {item.pendingCount} pending
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}


