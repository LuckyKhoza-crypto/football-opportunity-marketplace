import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isValidChallengeConfig } from "@/lib/competition";
import {
  createCompetitionEvent,
  isCompetitionCreationAdmin,
  listAmbassadorCompetitionEvents,
  listManagedCompetitionEvents,
  type CreateCompetitionEventInput,
} from "@/lib/competition-server";

/**
 * COMP-002 — Competition events collection endpoint.
 *
 * GET  → list the competitions the authenticated profile manages
 *        (competition_events.created_by) plus the events they are an
 *        ambassador for.
 * POST → create a new competition event.
 *
 * Authorization is always resolved server-side from the NextAuth session.
 * A client can never supply `created_by`; the authoritative owner is the
 * authenticated profile id.
 */

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// List managed + ambassador competitions for the authenticated user.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const [managed, ambassador] = await Promise.all([
      listManagedCompetitionEvents(session.user.id),
      listAmbassadorCompetitionEvents(session.user.id),
    ]);

    return NextResponse.json({ managed, ambassador });
  } catch (err) {
    console.error("Competitions list error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Create a new competition event.
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    // COMP-007: creating a competition is a temporary admin-only capability.
    // Enforced server-side here AND again inside createCompetitionEvent (the
    // authoritative check), so a direct API request from an ambassador or a
    // normal player is rejected even if the UI hid the button. Fails closed
    // when MULTI_TEAM_ADMIN_USER_ID is missing.
    if (!isCompetitionCreationAdmin(session.user.id)) {
      return NextResponse.json(
        { error: "Not authorized to create competitions" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;

    const name = normalizeOptionalString(body.name);
    const challengeName = normalizeOptionalString(body.challenge_name);
    const challengeThreshold = Number(body.challenge_threshold);
    const maxAttempts = Number(body.max_attempts);

    if (!name) {
      return NextResponse.json(
        { error: "Event name is required" },
        { status: 400 },
      );
    }

    if (
      !isValidChallengeConfig({
        challenge_name: challengeName,
        challenge_threshold: challengeThreshold,
        max_attempts: maxAttempts,
      })
    ) {
      return NextResponse.json(
        {
          error:
            "Challenge name and positive threshold/attempt values are required",
        },
        { status: 400 },
      );
    }

    const input: CreateCompetitionEventInput = {
      name,
      description: normalizeOptionalString(body.description),
      location: normalizeOptionalString(body.location),
      event_date: normalizeOptionalString(body.event_date),
      challenge_name: challengeName as string,
      challenge_threshold: challengeThreshold,
      max_attempts: maxAttempts,
    };

    // created_by is resolved server-side from the session — never the client.
    const event = await createCompetitionEvent(input, session.user.id);

    if (!event) {
      return NextResponse.json(
        { error: "Failed to create competition" },
        { status: 500 },
      );
    }

    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    console.error("Competition creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}