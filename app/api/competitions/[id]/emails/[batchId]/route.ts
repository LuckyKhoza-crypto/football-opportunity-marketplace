import { getBulkEmailBatchHandler } from "@/lib/competition-bulk-email-api";

/**
 * T-BULK-1 — GET /api/competitions/[id]/emails/[batchId].
 *
 * The recorded outcome summary of one batch: eligible recipients, how many the
 * provider ACCEPTED, how many permanently failed and how many remain pending.
 * The batch must belong to the competition in the route. Creator or assigned
 * ambassador only. Never returns recipient addresses.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; batchId: string }> },
) {
  const { id, batchId } = await params;
  return getBulkEmailBatchHandler(request, id, batchId);
}
