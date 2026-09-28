/**
 * EMAIL-004 — Application status transactional email template.
 *
 * Builds the specialized email sent to a player when their application changes
 * status (accepted / rejected / reviewing / withdrawn). It reuses the EMAIL-001
 * shell (`buildFomEmailShell`) so branding/styling stay consistent and Brevo
 * remains the only transport.
 *
 * Content rules:
 *   * Never expose internal ids (application id, opportunity id, profile ids,
 *     notification id, or database identifiers).
 *   * Only public-safe presentation copy is rendered (team name, opportunity
 *     title, optional player name).
 *   * The canonical status value is preserved verbatim in the payload; the
 *     user-facing copy may phrase it differently (e.g. `rejected` → "declined")
 *     to match the existing application UI. `pending` is never a valid target
 *     status for a change, so it has no dedicated copy.
 *   * Missing optional data is handled gracefully — the copy adapts and never
 *     renders "undefined".
 *
 * The CTA link is the app's own application route (`/player/applications/<id>`),
 * which the caller has already resolved into an absolute URL. The id appears
 * only inside the href the recipient clicks, never as visible text.
 */

import {
  buildFomEmailShell,
  escapeHtml,
} from "@/lib/email/templates/fom-email-shell";
import type { TransactionalEmail } from "@/lib/email/types";
import type { ApplicationStatusNotificationData } from "@/lib/notification-data";

export interface ApplicationStatusEmailInput {
  to: string;
  /** Absolute application URL, or null when it could not be resolved. */
  applicationUrl: string | null;
  data: ApplicationStatusNotificationData;
}

/** Human-readable "Team — Opportunity" context line, degrading gracefully. */
function buildContextLine(
  data: ApplicationStatusNotificationData,
): string | null {
  const team = data.teamName?.trim() || null;
  const title = data.opportunityTitle?.trim() || null;
  if (team && title) return `${team} — ${title}`;
  return team ?? title;
}

/** What the application is for, degrading to a generic phrase. */
function describeApplication(
  data: ApplicationStatusNotificationData,
): string {
  return data.opportunityTitle?.trim() || "this opportunity";
}

/** Subject line shown in the recipient's inbox. */
export function buildApplicationStatusEmailSubject(
  data: ApplicationStatusNotificationData,
): string {
  const team = data.teamName?.trim();
  switch (data.status) {
    case "accepted":
      return team
        ? `Your application to ${team} was accepted`
        : "Your application was accepted";
    case "rejected":
      // Canonical status is `rejected`; the user-facing copy says "declined"
      // to match the existing application UI.
      return team
        ? `Your application to ${team} was declined`
        : "Your application was declined";
    case "reviewing":
      return team
        ? `Your application to ${team} is being reviewed`
        : "Your application is being reviewed";
    case "withdrawn":
      return team
        ? `Your application to ${team} was withdrawn`
        : "Your application was withdrawn";
    default:
      return "Your application status was updated";
  }
}

/** Status-specific sentence for the email body (HTML fragment). */
function buildStatusSentenceHtml(
  data: ApplicationStatusNotificationData,
): string {
  const team = data.teamName?.trim() || "The team";
  const what = escapeHtml(describeApplication(data));
  const safeTeam = escapeHtml(team);

  switch (data.status) {
    case "accepted":
      return `${safeTeam} has accepted your application for <strong>${what}</strong>. They may reach out to you with next steps.`;
    case "rejected":
      return `${safeTeam} has declined your application for <strong>${what}</strong>.`;
    case "reviewing":
      return `${safeTeam} is currently reviewing your application for <strong>${what}</strong>.`;
    case "withdrawn":
      return `You withdrew your application for <strong>${what}</strong> at ${safeTeam}.`;
    default:
      return `Your application for <strong>${what}</strong> at ${safeTeam} has been updated.`;
  }
}

/** Status-specific sentence for the plain-text body. */
function buildStatusSentenceText(
  data: ApplicationStatusNotificationData,
): string {
  const team = data.teamName?.trim() || "The team";
  const what = describeApplication(data);

  switch (data.status) {
    case "accepted":
      return `${team} has accepted your application for "${what}". They may reach out to you with next steps.`;
    case "rejected":
      return `${team} has declined your application for "${what}".`;
    case "reviewing":
      return `${team} is currently reviewing your application for "${what}".`;
    case "withdrawn":
      return `You withdrew your application for "${what}" at ${team}.`;
    default:
      return `Your application for "${what}" at ${team} has been updated.`;
  }
}

/** The headline shown at the top of the email. */
function buildHeadline(data: ApplicationStatusNotificationData): string {
  switch (data.status) {
    case "accepted":
      return "Your application was accepted";
    case "rejected":
      return "Your application was declined";
    case "reviewing":
      return "Your application is being reviewed";
    case "withdrawn":
      return "Your application was withdrawn";
    default:
      return "Your application status was updated";
  }
}

/**
 * Build the specialized application-status email. Returns a complete
 * `TransactionalEmail` ready to hand to the EMAIL-001 send service.
 */
export function buildApplicationStatusEmail(
  input: ApplicationStatusEmailInput,
): TransactionalEmail {
  const { to, applicationUrl, data } = input;

  const greetingName = data.playerName?.trim();
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi there,";
  const contextLine = buildContextLine(data);

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 12px 0;">${buildStatusSentenceHtml(data)}</p>`;

  const bodyTextLines = [
    greeting,
    "",
    buildStatusSentenceText(data),
  ];

  const { html, text } = buildFomEmailShell({
    title: buildHeadline(data),
    bodyHtml,
    bodyText: bodyTextLines.join("\n"),
    preheader: contextLine ?? undefined,
    cta: applicationUrl
      ? { label: "View Application", href: applicationUrl }
      : undefined,
  });

  return {
    to: { email: to },
    subject: buildApplicationStatusEmailSubject(data),
    html,
    text,
  };
}