import { banParticipantHandler } from "@/lib/competition-participant-admin-api";

/**
 * T-REM-3 — POST /api/competitions/[id]/participants/[participantId]/ban.
 *
 * BAN (B): an authorized event creator or assigned ambassador records a durable,
 * COMPETITION-SPECIFIC ban that prevents the player from registering for THIS
 * competition again (even via another valid join link). It is not a global
 * account ban.
 *
 * If the player is still actively registered, banning also removes them using
 * the same lifecycle/provider-safety checks as a removal; when that is unsafe
 * the whole request is refused with no partial result. The body carries only an
 * optional `reason` — identity and target come from the session and the route.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; participantId: string }> },
) {
  const { id, participantId } = await params;
  return banParticipantHandler(request, id, participantId);
}
