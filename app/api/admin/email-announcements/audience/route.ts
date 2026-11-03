import { resolveAnnouncementAudienceHandler } from "@/lib/email-announcements-api";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — POST /api/admin/email-announcements/audience.
 *
 * Returns the recipient count for the selected audience AFTER exclusions (users
 * already registered for the promoted competition are removed server-side).
 * Counts only — never addresses. Sends nothing and stores nothing; this is what
 * the panel calls when the audience selection changes. Administrator only.
 */
export async function POST(request: Request) {
  return resolveAnnouncementAudienceHandler(request);
}
