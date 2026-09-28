import { finalizeTournamentHandler } from "@/lib/tournament-api";

/**
 * TOURN-003 — POST /api/competitions/[id]/tournament/finalize.
 *
 * Explicitly finalizes the linked tournament and returns the champion. This is a
 * deliberate second step after the last result: the provider's engine can keep a
 * fully-played tournament awaiting review until it is finalized.
 *
 * The body is ignored — the server knows which tournament belongs to the
 * competition, and whether it may be finalized is the provider's verdict (a
 * refusal is reported honestly, never guessed at). The champion comes from the
 * provider and is resolved to a `competition_participants.id`; provider ids are
 * never returned.
 *
 * Creator or assigned ambassador only, enforced server-side.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return finalizeTournamentHandler(request, id);
}
