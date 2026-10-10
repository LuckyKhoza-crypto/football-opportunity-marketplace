import { removeParticipantHandler } from "@/lib/competition-participant-admin-api";

/**
 * T-REM-3 — DELETE /api/competitions/[id]/participants/[participantId].
 *
 * REMOVE (R): an authorized event creator or assigned ambassador removes an
 * eligible participant. This is a SOFT removal (the participant row and all
 * history are preserved) and does NOT ban the player — they may register again
 * later, subject to the competition's registration rules.
 *
 * The acting profile is taken from the authenticated session and the participant
 * from the route; authorization, event/participant ownership, the lifecycle and
 * provider-safety checks are all enforced server-side.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; participantId: string }> },
) {
  const { id, participantId } = await params;
  return removeParticipantHandler(request, id, participantId);
}
