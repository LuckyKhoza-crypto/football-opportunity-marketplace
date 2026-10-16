/**
 * T-BULK-1 — "Message from the competition organizers" email.
 *
 * Builds the email sent INDIVIDUALLY to each active registered participant of a
 * competition when an authorized host/ambassador uses the "Email Participants"
 * action. It reuses the EMAIL-001 shell (`buildFomEmailShell`) so branding and
 * styling stay consistent and Brevo remains the only transport.
 *
 * Privacy: this template renders ONE recipient. The host's message never carries
 * any other participant's address, and the shell never adds a visible recipient
 * list.
 *
 * Trust: the subject and the message are UNTRUSTED host input — every
 * interpolation is HTML-escaped (the message is converted to paragraphs by
 * `messageToHtml`). Only event details read from `competition_events` are
 * appended, and a missing value is simply omitted (never invented).
 */

import { buildFomEmailShell, escapeHtml } from "@/lib/email/templates/fom-email-shell";
import { formatCompetitionEventDate } from "@/lib/email/templates/competition-registration";
import { messageToHtml } from "@/lib/competition-bulk-email";
import type { TransactionalEmail } from "@/lib/email/types";

const MUTED = "#6b7280";
const TEXT = "#1f2937";

export interface CompetitionParticipantMessageInput {
  /** The single recipient address (already normalized + validated). */
  to: string;
  /** Optional recipient display name, when the profile has one. */
  recipientName: string | null;
  /** Competition / event name read from `competition_events`. */
  competitionName: string;
  /** The host's validated subject line. */
  subject: string;
  /** The host's validated plain-text message. */
  message: string;
  /** Verified event date-time (ISO string) read from the event, or null. */
  eventDate: string | null;
  /** Verified free-text location read from the event, or null. */
  location: string | null;
  /** Verified challenge name read from the event, or null. */
  challengeName: string | null;
}

/** A single "label: value" detail row, omitted when the value is missing. */
function detailRowHtml(label: string, value: string | null): string {
  if (!value) return "";
  return `<p style="margin:0 0 6px 0;font-size:14px;color:${TEXT};"><span style="color:${MUTED};">${escapeHtml(
    label,
  )}:</span> <strong>${escapeHtml(value)}</strong></p>`;
}

/**
 * Build the participant message email. Returns a complete `TransactionalEmail`
 * ready to hand to the EMAIL-001 send service.
 */
export function buildCompetitionParticipantMessageEmail(
  input: CompetitionParticipantMessageInput,
): TransactionalEmail {
  const name = input.competitionName?.trim() || "your competition";
  const subject = input.subject.trim();
  const greetingName = input.recipientName?.trim();
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi there,";
  const prettyDate = formatCompetitionEventDate(input.eventDate);
  const location = input.location?.trim() || null;
  const challenge = input.challengeName?.trim() || null;

  const detailRows =
    detailRowHtml("When", prettyDate) +
    detailRowHtml("Where", location) +
    detailRowHtml("Challenge", challenge);

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 16px 0;font-size:14px;color:${MUTED};">Message from the organizers of <strong>${escapeHtml(
      name,
    )}</strong>.</p>
    ${messageToHtml(input.message)}
    ${
      detailRows
        ? `<div style="margin:16px 0 0 0;padding-top:12px;border-top:1px solid #e5e7eb;">${detailRows}</div>`
        : ""
    }
  `.trim();

  const textLines = [
    greeting,
    "",
    `Message from the organizers of ${name}.`,
    "",
    input.message,
  ];
  if (prettyDate) textLines.push("", `When: ${prettyDate}`);
  if (location) textLines.push(`Where: ${location}`);
  if (challenge) textLines.push(`Challenge: ${challenge}`);

  const { html, text } = buildFomEmailShell({
    title: subject,
    bodyHtml,
    bodyText: textLines.join("\n"),
    preheader: `${name}: ${subject}`,
  });

  return {
    to: { email: input.to, ...(greetingName ? { name: greetingName } : {}) },
    subject,
    html,
    text,
  };
}
