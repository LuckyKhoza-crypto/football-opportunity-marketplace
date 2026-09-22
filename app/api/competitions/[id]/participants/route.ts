import { listParticipantsHandler } from "@/lib/competition-attempt-api";

/**
 * COMP-004 — GET /api/competitions/[id]/participants.
 *
 * Lists the event's participants with derived challenge state for the event
 * creator's participant-management screen. Authorization is enforced
 * server-side in listCompetitionParticipantsWithState (creator only).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return listParticipantsHandler(request, id);
}