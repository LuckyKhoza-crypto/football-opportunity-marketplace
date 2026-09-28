import { reportMatchResultHandler } from "@/lib/tournament-api";

/**
 * TOURN-003 — POST /api/competitions/[id]/tournament/matches/[matchId]/result.
 *
 * Reports one match result. The body carries FOM-neutral data only:
 *
 *   { "winnerParticipantId": "<competition_participants.id>",
 *     "participant1Score": 2, "participant2Score": 1 }
 *
 * The `[matchId]` segment is FOM's own match reference (`r{round}:{id}:{id}`,
 * see `toMatchReference`) — never a provider match id. Provider participant ids,
 * provider match ids and provider score fields are not accepted: the service
 * resolves FOM's ids to the provider's inside the integration boundary.
 *
 * ADVANCEMENT IS THE PROVIDER'S JOB. FOM submits what happened and the response
 * is the provider-neutral match; the bracket is re-read with
 * GET .../tournament/matches so the advanced round becomes visible.
 *
 * Creator or assigned ambassador only, enforced server-side.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; matchId: string }> },
) {
  const { id, matchId } = await params;
  return reportMatchResultHandler(request, id, matchId);
}
