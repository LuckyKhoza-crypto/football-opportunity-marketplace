import { previewBulkEmailHandler } from "@/lib/competition-bulk-email-api";

/**
 * T-BULK-1 — POST /api/competitions/[id]/emails/preview.
 *
 * Returns a server-rendered preview of the email exactly as the processor will
 * build it (same FOM Sports shell, same escaping) plus the current audience
 * count. Sends nothing and stores nothing. Creator or assigned ambassador only.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return previewBulkEmailHandler(request, id);
}
