import { processBulkEmailBatchHandler } from "@/lib/competition-bulk-email-api";

/**
 * T-BULK-1 — POST /api/competitions/[id]/emails/[batchId]/process.
 *
 * Continues (or safely retries) a batch by sending its REMAINING pending
 * recipients, at most a small bounded number per request, one message each.
 * Messages the provider already accepted and recipients that permanently failed
 * are never re-sent. The batch must belong to the competition in the route.
 * Creator or assigned ambassador only.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; batchId: string }> },
) {
  const { id, batchId } = await params;
  return processBulkEmailBatchHandler(request, id, batchId);
}
