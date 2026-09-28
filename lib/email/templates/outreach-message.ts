/**
 * EMAIL-003 — "Team contacted you" transactional email template.
 *
 * Builds the specialized email sent to a player when a team reaches out through
 * the marketplace. It reuses the EMAIL-001 shell (`buildFomEmailShell`) so
 * branding/styling stay consistent and Brevo remains the only transport.
 *
 * Content rules:
 *   * Never expose internal ids (notification id, conversation id, message id,
 *     team/player/profile ids, or database identifiers).
 *   * Only public-safe presentation copy is rendered (team name, opportunity
 *     title/role, player name).
 *   * Missing optional data is handled gracefully — the copy adapts and never
 *     renders "undefined".
 *
 * The CTA link is the app's own conversation route (`/messages/<id>`), which
 * the caller has already resolved into an absolute URL. The id appears only
 * inside the href the recipient clicks, never as visible text.
 */

import { buildFomEmailShell, escapeHtml } from "@/lib/email/templates/fom-email-shell";
import type { TransactionalEmail } from "@/lib/email/types";
import type { OutreachNotificationData } from "@/lib/notification-data";

export interface OutreachMessageEmailInput {
  to: string;
  /** Absolute conversation URL, or null when it could not be resolved. */
  conversationUrl: string | null;
  data: OutreachNotificationData;
}

/** Subject line shown in the recipient's inbox. */
export function buildOutreachEmailSubject(
  data: OutreachNotificationData,
): string {
  const team = data.teamName?.trim();
  return team
    ? `${team} contacted you on FOM Sports`
    : "A team contacted you on FOM Sports";
}

/** Human-readable "Team — Opportunity" context line, degrading gracefully. */
function buildContextLine(data: OutreachNotificationData): string | null {
  const team = data.teamName?.trim() || null;
  const title = data.opportunityTitle?.trim() || null;
  const role = data.opportunityRole?.trim() || null;

  const opportunity = title && role ? `${title} (${role})` : title ?? role;
  if (team && opportunity) return `${team} — ${opportunity}`;
  return team ?? opportunity;
}

/**
 * Build the specialized outreach email. Returns a complete `TransactionalEmail`
 * ready to hand to the EMAIL-001 send service.
 */
export function buildOutreachMessageEmail(
  input: OutreachMessageEmailInput,
): TransactionalEmail {
  const { to, conversationUrl, data } = input;

  const greetingName = data.playerName?.trim();
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi there,";
  const team = data.teamName?.trim() || "A team";
  const title = data.opportunityTitle?.trim() || null;
  const contextLine = buildContextLine(data);

  const opportunitySentence = title
    ? `${escapeHtml(team)} has contacted you about the <strong>${escapeHtml(
        title,
      )}</strong> opportunity and sent you a message.`
    : `${escapeHtml(
        team,
      )} has contacted you about an opportunity and sent you a message.`;

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 12px 0;">${opportunitySentence}</p>
    <p style="margin:0 0 12px 0;">You have a new message waiting for you. Open the conversation to read it and reply.</p>`;

  const bodyTextLines = [
    greeting,
    "",
    title
      ? `${team} has contacted you about the "${title}" opportunity and sent you a message.`
      : `${team} has contacted you about an opportunity and sent you a message.`,
    "",
    "You have a new message waiting for you. Open the conversation to read it and reply.",
  ];

  const { html, text } = buildFomEmailShell({
    title: "A team contacted you",
    bodyHtml,
    bodyText: bodyTextLines.join("\n"),
    preheader: contextLine ?? undefined,
    cta: conversationUrl
      ? { label: "View Conversation", href: conversationUrl }
      : undefined,
  });

  return {
    to: { email: to },
    subject: buildOutreachEmailSubject(data),
    html,
    text,
  };
}