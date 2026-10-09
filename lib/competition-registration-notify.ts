/**
 * COMP-EMAIL-001 — Competition registration confirmation email (server-only).
 *
 * Triggered once per registration from the participant pass-token mint — i.e.
 * from the registration success screen, using the EXACT verification URL that
 * screen displays. The QR image emailed and the QR shown on screen therefore
 * encode the identical payload.
 *
 * Design (Option A — see README "COMP-EMAIL-001"):
 *   * The verification token is minted exactly ONCE, by the existing
 *     pass-token flow. This module never mints and never overwrites it.
 *   * The email is built in memory from the exact pass URL and handed to the
 *     existing EMAIL-001 Brevo service. The raw token / QR payload / rendered
 *     email are NEVER persisted (not in `notifications.data`, not in any
 *     column, not in logs).
 *   * Duplicate emails are prevented by reusing the existing notification dedup
 *     convention: a `competition_registration_confirmed` notification keyed by
 *     `source_id = competition_participants.id` (partial unique index,
 *     migration 0025). The FIRST mint wins; later mints are deduplicated.
 *   * Because the payload is not persisted, this path is BEST-EFFORT: it does
 *     NOT get durable outbox retries. Deduplication prevents duplicates; it
 *     does NOT guarantee successful delivery. Email failure never fails
 *     registration.
 */

import "server-only";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createNotification } from "@/lib/notifications";
import { getCompetitionPass } from "@/lib/competition-join-server";
import {
  isValidRecipientEmail,
  sendTransactionalEmail,
} from "@/lib/email/email-service";
import { buildCompetitionVerifyQrImageUrlFromVerifyUrl } from "@/lib/competition-join";
import { buildCompetitionRegistrationEmail } from "@/lib/email/templates/competition-registration";
import { sanitizeDeliveryError } from "@/lib/email/notification-delivery";
import type { TransactionalEmail } from "@/lib/email/types";

/** The notification type used purely as a dedup gate + in-app record. */
export const COMPETITION_REGISTRATION_NOTIFICATION_TYPE =
  "competition_registration_confirmed" as const;

export interface CompetitionRegistrationConfirmationInput {
  eventId: string;
  profileId: string;
  /**
   * The EXACT verification URL shown on the participant pass (the QR payload).
   * Must be the same string the pass screen encoded.
   */
  verifyUrl: string;
}

export interface CompetitionRegistrationConfirmationDeps {
  /** Injectable sender (defaults to the EMAIL-001 Brevo service). */
  sender?: (email: TransactionalEmail) => Promise<{ messageId: string }>;
}

export interface CompetitionRegistrationConfirmationResult {
  sent: boolean;
  /** True when a confirmation already existed for this registration. */
  deduplicated: boolean;
}

interface EventRow {
  name: string | null;
  description: string | null;
  location: string | null;
  event_date: string | null;
  challenge_name: string | null;
}

interface ProfileRow {
  email: string | null;
  full_name: string | null;
}

/**
 * Build and send the confirmation email for a freshly registered participant.
 *
 * Best-effort and self-contained: it never throws into the caller. It returns
 * the outcome so tests can assert on it, but callers should not depend on it.
 */
export async function sendCompetitionRegistrationConfirmation(
  input: CompetitionRegistrationConfirmationInput,
  deps: CompetitionRegistrationConfirmationDeps = {},
): Promise<CompetitionRegistrationConfirmationResult> {
  const { eventId, profileId, verifyUrl } = input;
  const missed = { sent: false, deduplicated: false };

  if (!eventId || !profileId || !verifyUrl?.trim()) return missed;

  try {
    // The participant must already exist (registration has committed).
    const pass = await getCompetitionPass(eventId, profileId);
    if (!pass) return missed;

    // Dedup gate: at most one confirmation per registration. The FIRST mint
    // inserts; later mints return { deduplicated: true } and send nothing.
    const notification = await createNotification({
      userId: profileId,
      type: COMPETITION_REGISTRATION_NOTIFICATION_TYPE,
      title: "You're registered",
      body: "Your competition registration is confirmed.",
      // competition_participants.id — the notification dedup key.
      sourceId: pass.participantId,
    });

    if (notification.deduplicated) {
      return { sent: false, deduplicated: true };
    }
    if (notification.error || !notification.data) {
      // Notification infra unavailable — stay best-effort, do not email.
      return missed;
    }

    const [eventResult, profileResult] = await Promise.all([
      supabaseAdmin
        .from("competition_events")
        .select("name, description, location, event_date, challenge_name")
        .eq("id", eventId)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("email, full_name")
        .eq("id", profileId)
        .maybeSingle(),
    ]);

    const event = (eventResult.data as EventRow | null) ?? null;
    const profile = (profileResult.data as ProfileRow | null) ?? null;
    const to = profile?.email?.trim() ?? "";
    if (!to || !isValidRecipientEmail(to)) return missed;

    const sender =
      deps.sender ??
      (async (email: TransactionalEmail) => {
        const result = await sendTransactionalEmail(email);
        return { messageId: result.messageId };
      });

    // Derive the hosted QR image URL from the EXACT pass payload. The image
    // route re-renders the QR from the same opaque token, so the emailed QR and
    // the on-screen pass QR encode an identical payload. No token is minted here.
    const qrImageUrl = buildCompetitionVerifyQrImageUrlFromVerifyUrl(verifyUrl);

    const email = buildCompetitionRegistrationEmail({
      to,
      competitionName: event?.name ?? "your competition",
      eventDate: event?.event_date ?? null,
      location: event?.location ?? null,
      description: event?.description ?? null,
      challengeName: event?.challenge_name ?? null,
      verificationCode: pass.verificationCode,
      qrImageUrl,
      participantName: profile?.full_name ?? null,
    });

    await sender(email);
    return { sent: true, deduplicated: false };
  } catch (err) {
    // Never surface the token / verification code / raw provider body.
    console.error(
      "[email] competition registration confirmation failed:",
      sanitizeDeliveryError(err),
    );
    return missed;
  }
}

/**
 * Schedule the confirmation email AFTER the pass-token response is sent, so the
 * participant's pass is never blocked on Brevo latency. Best-effort only — any
 * failure is logged safely and can never fail the pass-token request.
 */
export function scheduleCompetitionRegistrationConfirmation(
  input: CompetitionRegistrationConfirmationInput,
  deps: CompetitionRegistrationConfirmationDeps = {},
): void {
  const run = () =>
    sendCompetitionRegistrationConfirmation(input, deps).then(
      () => undefined,
      (err) => {
        console.error(
          "[email] competition registration confirmation task failed:",
          sanitizeDeliveryError(err),
        );
      },
    );

  try {
    // `after()` must be called within a request scope; when unavailable
    // (non-request contexts) this is a harmless no-op.
    after(run);
  } catch {
    // No request scope — best-effort only. Never break the caller.
  }
}
