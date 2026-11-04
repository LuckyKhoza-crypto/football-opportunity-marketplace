/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — Admin "Email Users" announcement email.
 *
 * Builds the email sent INDIVIDUALLY to each recipient of an admin-selected
 * audience (all users, or the participants of a previous competition). It reuses
 * the EMAIL-001 shell (`buildFomEmailShell`) so branding and styling stay
 * consistent and Brevo remains the only transport.
 *
 * This is a NEW, independent template. The competition-specific
 * `competition-participant-message` template and the "Email Participants"
 * pipeline are deliberately untouched.
 *
 * Privacy: this template renders ONE recipient. No other recipient's address is
 * ever included.
 *
 * Trust: the subject and the message are UNTRUSTED admin input. The message is
 * rendered by `renderAnnouncementBodyHtml`, which escapes every text run before
 * applying the supported inline markers, so the announcement can never inject
 * arbitrary markup. The promoted competition name/URL are read from the
 * database / generated server-side — never taken from the browser.
 */

import {
  buildFomEmailShell,
  escapeHtml,
} from "@/lib/email/templates/fom-email-shell";
import {
  renderAnnouncementBodyHtml,
  renderAnnouncementBodyText,
} from "@/lib/email-announcements";
import type { TransactionalEmail } from "@/lib/email/types";

const MUTED = "#6b7280";
const TEXT = "#1f2937";

export interface EmailAnnouncementPromotion {
  /** The promoted competition's name (read from `competition_events`). */
  name: string;
  /** The server-resolved absolute registration URL (a validated join link). */
  url: string;
}

export interface EmailAnnouncementInput {
  /** The single recipient address (already normalized + validated). */
  to: string;
  /** Optional recipient display name, when the profile has one. */
  recipientName: string | null;
  /** The admin's validated subject line. */
  subject: string;
  /** The admin's validated plain-text message. */
  message: string;
  /** Absolute public URL of the uploaded image, when one is attached. */
  imageUrl: string | null;
  /** The optional promoted competition (registration link + CTA). */
  promotion: EmailAnnouncementPromotion | null;
}

/**
 * Build the announcement email. Returns a complete `TransactionalEmail` ready
 * to hand to the EMAIL-001 send service.
 */
export function buildEmailAnnouncementEmail(
  input: EmailAnnouncementInput,
): TransactionalEmail {
  const subject = input.subject.trim();
  const greetingName = input.recipientName?.trim();
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi there,";

  const promotion = input.promotion
    ? {
        name: input.promotion.name.trim() || "the competition",
        url: input.promotion.url.trim(),
      }
    : null;

  // A prominent, clickable registration block for the promoted competition.
  // The shell's own CTA button is used as well, so the link is unmissable.
  const promotionHtml = promotion
    ? `<div style="margin:16px 0 0 0;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background-color:#fff7ed;">
    <p style="margin:0 0 8px 0;font-size:15px;font-weight:bold;color:${TEXT};">${escapeHtml(
      promotion.name,
    )}</p>
    <p style="margin:0 0 12px 0;font-size:14px;color:${MUTED};">Register using the button below, or open this link:</p>
    <p style="margin:0;font-size:13px;word-break:break-all;"><a href="${escapeHtml(
      promotion.url,
    )}" target="_blank" rel="noopener noreferrer" style="color:#ea580c;">${escapeHtml(
      promotion.url,
    )}</a></p>
  </div>`
    : "";

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>
    ${renderAnnouncementBodyHtml(input.message, { imageUrl: input.imageUrl })}
    ${promotionHtml}
  `.trim();

  const bodyTextParts = [
    greeting,
    "",
    renderAnnouncementBodyText(input.message, { imageUrl: input.imageUrl }),
  ];
  if (promotion) {
    bodyTextParts.push("", `${promotion.name} — register here:`, promotion.url);
  }

  const { html, text } = buildFomEmailShell({
    title: subject,
    bodyHtml,
    bodyText: bodyTextParts.join("\n"),
    preheader: subject,
    cta: promotion
      ? { label: `Register for ${promotion.name}`, href: promotion.url }
      : undefined,
  });

  return {
    to: { email: input.to, ...(greetingName ? { name: greetingName } : {}) },
    subject,
    html,
    text,
  };
}
