import {
  createTournamentHandler,
  getTournamentSummaryHandler,
} from "@/lib/tournament-api";

/**
 * TOURN-002 — GET/POST /api/competitions/[id]/tournament.
 *
 * GET  returns the competition's tournament status (state, completeness, open
 *      match count, champion). A `409` with `code: "not_linked"` means the
 *      competition has no tournament yet — a state, not an error.
 * POST creates/links the external tournament. The request body is ignored:
 *      the provider, format, slug and name are resolved server-side.
 *
 * Both actions are creator-or-assigned-ambassador only, enforced server-side by
 * the tournament service (`canManageEvent`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return getTournamentSummaryHandler(request, id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return createTournamentHandler(request, id);
}
