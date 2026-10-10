import "server-only";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  banCompetitionParticipant,
  removeCompetitionParticipant,
} from "@/lib/competition-participant-admin-server";

/**
 * T-REM-3 — Host/ambassador participant removal + ban route handlers.
 *
 * The App Router route files under
 * `app/api/competitions/[id]/participants/[participantId]` are thin wrappers
 * around these handlers (same convention as lib/competition-api.ts,
 * lib/competition-join-api.ts and lib/competition-attempt-api.ts).
 *
 * Every handler:
 *   1. authenticates (NextAuth session) — the acting profile id is taken from
 *      the session, NEVER from the request body,
 *   2. validates the route ids,
 *   3. delegates to the authorized server helper (which re-checks
 *      creator-or-ambassador and runs the atomic RPC),
 *   4. maps the discriminated result to an HTTP status.
 *
 * Removal and banning are two SEPARATE endpoints so their very different
 * meanings (temporary vs permanent) can never be confused by a single call.
 */

async function requireProfileId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

// ── DELETE /api/competitions/[id]/participants/[participantId] ─
// REMOVE (R): soft-removes an eligible participant. Does NOT ban them — they
// may register again later, subject to the competition's registration rules.
export async function removeParticipantHandler(
  _request: Request,
  eventId: string,
  participantId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const result = await removeCompetitionParticipant(
      eventId,
      profileId,
      participantId,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({
      success: true,
      participantId: result.data.participantId,
      removedAt: result.data.removedAt,
      banned: false,
    });
  } catch (err) {
    console.error("Participant remove error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── POST /api/competitions/[id]/participants/[participantId]/ban ─
// BAN (B): records a durable competition-specific ban and, when the player is
// still actively registered, removes them using the same lifecycle checks.
export async function banParticipantHandler(
  request: Request,
  eventId: string,
  participantId: string,
): Promise<NextResponse> {
  try {
    const profileId = await requireProfileId();
    if (!profileId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    // An optional free-form reason. The participant is ALWAYS taken from the
    // route and the actor from the session — never from the body.
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const reason = typeof body.reason === "string" ? body.reason : null;

    const result = await banCompetitionParticipant(
      eventId,
      profileId,
      participantId,
      reason,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({
      success: true,
      participantId: result.data.participantId,
      banned: true,
      alreadyBanned: result.data.alreadyBanned,
      removed: result.data.removed,
      removedAt: result.data.removedAt,
      bannedAt: result.data.bannedAt,
    });
  } catch (err) {
    console.error("Participant ban error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
