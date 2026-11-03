"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ANNOUNCEMENT_IMAGE_MAX_BYTES,
  ANNOUNCEMENT_IMAGE_MIME_TYPES,
  ANNOUNCEMENT_IMAGE_TOKEN,
  EMAIL_ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
  EMAIL_ANNOUNCEMENT_SUBJECT_MAX_LENGTH,
  type EmailAnnouncementAudienceSummary,
  type EmailAnnouncementAudienceType,
  type EmailAnnouncementBatchSummary,
  type EmailAnnouncementCompetitionOption,
  type EmailAnnouncementPreview,
} from "@/types/email-announcement";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Image as ImageIcon,
  Loader2,
  Mail,
  Send,
  Trash2,
  Users,
} from "lucide-react";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — "Email Users" (admin announcement composer).
 *
 * The administrator picks a RECIPIENT AUDIENCE (all users, or the participants
 * of a previous competition) and OPTIONALLY a competition to promote. The
 * audience and its recipient count are always resolved SERVER-SIDE — the browser
 * never sees or supplies an address — and a recipient already registered for the
 * promoted competition is excluded server-side for both audience types.
 *
 * The message is composed as plain text whose structure is PRESERVED (paragraphs,
 * blank lines, line breaks, indentation, bullet and numbered lists, `**bold**` /
 * `*italic*`). The preview is rendered by the SERVER with the SAME renderer and
 * template the delivery processor uses, so the preview and the delivered email
 * match exactly — including the resolved registration link.
 *
 * Nothing is sent when the page loads or when the audience changes; only an
 * explicit confirmation sends.
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
/** Sentinel for "no selection" in the Radix selects (empty values are invalid). */
const NONE = "__none__";

function stateLabel(batch: EmailAnnouncementBatchSummary): string {
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

function formatEventOption(option: EmailAnnouncementCompetitionOption): string {
  const date = option.eventDate
    ? new Date(option.eventDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const status =
    option.status.charAt(0).toUpperCase() + option.status.slice(1);
  return date ? `${option.name} — ${date} (${status})` : `${option.name} (${status})`;
}

export function EmailAnnouncementsClient({
  initialEvents,
  initialAudience,
  initialBatches,
}: {
  initialEvents: EmailAnnouncementCompetitionOption[];
  initialAudience: EmailAnnouncementAudienceSummary;
  initialBatches: EmailAnnouncementBatchSummary[];
}) {
  const [events] = useState<EmailAnnouncementCompetitionOption[]>(initialEvents);
  const [audienceType, setAudienceType] =
    useState<EmailAnnouncementAudienceType>("all_users");
  const [previousCompetitionId, setPreviousCompetitionId] = useState<string>(NONE);
  const [promotionCompetitionId, setPromotionCompetitionId] =
    useState<string>(NONE);

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);

  const [audience, setAudience] =
    useState<EmailAnnouncementAudienceSummary>(initialAudience);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceError, setAudienceError] = useState<string | null>(null);

  const [preview, setPreview] = useState<EmailAnnouncementPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [requestId, setRequestId] = useState<string>(() => newRequestId());
  const [sending, setSending] = useState(false);
  const [batch, setBatch] = useState<EmailAnnouncementBatchSummary | null>(null);
  const [batches, setBatches] =
    useState<EmailAnnouncementBatchSummary[]>(initialBatches);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const promotableEvents = useMemo(
    () => events.filter((event) => event.status === "active"),
    [events],
  );

  const previousSelected =
    previousCompetitionId === NONE ? "" : previousCompetitionId;
  const promotionSelected =
    promotionCompetitionId === NONE ? "" : promotionCompetitionId;

  /**
   * Resolve the recipient count for the CURRENT selection. Never sends and never
   * stores anything — this is only a count.
   */
  const loadAudience = useCallback(async () => {
    if (audienceType === "previous_competition" && !previousSelected) {
      setAudience({
        audienceType,
        baseCount: 0,
        eligibleCount: 0,
        invalidCount: 0,
        duplicateCount: 0,
        excludedRegisteredCount: 0,
        promotionEventId: promotionSelected || null,
      });
      setAudienceError(null);
      return;
    }

    setAudienceLoading(true);
    setAudienceError(null);
    try {
      const res = await fetch("/api/admin/email-announcements/audience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audienceType,
          previousCompetitionId: previousSelected,
          promotionCompetitionId: promotionSelected,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to resolve the recipient count");
      }
      setAudience(data.audience as EmailAnnouncementAudienceSummary);
    } catch (err) {
      setAudienceError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setAudienceLoading(false);
    }
  }, [audienceType, previousSelected, promotionSelected]);

  // Re-count whenever the audience selection changes. Counting only — no send.
  useEffect(() => {
    void loadAudience();
  }, [loadAudience]);

  /** Insert the image placeholder at the cursor (or append it). */
  const insertImageToken = useCallback(() => {
    setMessage((current) => {
      const token = ANNOUNCEMENT_IMAGE_TOKEN;
      if (current.split("\n").some((line) => line.trim() === token)) {
        return current;
      }
      const textarea = messageRef.current;
      if (textarea) {
        const start = textarea.selectionStart ?? current.length;
        const end = textarea.selectionEnd ?? current.length;
        const before = current.slice(0, start);
        const after = current.slice(end);
        const needsLeading = before.length > 0 && !before.endsWith("\n");
        const needsTrailing = after.length > 0 && !after.startsWith("\n");
        return `${before}${needsLeading ? "\n\n" : ""}${token}${
          needsTrailing ? "\n\n" : ""
        }${after}`;
      }
      return current.length > 0 ? `${current}\n\n${token}` : token;
    });
  }, []);

  const handleImageChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);

    if (
      !(ANNOUNCEMENT_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)
    ) {
      setError("Only JPG, PNG, WebP and GIF images are allowed.");
      return;
    }
    if (file.size > ANNOUNCEMENT_IMAGE_MAX_BYTES) {
      setError("The image must be smaller than 5MB.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/email-announcements/image", {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to upload the image");
      }
      setImageUrl(data.url as string);
      setImageName(file.name);
      // Place the image where the administrator is currently writing.
      insertImageToken();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to upload the image",
      );
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    setImageUrl(null);
    setImageName(null);
    setMessage((current) =>
      current
        .split("\n")
        .filter((line) => line.trim() !== ANNOUNCEMENT_IMAGE_TOKEN)
        .join("\n"),
    );
  };


  const handlePreview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/email-announcements/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          message,
          audienceType,
          previousCompetitionId: previousSelected,
          promotionCompetitionId: promotionSelected,
          imageUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to build the preview");
      }
      const built = data.preview as EmailAnnouncementPreview;
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
    async (initial: EmailAnnouncementBatchSummary, batchId: string) => {
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
          `/api/admin/email-announcements/${batchId}/process`,
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
        current = data.batch as EmailAnnouncementBatchSummary;
        setBatch(current);
      }

      setBatches((prev) =>
        [current, ...prev.filter((item) => item.id !== current.id)].slice(0, 5),
      );
      // A completed send ends this compose session: the next send gets a new
      // idempotency id (so a later identical message is a NEW, intended send).
      setRequestId(newRequestId());
    },
    [],
  );

  const handleSend = async () => {
    setConfirming(false);
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/email-announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          message,
          audienceType,
          previousCompetitionId: previousSelected,
          promotionCompetitionId: promotionSelected,
          imageUrl,
          requestId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to send the announcement");
      }
      await drainRemaining(data.batch as EmailAnnouncementBatchSummary, (data.batch as EmailAnnouncementBatchSummary).id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  };

  const recipients = audience?.eligibleCount ?? 0;
  const canCompose = !!subject.trim() && !!message.trim();
  const canSend = canCompose && recipients > 0 && !sending && !uploading;
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="mb-2 flex items-center gap-2 text-3xl font-bold">
            <Mail className="h-7 w-7" />
            Email Users
          </h1>
          <p className="text-lg text-muted-foreground">
            Send an announcement to an audience of FOM Sports users and,
            optionally, promote an upcoming competition with a registration
            link.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Compose announcement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Audience */}
            <div className="space-y-2">
              <Label htmlFor="announcement-audience">Send to</Label>
              <Select
                value={audienceType}
                onValueChange={(value) =>
                  setAudienceType(value as EmailAnnouncementAudienceType)
                }
                disabled={sending}
              >
                <SelectTrigger id="announcement-audience">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_users">
                    All users in FOM-Sports
                  </SelectItem>
                  <SelectItem value="previous_competition">
                    Users from a previous competition
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {audienceType === "previous_competition" && (
              <div className="space-y-2">
                <Label htmlFor="announcement-previous">
                  Previous competition
                </Label>
                <Select
                  value={previousCompetitionId}
                  onValueChange={setPreviousCompetitionId}
                  disabled={sending}
                >
                  <SelectTrigger id="announcement-previous">
                    <SelectValue placeholder="Select a competition" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Select a competition…</SelectItem>
                    {events.map((event) => (
                      <SelectItem key={event.id} value={event.id}>
                        {formatEventOption(event)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Includes historical participants — completed competitions and
                  users who later unregistered.
                </p>
              </div>
            )}

            {/* Optional promoted competition */}
            <div className="space-y-2">
              <Label htmlFor="announcement-promote">
                Promote a competition (optional)
              </Label>
              <Select
                value={promotionCompetitionId}
                onValueChange={setPromotionCompetitionId}
                disabled={sending}
              >
                <SelectTrigger id="announcement-promote">
                  <SelectValue placeholder="No competition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No competition</SelectItem>
                  {promotableEvents.map((event) => (
                    <SelectItem key={event.id} value={event.id}>
                      {formatEventOption(event)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {promotableEvents.length === 0
                  ? "No competition is currently open for registration."
                  : "Anyone already registered for the promoted competition is excluded automatically, and a registration link is added to the email."}
              </p>
            </div>

            {/* Recipient count */}
            <div className="rounded-md bg-muted/40 p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                {audienceLoading
                  ? "Counting recipients…"
                  : `${recipients} recipient${recipients === 1 ? "" : "s"}`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {audience?.baseCount ?? 0} matched
                {audience && audience.excludedRegisteredCount > 0
                  ? ` · ${audience.excludedRegisteredCount} excluded (already registered for the promoted competition)`
                  : ""}
                {audience && audience.invalidCount > 0
                  ? ` · ${audience.invalidCount} skipped (missing or invalid email address)`
                  : ""}
                {audience && audience.duplicateCount > 0
                  ? ` · ${audience.duplicateCount} skipped (duplicate email address)`
                  : ""}
              </p>
              {audienceError && (
                <p className="mt-1 text-xs text-destructive">{audienceError}</p>
              )}
            </div>




            {/* Subject */}
            <div className="space-y-2">
              <Label htmlFor="announcement-subject">Subject</Label>
              <Input
                id="announcement-subject"
                value={subject}
                maxLength={EMAIL_ANNOUNCEMENT_SUBJECT_MAX_LENGTH}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="You're invited to our next competition"
                disabled={sending}
              />
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label htmlFor="announcement-message">Message</Label>
              <Textarea
                id="announcement-message"
                ref={messageRef}
                value={message}
                maxLength={EMAIL_ANNOUNCEMENT_MESSAGE_MAX_LENGTH}
                onChange={(event) => setMessage(event.target.value)}
                rows={12}
                placeholder={
                  "Hi everyone,\n\nWe'd love to see you at our next competition.\n\n- Bring your boots\n- Arrive 30 minutes early\n\nSee you there!"
                }
                disabled={sending}
              />
              <p className="text-xs text-muted-foreground">
                Your formatting is preserved: blank lines become paragraphs,
                single line breaks are kept, leading spaces/tabs are kept, and
                lines starting with <code>-</code>, <code>*</code> or{" "}
                <code>1.</code> become lists. <code>**bold**</code> and{" "}
                <code>*italic*</code> are supported.
              </p>
            </div>

            {/* Image */}
            <div className="space-y-2">
              <Label>Image (optional)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept={ANNOUNCEMENT_IMAGE_MIME_TYPES.join(",")}
                  className="hidden"
                  onChange={(event) => void handleImageChange(event)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || sending}
                >
                  {uploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="mr-2 h-4 w-4" />
                  )}
                  {imageUrl ? "Replace image" : "Upload image"}
                </Button>
                {imageUrl && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={insertImageToken}
                      disabled={sending}
                    >
                      Insert in message
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={removeImage}
                      disabled={sending}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove
                    </Button>
                  </>
                )}
              </div>
              {imageUrl && (
                <div className="mt-2 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt="Attached announcement image"
                    className="h-20 w-20 rounded border object-cover"
                  />
                  <p className="text-xs text-muted-foreground">
                    {imageName ?? "Attached image"}
                    <br />
                    Placed where <code>{ANNOUNCEMENT_IMAGE_TOKEN}</code> appears
                    in your message.
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                JPG, PNG, WebP or GIF, up to 5MB. The image is stored publicly so
                it renders in recipients&apos; email clients.
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handlePreview()}
                disabled={previewing || sending || !canCompose}
              >
                {previewing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="mr-2 h-4 w-4" />
                )}
                Preview email
              </Button>
              <Button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!canSend}
              >
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



          {/* Confirmation (explicit — nothing sends before this) */}
          {confirming && (
            <CardContent className="space-y-3 border-t pt-6">
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                Confirm sending this announcement
              </p>
              <p className="text-sm text-muted-foreground">
                This sends {recipients} individual email
                {recipients === 1 ? "" : "s"} — one message per recipient, so no
                recipient can see another&apos;s address.
                {promotionSelected
                  ? " A registration link for the promoted competition will be included."
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending}
                >
                  {sending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Yes, send now
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={sending}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          )}

          {/* Preview (server-rendered — identical to the delivered email) */}
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
                <summary className="cursor-pointer">
                  Plain-text version
                </summary>
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
                {batch.audience.excludedRegisteredCount > 0 && (
                  <li>
                    Excluded (already registered for the promoted competition):{" "}
                    {batch.audience.excludedRegisteredCount}
                  </li>
                )}
                {batch.audience.invalidCount > 0 && (
                  <li>
                    Skipped (missing or invalid address):{" "}
                    {batch.audience.invalidCount}
                  </li>
                )}
                {batch.audience.duplicateCount > 0 && (
                  <li>
                    Skipped (duplicate address): {batch.audience.duplicateCount}
                  </li>
                )}
              </ul>
              <p className="text-xs text-muted-foreground">
                &quot;Accepted&quot; means the email provider accepted the message
                for delivery. It is not a confirmation that it reached an inbox.
              </p>
              {batch.pendingCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void drainRemaining(batch, batch.id)}
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
      </div>
    </div>
  );
}

