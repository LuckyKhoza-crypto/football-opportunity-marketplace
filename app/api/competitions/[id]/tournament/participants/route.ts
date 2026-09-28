import { syncTournamentParticipantsHandler } from "@/lib/tournament-api";

/**
 * TOURN-002 — POST /api/competitions/[id]/tournament/participants.
 *
 * Pushes the competition's registered participants that are not yet mapped onto
 * the external tournament and stores the returned provider ids (existing
 * TOURN-001 service). Idempotent: already-mapped participants are skipped.
 * Responds with counts only (how many were synced / already mapped) — never
 * provider participant ids.
 *
 * Creator or assigned ambassador only, enforced server-side. The request body
 * is ignored.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return syncTournamentParticipantsHandler(request, id);
}
