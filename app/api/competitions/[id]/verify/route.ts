import { verifyParticipantHandler } from "@/lib/competition-attempt-api";

/**
 * COMP-004 — POST /api/competitions/[id]/verify.
 *
 * Resolves a participant from an organizer-supplied verification code or opaque
 * QR token. The requesting profile must be the event creator; the credential is
 * resolved server-side and scoped to this event. No attempt is recorded by
 * verifying someone.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return verifyParticipantHandler(request, id);
}