/**
 * COMP-EMAIL-001 — Competition registration confirmation email template.
 *
 * Builds the email sent to a participant immediately after they register for a
 * competition. It reuses the EMAIL-001 shell (`buildFomEmailShell`) so
 * branding/styling stay consistent and Brevo remains the only transport.
 *
 * Content rules:
 *   * The QR image is the participant's ACTUAL registration pass QR. The caller
 *     passes the absolute URL of the hosted PNG (served by
 *     `app/api/competitions/verify-qr/[token]/route.ts` from the exact
 *     verification token shown on the pass screen). This template never invents
 *     a payload, never mints a token, and never embeds a `data:` URI (Gmail
 *     strips those) or a `cid:` reference (unsupported by Brevo).
 *   * The verification code is the exact code used by the existing
 *     registration/check-in flow (shown as a text fallback to the QR).
 *   * Only presentation copy is rendered. Internal ids (event/participant/
 *     profile/notification ids) and the raw verification token are never
 *     printed as visible text — the token appears only inside the QR image.
 *   * Missing optional event fields are omitted entirely (no placeholders).
 *     The competition schema has no dedicated venue/address/map/parking
 *     fields, so those are not fabricated.
 */

import { buildFomEmailShell, escapeHtml } from "@/lib/email/templates/fom-email-shell";
import type { TransactionalEmail } from "@/lib/email/types";
import { formatVerificationCode } from "@/lib/competition-join";

export interface CompetitionRegistrationEmailInput {
  to: string;
  /** Competition / event name. */
  competitionName: string;
  /** Event date-time (ISO string) or null. */
  eventDate: string | null;
  /** Free-text location, when the organizer provided one. */
  location: string | null;
  /** Free-text organizer notes / instructions, when provided. */
  description: string | null;
  /** Challenge name configured on the event, when available. */
  challengeName: string | null;
  /** The participant's verification code (check-in fallback), when available. */
  verificationCode: string | null;
  /**
   * Absolute URL of the hosted PNG for the participant's registration pass QR.
   * Served by the public `verify-qr` route from the exact pass token, so it
   * encodes the identical payload shown on the pass screen.
   */
  qrImageUrl: string;
  /** Participant display name, when available. */
  participantName: string | null;
}

const MUTED = "#6b7280";
const TEXT = "#1f2937";
const BORDER = "#e5e7eb";

/**
 * Format an event date-time with an explicit, unambiguous timezone.
 * The schema stores a timestamptz but exposes no event timezone, so we label
 * UTC rather than implying an unstated local time.
 */
export function formatCompetitionEventDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

/** Subject line shown in the recipient's inbox. */
export function buildCompetitionRegistrationEmailSubject(
  input: Pick<CompetitionRegistrationEmailInput, "competitionName">,
): string {
  const name = input.competitionName?.trim();
  return name
    ? `You're registered for ${name}`
    : "Your FOM Sports competition registration is confirmed";
}

/** A single "label: value" detail row, omitted when the value is missing. */
function detailRowHtml(label: string, value: string | null): string {
  if (!value) return "";
  return `<p style="margin:0 0 6px 0;font-size:14px;color:${TEXT};"><span style="color:${MUTED};">${escapeHtml(
    label,
  )}:</span> <strong>${escapeHtml(value)}</strong></p>`;
}

/**
 * Build the specialized competition-registration confirmation email. Returns a
 * complete `TransactionalEmail` ready to hand to the EMAIL-001 send service.
 */
export function buildCompetitionRegistrationEmail(
  input: CompetitionRegistrationEmailInput,
): TransactionalEmail {
  const {
    to,
    competitionName,
    eventDate,
    location,
    description,
    challengeName,
    verificationCode,
    qrImageUrl,
    participantName,
  } = input;

  const name = competitionName?.trim() || "your competition";
  const greetingName = participantName?.trim();
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi there,";
  const prettyDate = formatCompetitionEventDate(eventDate);
  const prettyCode = verificationCode
    ? formatVerificationCode(verificationCode)
    : null;

  const detailRows =
    detailRowHtml("When", prettyDate) +
    detailRowHtml("Where", location?.trim() || null) +
    detailRowHtml("Challenge", challengeName?.trim() || null);

  const notesHtml = description?.trim()
    ? `<p style="margin:12px 0 0 0;font-size:14px;color:${TEXT};">${escapeHtml(
        description.trim(),
      )}</p>`
    : "";

  const codeHtml = prettyCode
    ? `<p style="margin:12px 0 0 0;font-size:14px;color:${MUTED};">Your check-in verification code</p>
      <p style="margin:4px 0 0 0;font-family:'Courier New',Courier,monospace;font-size:26px;font-weight:bold;letter-spacing:3px;color:${TEXT};">${escapeHtml(
        prettyCode,
      )}</p>`
    : "";

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 16px 0;">You're registered for <strong>${escapeHtml(
      name,
    )}</strong>. Here is your registration pass.</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid ${BORDER};border-radius:8px;">
      <tr>
        <td align="center" style="padding:20px;">
          <img src="${escapeHtml(
            qrImageUrl,
          )}" alt="Your registration QR code" width="200" height="200" style="display:block;width:200px;height:200px;border-radius:6px;background-color:#ffffff;" />
          <p style="margin:8px 0 0 0;font-size:13px;color:${MUTED};">Show this QR code to event staff at check-in.</p>${codeHtml}
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0 0;font-size:14px;color:${TEXT};">At check-in, present the QR code above — or, if you can't, just tell the event staff your verification code.</p>
    ${detailRows ? `<div style="margin:16px 0 0 0;">${detailRows}</div>` : ""}
    ${notesHtml}
  `.trim();

  const textLines = [
    greeting,
    "",
    `You're registered for ${name}.`,
    "",
    prettyCode
      ? `Your verification code: ${prettyCode}`
      : "Show the QR code in this email at check-in.",
    "At check-in, present the QR code in this email (or provide your verification code).",
  ];
  if (prettyDate) textLines.push("", `When: ${prettyDate}`);
  if (location?.trim()) textLines.push(`Where: ${location.trim()}`);
  if (challengeName?.trim()) textLines.push(`Challenge: ${challengeName.trim()}`);
  if (description?.trim()) textLines.push("", description.trim());

  const { html, text } = buildFomEmailShell({
    title: "You're registered",
    bodyHtml,
    bodyText: textLines.join("\n"),
    preheader: `Your registration for ${name} is confirmed`,
  });

  return {
    to: { email: to, ...(greetingName ? { name: greetingName } : {}) },
    subject: buildCompetitionRegistrationEmailSubject({ competitionName: name }),
    html,
    text,
  };
}
