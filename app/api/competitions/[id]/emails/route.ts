import {
  getBulkEmailPanelHandler,
  sendBulkEmailHandler,
} from "@/lib/competition-bulk-email-api";

/**
 * T-BULK-1 — /api/competitions/[id]/emails.
 *
 * GET  returns the CURRENT audience summary (recipient count — never addresses)
 *      and the recent send batches for the event. Creator or assigned
 *      ambassador only.
 * POST queues a send of one individual message per active registered
 *      participant. The body carries only `subject`, `message` and the
 *      idempotency `requestId`; the audience is re-resolved server-side from
 *      the competition, and the actor is taken from the session. A repeat of the
 *      same `requestId` returns the existing batch instead of sending again.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return getBulkEmailPanelHandler(request, id);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return sendBulkEmailHandler(request, id);
}
