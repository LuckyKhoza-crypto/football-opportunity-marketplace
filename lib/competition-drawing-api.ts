import "server-only";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getCompetitionDrawing,
  startCompetitionDrawing,
} from "@/lib/competition-drawing-server";

/**
 * COMP-006 — Competition drawing route handlers.
 *
 * The App Router route files under app/api/competitions/** are thin wrappers
 * around these handlers (same convention as lib/competition-api.ts and
 * lib/competition-attempt-api.ts). Every handler:
 *
 *   1. authenticates (NextAuth session),
 *   2. calls the authorized server helper,
 *   3. maps the discriminated result to an HTTP status,
 *   4. returns minimal JSON.
 *
 * No business logic is duplicated here. The browser can never submit a winner,
 * a qualified participant id, or a count — the POST body is ignored entirely;
 * the winner is selected server-side inside the start_competition_drawing RPC.
 *
 * Authorization (creator OR assigned ambassador) is enforced server-side by the
 * shared `canManageEvent` rule, never from profiles.role.
 */

async function requireProfileId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

// ── POST /api/competitions/[id]/draw ───────────────────────────
// Start the drawing. The request body is deliberately ignored: the winner is
// chosen server-side and the qualified count is calculated server-side.
export async function startDrawingHandler(
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

    const result = await startCompetitionDrawing(eventId, profileId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ drawing: result.data }, { status: 201 });
  } catch (err) {
    console.error("Drawing start error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── GET /api/competitions/[id]/draw ────────────────────────────
// Return the drawing if one exists (creator or ambassador only).
export async function getDrawingHandler(
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

    const drawing = await getCompetitionDrawing(eventId, profileId);
    if (!drawing) {
      // Not authorized or no drawing yet — a single opaque 404 avoids leaking
      // the existence of private drawing data to unrelated users.
      return NextResponse.json(
        { error: "No drawing found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ drawing });
  } catch (err) {
    console.error("Drawing fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}