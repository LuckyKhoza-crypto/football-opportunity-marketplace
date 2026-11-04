/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — Pure (client-safe) helpers for the admin-only
 * "Email Users" feature.
 *
 * No I/O, no Supabase, no `server-only`: this module holds the small, testable
 * policy pieces that BOTH the UI and the server use, so the browser and the
 * server can never disagree about what is valid:
 *
 *   * input validation (subject / message / audience / optional promotion),
 *   * audience resolution (dedupe, invalid-address skipping, exclusion of
 *     profiles already registered for the promoted competition),
 *   * the plain-text → email-safe HTML renderer that PRESERVES the admin's
 *     formatting (paragraphs, blank lines, line breaks, indentation, bullet and
 *     numbered lists, `**bold**` / `*italic*`) plus its plain-text alternative.
 *
 * SECURITY: the subject and the message are UNTRUSTED admin input. Every text
 * run is HTML-escaped before any inline marker is applied, so the renderer can
 * never emit markup that the admin did not intentionally type (no scripts, no
 * injected tags, no tracking pixels).
 *
 * This module deliberately reuses only PURE, generic helpers — the shared
 * `escapeHtml` and the address normalization/validity checks. It is NOT coupled
 * to the competition-specific "Email Participants" workflow.
 */

import { escapeHtml } from "@/lib/email/templates/fom-email-shell";
import {
  isDeliverableRecipientEmail,
  normalizeRecipientEmail,
} from "@/lib/competition-bulk-email";
import {
  ANNOUNCEMENT_IMAGE_TOKEN,
  EMAIL_ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
  EMAIL_ANNOUNCEMENT_SUBJECT_MAX_LENGTH,
  type EmailAnnouncementAudienceSummary,
  type EmailAnnouncementAudienceType,
  type EmailAnnouncementState,
} from "@/types/email-announcement";

// ─── Ids / audience types ───────────────────────────────────────────────────

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value is a UUID-shaped id (never trusts a client value). */
export function isAnnouncementId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

/** The only audiences this feature supports (deliberately a closed set). */
export const ANNOUNCEMENT_AUDIENCE_TYPES: readonly EmailAnnouncementAudienceType[] =
  ["all_users", "previous_competition"];

export function isAnnouncementAudienceType(
  value: unknown,
): value is EmailAnnouncementAudienceType {
  return (
    typeof value === "string" &&
    (ANNOUNCEMENT_AUDIENCE_TYPES as readonly string[]).includes(value)
  );
}

// ─── Input validation ───────────────────────────────────────────────────────

export interface ValidatedAnnouncementInput {
  subject: string;
  message: string;
  audienceType: EmailAnnouncementAudienceType;
  previousCompetitionId: string | null;
  promotionCompetitionId: string | null;
  imageUrl: string | null;
}

export type AnnouncementInputValidation =
  | ({ ok: true } & ValidatedAnnouncementInput)
  | { ok: false; error: string };

/** A permissive http(s) check for an uploaded-image URL. */
function isHttpImageUrl(value: string): boolean {
  return value.length <= 2048 && /^https?:\/\/\S+$/i.test(value);
}

/**
 * Validate and normalize an admin-supplied announcement.
 *
 * Rules (enforced on the SERVER; the UI mirrors them for a fast hint):
 *   * subject and message are required and non-empty after trimming,
 *   * the subject may not contain CR/LF (header-injection guard) and may not
 *     exceed EMAIL_ANNOUNCEMENT_SUBJECT_MAX_LENGTH characters,
 *   * the message may not exceed EMAIL_ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
 *   * the audience must be one of the supported types,
 *   * `previousCompetitionId` is required iff the audience is a previous
 *     competition (and must be a UUID),
 *   * `promotionCompetitionId` is optional but, when present, must be a UUID and
 *     must differ from the audience competition (promoting the audience
 *     competition would exclude every recipient),
 *   * `imageUrl` is optional; when present it must be an http(s) URL (the server
 *     additionally verifies it belongs to the announcement image bucket).
 */
export function validateAnnouncementInput(input: {
  subject: unknown;
  message: unknown;
  audienceType: unknown;
  previousCompetitionId: unknown;
  promotionCompetitionId: unknown;
  imageUrl: unknown;
}): AnnouncementInputValidation {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const message =
    typeof input.message === "string"
      ? input.message.replace(/\r\n/g, "\n")
      : "";

  if (subject.length === 0) {
    return { ok: false, error: "A subject is required." };
  }
  if (/[\r\n]/.test(subject)) {
    return {
      ok: false,
      error: "The subject must be a single line (no line breaks).",
    };
  }
  if (subject.length > EMAIL_ANNOUNCEMENT_SUBJECT_MAX_LENGTH) {
    return {
      ok: false,
      error: `The subject must be ${EMAIL_ANNOUNCEMENT_SUBJECT_MAX_LENGTH} characters or fewer.`,
    };
  }
  if (message.trim().length === 0) {
    return { ok: false, error: "A message is required." };
  }
  if (message.length > EMAIL_ANNOUNCEMENT_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `The message must be ${EMAIL_ANNOUNCEMENT_MESSAGE_MAX_LENGTH} characters or fewer.`,
    };
  }

  const audience = normalizeAnnouncementAudience(input);
  if (!audience.ok) return audience;

  const imageRaw =
    typeof input.imageUrl === "string" ? input.imageUrl.trim() : "";
  let imageUrl: string | null = null;
  if (imageRaw.length > 0) {
    if (!isHttpImageUrl(imageRaw)) {
      return { ok: false, error: "The attached image is not valid." };
    }
    imageUrl = imageRaw;
  }

  return {
    ok: true,
    subject,
    message,
    audienceType: audience.audienceType,
    previousCompetitionId: audience.previousCompetitionId,
    promotionCompetitionId: audience.promotionCompetitionId,
    imageUrl,
  };
}

export interface NormalizedAnnouncementAudience {
  audienceType: EmailAnnouncementAudienceType;
  previousCompetitionId: string | null;
  promotionCompetitionId: string | null;
}

export type AnnouncementAudienceValidation =
  | ({ ok: true } & NormalizedAnnouncementAudience)
  | { ok: false; error: string };

/**
 * Validate and normalize ONLY the audience selection (used by the audience-count
 * endpoint, which does not carry a subject/message).
 *
 * Rules:
 *   * the audience must be one of the supported types,
 *   * `previousCompetitionId` is required iff the audience is a previous
 *     competition (and must be a UUID),
 *   * `promotionCompetitionId` is optional but, when present, must be a UUID and
 *     must differ from the audience competition (promoting the audience
 *     competition would exclude every recipient).
 */
export function normalizeAnnouncementAudience(input: {
  audienceType: unknown;
  previousCompetitionId: unknown;
  promotionCompetitionId: unknown;
}): AnnouncementAudienceValidation {
  if (!isAnnouncementAudienceType(input.audienceType)) {
    return { ok: false, error: "A valid audience must be selected." };
  }

  const previousCompetitionId =
    typeof input.previousCompetitionId === "string"
      ? input.previousCompetitionId.trim()
      : "";

  if (input.audienceType === "previous_competition") {
    if (!isAnnouncementId(previousCompetitionId)) {
      return {
        ok: false,
        error: "Select the previous competition whose participants to email.",
      };
    }
  } else if (
    previousCompetitionId.length > 0 &&
    !isAnnouncementId(previousCompetitionId)
  ) {
    return { ok: false, error: "The selected competition is not valid." };
  }

  const promotionRaw =
    typeof input.promotionCompetitionId === "string"
      ? input.promotionCompetitionId.trim()
      : "";

  let promotionCompetitionId: string | null = null;
  if (promotionRaw.length > 0) {
    if (!isAnnouncementId(promotionRaw)) {
      return { ok: false, error: "The promoted competition is not valid." };
    }
    if (
      input.audienceType === "previous_competition" &&
      promotionRaw.toLowerCase() === previousCompetitionId.toLowerCase()
    ) {
      return {
        ok: false,
        error:
          "The promoted competition cannot be the same as the audience competition (every recipient would already be registered).",
      };
    }
    promotionCompetitionId = promotionRaw;
  }

  return {
    ok: true,
    audienceType: input.audienceType,
    previousCompetitionId:
      input.audienceType === "previous_competition"
        ? previousCompetitionId
        : null,
    promotionCompetitionId,
  };
}



// ─── Audience resolution ────────────────────────────────────────────────────

/** One candidate row read from the authoritative user/registration data. */
export interface AnnouncementAudienceRow {
  profileId: string;
  email: string | null;
  fullName: string | null;
}

/** A single resolved recipient — never returned to the browser. */
export interface AnnouncementRecipient {
  profileId: string;
  /** Normalized (trimmed + lowercased) address. */
  email: string;
  name: string | null;
}

export interface AnnouncementAudienceResolution {
  recipients: AnnouncementRecipient[];
  summary: EmailAnnouncementAudienceSummary;
}

/**
 * Resolve the deliverable audience from candidate rows.
 *
 * `registeredProfileIds` is the server-resolved set of profiles that already
 * hold an ACTIVE registration for the promoted competition (identity based —
 * never email matching). Those profiles are excluded from BOTH audiences.
 *
 * Rows with a missing/invalid address are skipped, and duplicate addresses (or
 * duplicate profiles) are collapsed, with every skip reported as a count.
 */
export function resolveAnnouncementAudience(
  rows: readonly AnnouncementAudienceRow[],
  options: {
    audienceType: EmailAnnouncementAudienceType;
    promotionEventId?: string | null;
    registeredProfileIds?: ReadonlySet<string>;
  },
): AnnouncementAudienceResolution {
  const registered = options.registeredProfileIds ?? new Set<string>();
  const recipients: AnnouncementRecipient[] = [];
  const seenEmails = new Set<string>();
  const seenProfiles = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;
  let excludedRegisteredCount = 0;

  for (const row of rows) {
    if (!row.profileId) continue;

    if (registered.has(row.profileId)) {
      excludedRegisteredCount += 1;
      continue;
    }

    if (seenProfiles.has(row.profileId)) {
      duplicateCount += 1;
      continue;
    }
    seenProfiles.add(row.profileId);

    if (!isDeliverableRecipientEmail(row.email)) {
      invalidCount += 1;
      continue;
    }

    const email = normalizeRecipientEmail(row.email) as string;
    if (seenEmails.has(email)) {
      duplicateCount += 1;
      continue;
    }
    seenEmails.add(email);

    recipients.push({
      profileId: row.profileId,
      email,
      name: row.fullName?.trim() ? row.fullName.trim() : null,
    });
  }

  return {
    recipients,
    summary: {
      audienceType: options.audienceType,
      baseCount: rows.length,
      eligibleCount: recipients.length,
      invalidCount,
      duplicateCount,
      excludedRegisteredCount,
      promotionEventId: options.promotionEventId ?? null,
    },
  };
}


// ─── Formatting-preserving rendering ────────────────────────────────────────

export interface AnnouncementRenderOptions {
  /** Absolute public URL of the uploaded image, when one is attached. */
  imageUrl?: string | null;
}

/**
 * Inline markers supported by the plain-text editor (documented in the UI).
 *
 * Only `**bold**` and `*italic*` are recognized. `_underscore_` italics are
 * deliberately NOT supported so that pasted URLs and email addresses containing
 * underscores are never mangled.
 *
 * `String.replace` with a global regex always restarts from index 0, so sharing
 * these module-level patterns is safe.
 */
const BOLD_PATTERN = /\*\*([^*\n]+)\*\*/g;
const ITALIC_PATTERN = /\*([^*\n]+)\*/g;

/** Escape a text run, then apply the supported inline markers. */
function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(BOLD_PATTERN, "<strong>$1</strong>")
    .replace(ITALIC_PATTERN, "<em>$1</em>");
}

/** Strip the inline markers for the plain-text alternative. */
function stripInlineMarkers(text: string): string {
  return text.replace(BOLD_PATTERN, "$1").replace(ITALIC_PATTERN, "$1");
}

const BULLET_LINE = /^([ \t]*)(?:[-*\u2022])\s+(.*)$/;
const ORDERED_LINE = /^([ \t]*)\d{1,3}[.)]\s+(.*)$/;

/** Convert a leading-whitespace prefix into a capped pixel indent. */
function indentPx(prefix: string): number {
  let width = 0;
  for (const ch of prefix) width += ch === "\t" ? 4 : 1;
  return Math.min(Math.floor(width / 2) * 20, 120);
}

function listItemHtml(text: string, indent: number): string {
  const style = `margin:0 0 6px 0;white-space:pre-wrap;${
    indent > 0 ? `margin-left:${indent}px;` : ""
  }`;
  return `<li style="${style}">${renderInline(text)}</li>`;
}

function imageBlockHtml(url: string): string {
  return `<p style="margin:0 0 12px 0;"><img src="${escapeHtml(
    url,
  )}" alt="Announcement image" style="max-width:100%;height:auto;display:block;border-radius:6px;" /></p>`;
}

/** Whether the message positions the image with the explicit token line. */
export function hasAnnouncementImageToken(message: string): boolean {
  return message
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((line) => line.trim() === ANNOUNCEMENT_IMAGE_TOKEN);
}


/**
 * Convert the admin's plain-text message into escaped, email-safe HTML while
 * PRESERVING its structure:
 *
 *   * blank lines separate paragraphs (`<p>`),
 *   * single line breaks inside a paragraph become `<br />`,
 *   * leading spaces/tabs are preserved (`white-space:pre-wrap`),
 *   * `- `, `* ` and `• ` lines become `<ul><li>` (indentation preserved),
 *   * `1. ` / `1) ` lines become `<ol><li>`,
 *   * `**bold**` and `*italic*` are applied AFTER escaping, so no unsafe markup
 *     can be produced,
 *   * a line containing only `[image]` renders the uploaded image at that
 *     position; when an image is attached but no token is present it is appended
 *     at the end.
 *
 * The SAME function is used to build the preview and the delivered email, so the
 * two can never diverge.
 */
export function renderAnnouncementBodyHtml(
  message: string,
  options: AnnouncementRenderOptions = {},
): string {
  const imageUrl = options.imageUrl?.trim() || null;
  const lines = message.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const html: string[] = [];
  let imagePlaced = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    if (line.trim() === ANNOUNCEMENT_IMAGE_TOKEN) {
      if (imageUrl) {
        html.push(imageBlockHtml(imageUrl));
        imagePlaced = true;
      }
      i += 1;
      continue;
    }

    const bullet = BULLET_LINE.exec(line);
    if (bullet) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = BULLET_LINE.exec(lines[i]);
        if (!match) break;
        items.push(listItemHtml(match[2], indentPx(match[1])));
        i += 1;
      }
      html.push(
        `<ul style="margin:0 0 12px 0;padding-left:24px;">${items.join("")}</ul>`,
      );
      continue;
    }

    const ordered = ORDERED_LINE.exec(line);
    if (ordered) {
      const items: string[] = [];
      while (i < lines.length) {
        const match = ORDERED_LINE.exec(lines[i]);
        if (!match) break;
        items.push(listItemHtml(match[2], indentPx(match[1])));
        i += 1;
      }
      html.push(
        `<ol style="margin:0 0 12px 0;padding-left:24px;">${items.join("")}</ol>`,
      );
      continue;
    }

    // A paragraph: consecutive plain lines, joined with hard line breaks.
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const current = lines[i];
      if (current.trim().length === 0) break;
      if (current.trim() === ANNOUNCEMENT_IMAGE_TOKEN) break;
      if (BULLET_LINE.test(current) || ORDERED_LINE.test(current)) break;
      paragraphLines.push(renderInline(current));
      i += 1;
    }
    if (paragraphLines.length > 0) {
      html.push(
        `<p style="margin:0 0 12px 0;white-space:pre-wrap;">${paragraphLines.join(
          "<br />",
        )}</p>`,
      );
    }
  }

  if (imageUrl && !imagePlaced) {
    html.push(imageBlockHtml(imageUrl));
  }

  return html.join("");
}


/**
 * Plain-text alternative that keeps the line breaks and list structure (the
 * source already IS plain text, so only the inline markers are stripped and the
 * image position is described).
 */
export function renderAnnouncementBodyText(
  message: string,
  options: AnnouncementRenderOptions = {},
): string {
  const imageUrl = options.imageUrl?.trim() || null;
  const lines = message.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  let imagePlaced = false;

  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/g, "");
    if (line.trim() === ANNOUNCEMENT_IMAGE_TOKEN) {
      if (imageUrl) {
        out.push(`Image: ${imageUrl}`);
        imagePlaced = true;
      }
      continue;
    }
    out.push(stripInlineMarkers(line));
  }

  if (imageUrl && !imagePlaced) {
    out.push("", `Image: ${imageUrl}`);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Outcome derivation ─────────────────────────────────────────────────────

/**
 * Derive the display state of a batch from its recorded per-recipient outcomes.
 * Never implies an inbox delivery: "sent" means the provider ACCEPTED every
 * message.
 */
export function deriveAnnouncementState(counts: {
  eligibleCount: number;
  acceptedCount: number;
  failedCount: number;
  pendingCount: number;
}): EmailAnnouncementState {
  if (counts.eligibleCount === 0) return "empty";
  if (counts.pendingCount > 0) return "processing";
  if (counts.failedCount === 0) return "sent";
  if (counts.acceptedCount === 0) return "failed";
  return "partial";
}

