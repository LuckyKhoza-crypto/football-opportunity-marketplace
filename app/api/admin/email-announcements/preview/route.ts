import { previewAnnouncementHandler } from "@/lib/email-announcements-api";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — POST /api/admin/email-announcements/preview.
 *
 * Returns a server-rendered preview of the email exactly as the delivery
 * processor will build it (same FOM Sports shell, same whitespace-preserving
 * renderer, same resolved registration link) plus the current audience count.
 * Sends nothing and stores nothing. Administrator only.
 */
export async function POST(request: Request) {
  return previewAnnouncementHandler(request);
}
