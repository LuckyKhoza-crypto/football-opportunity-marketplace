import "server-only";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getParticipantAttempts,
  listCompetitionParticipantsWithState,
  mintParticipantVerificationToken,
  recordCompetitionAttempt,
  verifyCompetitionParticipantByCode,
  verifyCompetitionParticipantByToken,
} from "@/lib/competition-attempt-server";

/**
 * COMP-004 — Participant verification & challenge-attempt route handlers.
 *
 * The App Router route files under app/api/competitions/** are thin wrappers
 * around these handlers (same convention as lib/competition-api.ts and
 * lib/competition-join-api.ts). Every handler:
 *
 *   1. authenticates (NextAuth session),
 *   2. validates the request body,
 *   3. calls the authorized server helper,
 *   4. maps the discriminated result to an HTTP status,
 *   5. returns minimal JSON.
 *
 * No business logic is duplicated here — it all lives in the *-server.ts
 * helpers. The browser can never submit event ownership, participant owner,
 * attempt number, `passed`, threshold or attempts remaining.
 *
 * Operational endpoints here authorize the event CREATOR or an assigned
 * AMBASSADOR (server-side `canManageEvent`). Identity is always resolved from
 * the authenticated session, never from the request body.
 */

async function requireProfileId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

// ── GET /api/competitions/[id]/participants ────────────────────
// Event participant list + derived challenge state (creator or ambassador).
export async function listParticipantsHandler(
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

    const participants = await listCompetitionParticipantsWithState(
      eventId,
      profileId,
    );

    // Distinguish "not authorized / not found" (empty because the helper
    // refused) from a genuinely empty event by returning the list; the page
    // also renders nothing for non-managers, and buttons are server-guarded.
    return NextResponse.json({ participants });
  } catch (err) {
    console.error("Participant list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── POST /api/competitions/[id]/verify ─────────────────────────
// Resolve a participant by verification code or opaque token (creator or ambassador).
export async function verifyParticipantHandler(
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

    const code = typeof body.code === "string" ? body.code : "";
    const token = typeof body.token === "string" ? body.token : "";

    if (!code && !token) {
      return NextResponse.json(
        { error: "A verification code is required" },
        { status: 400 },
      );
    }

    const result = code
      ? await verifyCompetitionParticipantByCode(eventId, profileId, code)
      : await verifyCompetitionParticipantByToken(profileId, token);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    // A token resolved to a DIFFERENT event than the URL's [id] is rejected so
    // a stale URL can never display the wrong event's participant.
    if (result.data.eventId !== eventId) {
      return NextResponse.json(
        { error: "That verification credential belongs to another event." },
        { status: 404 },
      );
    }

    return NextResponse.json({ participant: result.data });
  } catch (err) {
    console.error("Participant verify error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── GET /api/competitions/[id]/participants/[participantId]/attempts ──
export async function listAttemptsHandler(
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

    // Reuse the participant list helper (creator-or-ambassador) to gate access,
    // then return the attempts for the requested participant.
    const participants = await listCompetitionParticipantsWithState(
      eventId,
      profileId,
    );
    const participant = participants.find((p) => p.id === participantId);
    if (!participant) {
      return NextResponse.json(
        { error: "Participant not found for this event" },
        { status: 404 },
      );
    }

    const attempts = await getParticipantAttempts(eventId, participantId);
    return NextResponse.json({ attempts });
  } catch (err) {
    console.error("Attempt list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── POST /api/competitions/[id]/participants/[participantId]/attempts ──
// Record one attempt. The body carries ONLY result_value.
export async function recordAttemptHandler(
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

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const result = await recordCompetitionAttempt(
      eventId,
      profileId,
      participantId,
      body.result_value,
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        attempt: result.data.attempt,
        state: result.data.state,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Attempt record error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── POST /api/competitions/[id]/pass-token ─────────────────────
// Mint the authenticated participant's OWN opaque verification token (QR).
export async function mintPassTokenHandler(
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

    const result = await mintParticipantVerificationToken(eventId, profileId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ token: result.data.token });
  } catch (err) {
    console.error("Pass token mint error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}