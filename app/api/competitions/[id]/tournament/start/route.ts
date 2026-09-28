import { startTournamentHandler } from "@/lib/tournament-api";

/**
 * TOURN-002 — POST /api/competitions/[id]/tournament/start.
 *
 * Starts the linked tournament, which makes the provider generate the bracket.
 * Idempotent for an already-started tournament (`started: false`); a completed
 * or unrecognised provider state is refused with `409`. No bracket state is
 * copied into Supabase — the provider stays the source of truth.
 *
 * Creator or assigned ambassador only, enforced server-side. The request body
 * is ignored: there is nothing the browser may decide about the bracket.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return startTournamentHandler(request, id);
}
