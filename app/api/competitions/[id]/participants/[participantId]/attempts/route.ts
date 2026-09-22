import {
  listAttemptsHandler,
  recordAttemptHandler,
} from "@/lib/competition-attempt-api";

/**
 * COMP-004 — /api/competitions/[id]/participants/[participantId]/attempts.
 *
 * GET  lists a participant's attempts (creator only).
 * POST records ONE challenge attempt. The body carries ONLY `result_value`;
 *      attempt number, `passed`, ownership and limits are all resolved
 *      server-side. Duplicate/concurrent submissions are rejected.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; participantId: string }> },
) {
  const { id, participantId } = await params;
  return listAttemptsHandler(request, id, participantId);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; participantId: string }> },
) {
  const { id, participantId } = await params;
  return recordAttemptHandler(request, id, participantId);
}