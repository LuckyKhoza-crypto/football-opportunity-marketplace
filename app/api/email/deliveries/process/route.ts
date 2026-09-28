import { NextResponse } from "next/server";
import { processEmailDeliveries } from "@/lib/email/notification-delivery";

/**
 * EMAIL-002 — Email delivery processor entry point.
 *
 * This route drains the durable email notification outbox by invoking
 * `processEmailDeliveries()`. Claiming is atomic in PostgreSQL, so overlapping
 * invocations cannot send the same email twice.
 *
 * SECURITY
 * --------
 * This is a server-only background endpoint. It is NOT user-facing:
 *  - It requires a shared secret in the `Authorization: Bearer <secret>` header
 *    (or `x-email-delivery-secret`), read from `EMAIL_DELIVERY_SECRET`.
 *  - When the secret is not configured, the route fails CLOSED with a 404 and
 *    never processes anything.
 *  - It exposes no email content, recipient address, or provider state — only
 *    aggregate counts.
 *
 * INVOCATION (manual / scheduled)
 * -------------------------------
 * There is no third-party scheduler in this project. Invoke this endpoint from
 * a trusted scheduler (e.g. Vercel Cron, a GitHub Action, or an ops cron job):
 *
 *   curl -X POST https://<host>/api/email/deliveries/process \
 *     -H "Authorization: Bearer $EMAIL_DELIVERY_SECRET"
 *
 * A scheduler should call it frequently (e.g. every 1–5 minutes). The endpoint
 * is idempotent with respect to claiming: unclaimed rows simply remain pending.
 */

function getSecret(): string {
  return process.env.EMAIL_DELIVERY_SECRET?.trim() ?? "";
}

/** Constant-time-ish comparison of the presented secret. */
function isAuthorized(request: Request): boolean {
  const expected = getSecret();
  if (expected.length === 0) return false;

  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const headerSecret = request.headers.get("x-email-delivery-secret")?.trim() ?? "";
  const presented = bearer || headerSecret;

  if (presented.length !== expected.length) return false;

  // Avoid early-exit timing differences.
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return mismatch === 0;
}

async function handle(request: Request) {
  // Fail closed when unconfigured or unauthorized — indistinguishable 404 so the
  // endpoint does not advertise its existence or its configuration state.
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await processEmailDeliveries();
    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (err) {
    // Never surface internal error details (which could include provider state).
    console.error("[email] delivery processor invocation failed:", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Email delivery processing failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handle(request);
}

// Allow a GET trigger for simple schedulers, with the same secret check.
export async function GET(request: Request) {
  return handle(request);
}