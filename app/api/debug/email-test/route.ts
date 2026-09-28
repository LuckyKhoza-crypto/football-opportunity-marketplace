import { NextResponse } from "next/server";
import {
  EmailConfigError,
  EmailError,
  EmailProviderError,
  EmailProviderRequestError,
  EmailRecipientError,
  buildFomEmailShell,
  sendTransactionalEmail,
} from "@/lib/email";

/**
 * Development-only transactional-email smoke test (EMAIL-001).
 *
 * SECURITY
 * --------
 * This route exists ONLY to prove the Brevo integration works. It is NOT a
 * production email relay:
 *  - It fails CLOSED outside development: in production (and any non-development
 *    deployment, including Vercel preview) it returns a plain `404`.
 *  - The subject and HTML/text body are FIXED server-side. A caller may only
 *    supply a recipient address — never arbitrary subject/HTML.
 *  - It never returns or logs the Brevo API key.
 *
 * Usage (local dev only):
 *   GET  /api/debug/email-test?to=you@example.com
 *   POST /api/debug/email-test   { "to": "you@example.com", "name": "Optional" }
 *
 * If `to` is omitted, the optional `EMAIL_TEST_RECIPIENT` env var is used.
 */

const TEST_SUBJECT = "FOM Sports email test";
const TEST_BODY = "Your FOM Sports Brevo integration is working.";

/** The route is only enabled outside a production build. */
function isEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Build the fixed test email (subject + body are never caller-controlled). */
function buildTestEmail(to: string, name?: string) {
  const { html, text } = buildFomEmailShell({
    title: TEST_SUBJECT,
    bodyHtml: `<p style="margin:0 0 12px 0;">${TEST_BODY}</p>`,
    bodyText: TEST_BODY,
  });

  return {
    to: name ? { email: to, name } : { email: to },
    subject: TEST_SUBJECT,
    html,
    text,
  };
}

function configMissingResponse(error: EmailConfigError) {
  return NextResponse.json(
    {
      error: "Email is not configured.",
      missing: error.missing,
      hint: "Set BREVO_API_KEY, BREVO_FROM_EMAIL and BREVO_FROM_NAME in .env.local.",
    },
    { status: 500 },
  );
}

async function handle(to: string | null, name?: string) {
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
    const result = await sendTransactionalEmail(
      buildTestEmail(recipient, name),
    );
    return NextResponse.json(
      {
        success: true,
        messageId: result.messageId,
        subject: TEST_SUBJECT,
        to: recipient,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof EmailConfigError) {
      return configMissingResponse(error);
    }
    if (error instanceof EmailRecipientError) {
      return NextResponse.json(
        { error: "Recipient email address is invalid." },
        { status: 400 },
      );
    }
    if (error instanceof EmailProviderError) {
      // Safe metadata only — never the provider's raw body or auth headers.
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
    console.error("Email test failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return handle(searchParams.get("to"), searchParams.get("name") ?? undefined);
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
  return handle(to, name);
}