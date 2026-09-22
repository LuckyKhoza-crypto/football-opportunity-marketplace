import "server-only";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isEventManager } from "@/lib/competition-server";
import {
  createCompetitionJoinLink,
  getCompetitionJoinLinks,
  registerForCompetition,
  revokeCompetitionJoinLink,
} from "@/lib/competition-join-server";
import { buildCompetitionJoinUrl } from "@/lib/competition-join";

/**
 * COMP-003 — Competition join-link route handlers.
 *
 * The App Router route files under app/api/competitions/** are thin wrappers
 * around these handlers (same convention as lib/competition-api.ts). Keeping
 * the logic here makes the authorization/validation unit-testable and ensures
 * every mutation resolves caller identity and target ids server-side.
 */

/**
 * POST /api/competitions/join
 *
 * Participant-facing registration. The body carries ONLY the opaque join token;
 * the event, ambassador and profile are all derived server-side (token +
 * NextAuth session). Unauthenticated calls are rejected here — the protected
 * mutation is the authoritative gate, not the page.
 */
export async function joinCompetitionHandler(
  request: Request,
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const token = typeof body.token === "string" ? body.token.trim() : "";

    if (!token) {
      return NextResponse.json(
        { error: "A competition join token is required" },
        { status: 400 },
      );
    }

    const result = await registerForCompetition(token, session.user.id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        participantId: result.data.participantId,
        eventId: result.data.eventId,
        status: result.data.status,
        alreadyRegistered: result.data.alreadyRegistered,
      },
      { status: result.data.alreadyRegistered ? 200 : 201 },
    );
  } catch (err) {
    console.error("Competition join error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/competitions/[id]/join-links
 *
 * List an event's join links (creator-only). The raw token can never be shown
 * here — only its digest was ever persisted.
 */
export async function listJoinLinksHandler(
  _request: Request,
  eventId: string,
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    if (!(await isEventManager(eventId, session.user.id))) {
      return NextResponse.json(
        { error: "Not authorized to view join links" },
        { status: 403 },
      );
    }

    const links = await getCompetitionJoinLinks(eventId);
    return NextResponse.json({ links });
  } catch (err) {
    console.error("Join link list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/competitions/[id]/join-links
 *
 * Create a reusable join link for one of the event's ambassadors
 * (creator-only). Returns the raw token + absolute join URL exactly once.
 */
export async function createJoinLinkHandler(
  request: Request,
  eventId: string,
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const ambassadorId =
      typeof body.ambassadorId === "string" ? body.ambassadorId.trim() : "";

    if (!ambassadorId) {
      return NextResponse.json(
        { error: "An ambassador is required" },
        { status: 400 },
      );
    }

    const result = await createCompetitionJoinLink(
      eventId,
      session.user.id,
      ambassadorId,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    // Build the absolute URL from the request origin (never a client value).
    const origin = new URL(request.url).origin;
    const joinUrl = buildCompetitionJoinUrl(origin, result.data.token);

    return NextResponse.json(
      {
        link: result.data.link,
        token: result.data.token,
        joinUrl,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Join link create error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/competitions/[id]/join-links/[linkId]
 *
 * Revoke a join link (creator-only).
 */
export async function revokeJoinLinkHandler(
  _request: Request,
  eventId: string,
  linkId: string,
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const result = await revokeCompetitionJoinLink(
      eventId,
      session.user.id,
      linkId,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Join link revoke error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}