import "server-only";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getCompetitionBulkEmailAudience,
  getCompetitionBulkEmailBatch,
  listCompetitionBulkEmailBatches,
  previewCompetitionBulkEmail,
  processCompetitionBulkEmailBatch,
  sendCompetitionBulkEmail,
} from "@/lib/competition-bulk-email-server";

/**
 * T-BULK-1 — "Email Participants" route handlers.
 *
 * The App Router route files under `app/api/competitions/[id]/emails/**` are thin
 * wrappers around these handlers (the same convention as
 * `lib/competition-api.ts`, `lib/competition-attempt-api.ts` and
 * `lib/competition-drawing-api.ts`). Every handler:
 *
 *   1. authenticates (NextAuth session) — the acting profile id comes from the
 *      SESSION, never from the request body,
 *   2. validates the request body,
 *   3. calls the authorized server helper (which re-checks creator-or-ambassador
 *      and resolves the audience from the database),
 *   4. maps the discriminated result to an HTTP status,
 *   5. returns minimal JSON — COUNTS and the recipient's own preview only.
 *
 * The browser can never supply a recipient list, a recipient count, an address,
 * or another profile's identity.
 */

async function requireProfileId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

/** ── GET /api/competitions/[id]/emails ──────────────────────────────────────
 * The audience summary (recipient count) + the recent batches of this event.
 * This is the panel's initial load: it drives the "intended recipient count"
 * and the previous-send status summaries. */
export async function getBulkEmailPanelHandler(
  _request: Request,
  eventId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const [audience, batches] = await Promise.all([
      getCompetitionBulkEmailAudience(eventId, profileId),
      listCompetitionBulkEmailBatches(eventId, profileId),
    ]);

    if (!audience.ok) {
      return NextResponse.json(
        { error: audience.error },
        { status: audience.status },
      );
    }
    if (!batches.ok) {
      return NextResponse.json(
        { error: batches.error },
        { status: batches.status },
      );
    }

    return NextResponse.json({
      audience: audience.data,
      batches: batches.data,
    });
  } catch (err) {
    console.error("Bulk email panel error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/** ── POST /api/competitions/[id]/emails/preview ─────────────────────────────
 * Server-rendered preview of exactly what one recipient will receive, plus the
 * CURRENT audience count. Sends nothing. */
export async function previewBulkEmailHandler(
  request: Request,
  eventId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const result = await previewCompetitionBulkEmail({
      eventId,
      actorProfileId: profileId,
      subject: body.subject,
      message: body.message,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ preview: result.data });
  } catch (err) {
    console.error("Bulk email preview error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/** ── POST /api/competitions/[id]/emails ─────────────────────────────────────
 * Queue the send (one message per recipient). The body carries ONLY the
 * subject, the message and the idempotency request id — the audience is
 * re-resolved server-side and the actor comes from the session. */
export async function sendBulkEmailHandler(
  request: Request,
  eventId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const result = await sendCompetitionBulkEmail({
      eventId,
      actorProfileId: profileId,
      subject: body.subject,
      message: body.message,
      requestId: body.requestId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ batch: result.data }, { status: 201 });
  } catch (err) {
    console.error("Bulk email send error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/** ── GET /api/competitions/[id]/emails/[batchId] ───────────────────────────
 * The recorded outcome summary of one batch (eligible / accepted / failed /
 * pending). Recipient addresses are never included. */
export async function getBulkEmailBatchHandler(
  _request: Request,
  eventId: string,
  batchId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const result = await getCompetitionBulkEmailBatch(
      eventId,
      batchId,
      profileId,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ batch: result.data });
  } catch (err) {
    console.error("Bulk email batch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/** ── POST /api/competitions/[id]/emails/[batchId]/process ──────────────────
 * Drain the batch's REMAINING pending recipients (bounded, one message each).
 * Already-accepted or permanently failed recipients are never re-sent, so this
 * is a safe way to continue/retry a partially failed batch. */
export async function processBulkEmailBatchHandler(
  _request: Request,
  eventId: string,
  batchId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const result = await processCompetitionBulkEmailBatch(
      eventId,
      batchId,
      profileId,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ batch: result.data });
  } catch (err) {
    console.error("Bulk email processing error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
