import { NextResponse } from "next/server";
import {
  EmailConfigError,
  EmailError,
  EmailProviderError,
  EmailProviderRequestError,
  EmailRecipientError,
  sendTransactionalEmail,
} from "@/lib/email";
import {
  buildCompetitionVerifyUrl,
  buildCompetitionVerifyQrImageUrlFromVerifyUrl,
} from "@/lib/competition-join";
import { buildCompetitionRegistrationEmail } from "@/lib/email/templates/competition-registration";

/**
 * COMP-EMAIL-001 — Development-only registration-email rendering smoke test.
 *
 * Sends the REAL competition-registration confirmation template (with the
 * HOSTED QR image) so the fix for "QR not displaying in Gmail" can be verified
 * end-to-end with an actual inbox.
 *
 * SECURITY
 * --------
 * This route exists ONLY to verify email rendering. It is NOT a production relay:
 *  - It fails CLOSED outside development (returns a plain `404`).
 *  - The subject/body are FIXED server-side (sample competition copy); a caller
 *    may only supply a recipient address and an optional recipient name.
 *  - The QR encodes a SAMPLE token that verifies no real participant.
 *  - It never returns or logs the Brevo API key.
 *
 * Usage (local dev only):
 *   GET  /api/debug/registration-email?to=you@example.com
 *   POST /api/debug/registration-email   { "to": "you@example.com", "name": "Optional" }
 *
 * IMPORTANT: Gmail fetches the hosted QR image through its own image proxy, so
 * the app must be reachable at a PUBLIC host (a deployed preview/production URL
 * or a tunnel). A `localhost` URL will not render the image in Gmail.
 */

const SAMPLE_TOKEN = "sample-registration-email-token";
const SAMPLE_CODE = "ABCD2345";

/** The route is only enabled outside a production build. */
function isEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Build the fixed sample confirmation email (subject/body are never caller-controlled). */
function buildSampleEmail(origin: string, to: string, name?: string) {
  const verifyUrl = buildCompetitionVerifyUrl(origin, SAMPLE_TOKEN);
  const qrImageUrl = buildCompetitionVerifyQrImageUrlFromVerifyUrl(verifyUrl);

  const email = buildCompetitionRegistrationEmail({
    to,
    competitionName: "Sample City Finals (email rendering test)",
    eventDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    location: "Sample Riverside Pitches",
    description: "This message verifies the hosted QR image renders in Gmail.",
    challengeName: "Sample Juggle Challenge",
    verificationCode: SAMPLE_CODE,
    qrImageUrl,
    participantName: name ?? null,
  });

  return { email, qrImageUrl };
}

async function handle(request: Request, to: string | null, name?: string) {
  if (!isEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const recipient = (to ?? process.env.EMAIL_TEST_RECIPIENT ?? "").trim();
  if (!recipient) {
    return NextResponse.json(
      {
        error:
          "A test recipient is required. Pass ?to=you@example.com (or set EMAIL_TEST_RECIPIENT).",
      },
      { status: 400 },
    );
  }

  try {
    const origin = new URL(request.url).origin;
    const { email, qrImageUrl } = buildSampleEmail(origin, recipient, name);
    const result = await sendTransactionalEmail(email);
    return NextResponse.json(
      {
        success: true,
        messageId: result.messageId,
        subject: email.subject,
        to: recipient,
        qrImageUrl,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof EmailConfigError) {
      return NextResponse.json(
        {
          error: "Email is not configured.",
          missing: error.missing,
          hint: "Set BREVO_API_KEY, BREVO_FROM_EMAIL and BREVO_FROM_NAME in .env.local.",
        },
        { status: 500 },
      );
    }
    if (error instanceof EmailRecipientError) {
      return NextResponse.json(
        { error: "Recipient email address is invalid." },
        { status: 400 },
      );
    }
    if (error instanceof EmailProviderError) {
      return NextResponse.json(
        {
          error: "Brevo rejected the email request.",
          providerStatus: error.status,
        },
        { status: 502 },
      );
    }
    if (error instanceof EmailProviderRequestError) {
      return NextResponse.json(
        { error: "Could not reach the Brevo API." },
        { status: 502 },
      );
    }
    if (error instanceof EmailError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.error("Registration email test failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return handle(
    request,
    searchParams.get("to"),
    searchParams.get("name") ?? undefined,
  );
}

export async function POST(request: Request) {
  if (!isEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { to?: unknown; name?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const to = typeof body.to === "string" ? body.to : null;
  const name = typeof body.name === "string" ? body.name : undefined;
  return handle(request, to, name);
}
