import {
  getAnnouncementsPanelHandler,
  sendAnnouncementHandler,
} from "@/lib/email-announcements-api";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — /api/admin/email-announcements.
 *
 * GET  returns the composing panel's initial data: the selectable competitions,
 *      the CURRENT all-users recipient count and the recent announcement
 *      batches. Administrator only.
 * POST queues a send of one individual message per resolved recipient. The body
 *      carries only the message, the audience selection and the idempotency
 *      `requestId`; the audience is re-resolved server-side and the actor is
 *      taken from the session. A repeat of the same `requestId` returns the
 *      existing batch instead of sending again.
 */
export async function GET(request: Request) {
  return getAnnouncementsPanelHandler(request);
}

export async function POST(request: Request) {
  return sendAnnouncementHandler(request);
}
