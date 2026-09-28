import { getTournamentMatchesHandler } from "@/lib/tournament-api";

/**
 * TOURN-002 — GET /api/competitions/[id]/tournament/matches.
 *
 * Returns the READ-ONLY bracket: the tournament's neutral state, the mapped
 * participants and every match (round, both sides, score, state, winner).
 * Provider match ids, provider participant ids and raw provider score fields
 * are never returned — each side is resolved to `competition_participants.id`
 * plus a display name.
 *
 * Creator or assigned ambassador only, enforced server-side.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return getTournamentMatchesHandler(request, id);
}
