import { processAnnouncementHandler } from "@/lib/email-announcements-api";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — POST
 * /api/admin/email-announcements/[batchId]/process.
 *
 * Continues (or safely retries) a batch by sending its REMAINING pending
 * recipients, at most a small bounded number per request, one message each.
 * Messages the provider already accepted and recipients that permanently failed
 * are never re-sent. Administrator only.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await params;
  return processAnnouncementHandler(request, batchId);
}
