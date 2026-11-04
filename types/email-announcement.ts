/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — Shared (client + server) types for the
 * admin-only "Email Users" feature.
 *
 * These types are dependency-free (no Supabase, no `server-only`) so the
 * composing UI and the server helpers can both use them. They deliberately
 * contain NO recipient email addresses: an audience is always delivered to the
 * browser as COUNTS only.
 */

import type { CompetitionEventStatus } from "@/types";

/** Maximum length of an admin-supplied subject (validated server-side). */
export const EMAIL_ANNOUNCEMENT_SUBJECT_MAX_LENGTH = 150;

/** Maximum length of an admin-supplied message (validated server-side). */
export const EMAIL_ANNOUNCEMENT_MESSAGE_MAX_LENGTH = 8000;

/**
 * The literal the admin places on its own line to position the uploaded image
 * inside the message. Rendered (and stripped) by `renderAnnouncementBodyHtml`.
 */
export const ANNOUNCEMENT_IMAGE_TOKEN = "[image]";

/** Maximum accepted uploaded image size (5 MB, matching the existing uploads). */
export const ANNOUNCEMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Image MIME types accepted for announcement images (all render in email). */
export const ANNOUNCEMENT_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AnnouncementImageMimeType =
  (typeof ANNOUNCEMENT_IMAGE_MIME_TYPES)[number];

/** The dedicated, public Supabase Storage bucket for announcement images. */
export const ANNOUNCEMENT_IMAGE_BUCKET = "email-announcement-images";

/** Who receives the announcement. */
export type EmailAnnouncementAudienceType =
  | "all_users"
  | "previous_competition";

/** Per-recipient delivery state stored in the outbox. */
export type EmailAnnouncementRecipientStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed";

/**
 * Derived batch state for display. Computed from the recorded per-recipient
 * outcomes — it never claims an inbox delivery.
 */
export type EmailAnnouncementState =
  | "empty"
  | "processing"
  | "sent"
  | "partial"
  | "failed";

/**
 * Audience resolution summary. Counts only — never addresses.
 *
 *   baseCount                → rows the audience query returned
 *   eligibleCount            → unique, deliverable recipients addressed by a send
 *   invalidCount             → skipped: missing/invalid address
 *   duplicateCount           → skipped: duplicate address (or duplicate profile)
 *   excludedRegisteredCount  → skipped: already registered for the promoted event
 */
export interface EmailAnnouncementAudienceSummary {
  audienceType: EmailAnnouncementAudienceType;
  baseCount: number;
  eligibleCount: number;
  invalidCount: number;
  duplicateCount: number;
  excludedRegisteredCount: number;
  /** The promoted competition (optional) the exclusions were applied for. */
  promotionEventId: string | null;
}

/**
 * Recorded outcome of one batch. `acceptedCount` is what the provider ACCEPTED
 * (Brevo returned a message id) — never a claim of inbox delivery.
 */
export interface EmailAnnouncementBatchSummary {
  id: string;
  subject: string;
  createdAt: string;
  audience: EmailAnnouncementAudienceSummary;
  acceptedCount: number;
  failedCount: number;
  pendingCount: number;
  state: EmailAnnouncementState;
  /** The promoted competition, when the announcement promoted one. */
  promotionEventId: string | null;
  /** Whether the announcement carried an uploaded image. */
  imageIncluded: boolean;
}

/** Server-built preview of exactly what one recipient will receive. */
export interface EmailAnnouncementPreview {
  subject: string;
  html: string;
  text: string;
  audience: EmailAnnouncementAudienceSummary;
}

/** A selectable competition in the audience / promotion dropdowns. */
export interface EmailAnnouncementCompetitionOption {
  id: string;
  name: string;
  eventDate: string | null;
  status: CompetitionEventStatus;
}
