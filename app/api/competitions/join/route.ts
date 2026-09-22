import { joinCompetitionHandler } from "@/lib/competition-join-api";

/**
 * COMP-003 — POST /api/competitions/join.
 *
 * Participant-facing registration for the competition identified by the join
 * token in the body. Identity is resolved from the NextAuth session server-side;
 * the event/ambassador are derived from the token. Unauthenticated calls are
 * rejected by the protected handler.
 */
export async function POST(request: Request) {
  return joinCompetitionHandler(request);
}