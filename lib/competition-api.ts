import "server-only";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isValidChallengeConfig } from "@/lib/competition";
import {
  addCompetitionAmbassador,
  changeCompetitionEventStatus,
  getCompetitionAmbassadorsWithProfiles,
  getCompetitionEvent,
  getCompetitionStatistics,
  getCompetitionViewerRole,
  isEventManager,
  removeCompetitionAmbassador,
  updateCompetitionEvent,
  type UpdateCompetitionEventInput,
} from "@/lib/competition-server";
import type { CompetitionEventStatus } from "@/types";

/**
 * COMP-002 — Competition event route handlers.
 *
 * The App Router route files under app/api/competitions/** are thin wrappers
 * around these handlers. Keeping the logic here (in a non-dynamic module) has
 * two benefits:
 *
 *  1. The authorization/validation logic is unit-testable without importing a
 *     route file whose folder name contains square brackets.
 *  2. Every mutation resolves the caller identity from the NextAuth session
 *     server-side — `created_by`, `profile_id`, role and manager status are
 *     never trusted from the browser.
 */

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── GET /api/competitions/[id] ─────────────────────────────────
export async function getCompetitionEventHandler(
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

    const role = await getCompetitionViewerRole(eventId, session.user.id);
    if (!role) {
      return NextResponse.json(
        { error: "Event not found or access denied" },
        { status: 404 },
      );
    }

    const event = await getCompetitionEvent(eventId);
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const statistics = await getCompetitionStatistics(eventId);

    return NextResponse.json({ event, role, statistics });
  } catch (err) {
    console.error("Competition detail error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── PATCH /api/competitions/[id] ───────────────────────────────
export async function patchCompetitionEventHandler(
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

    const body = (await request.json()) as Record<string, unknown>;

    // Lifecycle transition (validated server-side).
    if (typeof body.status === "string") {
      const result = await changeCompetitionEventStatus(
        eventId,
        session.user.id,
        body.status as CompetitionEventStatus,
      );

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status },
        );
      }

      return NextResponse.json({ event: result.data });
    }

    // Configuration update.
    const input: UpdateCompetitionEventInput = {};

    if (body.name !== undefined) {
      const name = normalizeOptionalString(body.name);
      if (!name) {
        return NextResponse.json(
          { error: "Event name is required" },
          { status: 400 },
        );
      }
      input.name = name;
    }
    if (body.description !== undefined) {
      input.description = normalizeOptionalString(body.description);
    }
    if (body.location !== undefined) {
      input.location = normalizeOptionalString(body.location);
    }
    if (body.event_date !== undefined) {
      input.event_date = normalizeOptionalString(body.event_date);
    }
    if (body.challenge_name !== undefined) {
      const challengeName = normalizeOptionalString(body.challenge_name);
      if (!challengeName) {
        return NextResponse.json(
          { error: "Challenge name is required" },
          { status: 400 },
        );
      }
      input.challenge_name = challengeName;
    }

    const hasThreshold = body.challenge_threshold !== undefined;
    const hasAttempts = body.max_attempts !== undefined;

    if (hasThreshold || hasAttempts) {
      const challengeThreshold = hasThreshold
        ? Number(body.challenge_threshold)
        : undefined;
      const maxAttempts = hasAttempts ? Number(body.max_attempts) : undefined;

      if (
        (challengeThreshold !== undefined &&
          (!Number.isInteger(challengeThreshold) || challengeThreshold <= 0)) ||
        (maxAttempts !== undefined &&
          (!Number.isInteger(maxAttempts) || maxAttempts <= 0))
      ) {
        return NextResponse.json(
          { error: "Threshold and max attempts must be positive integers" },
          { status: 400 },
        );
      }

      if (challengeThreshold !== undefined) {
        input.challenge_threshold = challengeThreshold;
      }
      if (maxAttempts !== undefined) {
        input.max_attempts = maxAttempts;
      }
    }

    // Validate the merged challenge config if any challenge field changed.
    if (
      input.challenge_name !== undefined ||
      input.challenge_threshold !== undefined ||
      input.max_attempts !== undefined
    ) {
      const current = await getCompetitionEvent(eventId);
      if (!current) {
        return NextResponse.json(
          { error: "Event not found" },
          { status: 404 },
        );
      }

      if (
        !isValidChallengeConfig({
          challenge_name: input.challenge_name ?? current.challenge_name,
          challenge_threshold:
            input.challenge_threshold ?? current.challenge_threshold,
          max_attempts: input.max_attempts ?? current.max_attempts,
        })
      ) {
        return NextResponse.json(
          { error: "Invalid challenge configuration" },
          { status: 400 },
        );
      }
    }

    const result = await updateCompetitionEvent(
      eventId,
      session.user.id,
      input,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ event: result.data });
  } catch (err) {
    console.error("Competition update error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── GET /api/competitions/[id]/ambassadors ─────────────────────
export async function listAmbassadorsHandler(
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
        { error: "Not authorized to view ambassadors" },
        { status: 403 },
      );
    }

    const ambassadors = await getCompetitionAmbassadorsWithProfiles(eventId);
    return NextResponse.json({ ambassadors });
  } catch (err) {
    console.error("Ambassador list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── POST /api/competitions/[id]/ambassadors ────────────────────
export async function addAmbassadorHandler(
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
    const identifier = typeof body.email === "string" ? body.email : "";

    const result = await addCompetitionAmbassador(
      eventId,
      session.user.id,
      identifier,
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        ambassador: result.data.ambassador,
        profile: result.data.profile,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Ambassador add error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── DELETE /api/competitions/[id]/ambassadors/[profileId] ──────
export async function removeAmbassadorHandler(
  _request: Request,
  eventId: string,
  ambassadorProfileId: string,
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const result = await removeCompetitionAmbassador(
      eventId,
      session.user.id,
      ambassadorProfileId,
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Ambassador remove error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}