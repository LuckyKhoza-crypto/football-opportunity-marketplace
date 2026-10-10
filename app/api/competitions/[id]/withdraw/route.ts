import { withdrawFromCompetitionHandler } from "@/lib/competition-join-api";

/**
 * T-REM-2 — POST /api/competitions/[id]/withdraw.
 *
 * Player self-unregistration. The request body is ignored: the event comes from
 * the route and the player from the authenticated session, so a caller can never
 * unregister someone else. All eligibility rules are enforced server-side in
 * `withdrawFromCompetition` — a checked-in / attempting / provider-synced
 * registration (or a non-active event) is rejected with `409`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withdrawFromCompetitionHandler(request, id);
}
