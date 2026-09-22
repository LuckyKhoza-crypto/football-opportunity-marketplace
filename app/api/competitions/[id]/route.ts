import { getCompetitionEventHandler, patchCompetitionEventHandler } from "@/lib/competition-api";

/**
 * COMP-002 — GET/PATCH /api/competitions/[id].
 *
 * Thin wrappers around the tested handlers in lib/competition-api.ts. GET is
 * available to the creator or an authorized ambassador; PATCH (configuration
 * update and controlled lifecycle transition) is creator-only. Authorization
 * and identity are always resolved server-side.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return getCompetitionEventHandler(request, id);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return patchCompetitionEventHandler(request, id);
}