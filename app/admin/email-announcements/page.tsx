import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getAnnouncementAudience,
  isAnnouncementsAdmin,
  listAnnouncementCompetitionOptions,
  listEmailAnnouncementBatches,
} from "@/lib/email-announcements-server";
import type { EmailAnnouncementAudienceSummary } from "@/types/email-announcement";
import { EmailAnnouncementsClient } from "./EmailAnnouncementsClient";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — "Email Users" page (server-guarded).
 *
 * Admin-only: only the authenticated profile whose id equals the server-only
 * `MULTI_TEAM_ADMIN_USER_ID` may reach this page. This mirrors (and backs up) the
 * authoritative checks in every `/api/admin/email-announcements` handler so that
 * a direct visit by a normal player, a team manager or an ambassador is denied.
 *
 * Unauthorized users get the application's standard not-found response (which
 * does not reveal that an administrator is configured).
 */

const EMPTY_AUDIENCE: EmailAnnouncementAudienceSummary = {
  audienceType: "all_users",
  baseCount: 0,
  eligibleCount: 0,
  invalidCount: 0,
  duplicateCount: 0,
  excludedRegisteredCount: 0,
  promotionEventId: null,
};

export default async function EmailAnnouncementsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  if (!isAnnouncementsAdmin(session.user.id)) {
    notFound();
  }

  const profileId = session.user.id;

  const [events, audience, batches] = await Promise.all([
    listAnnouncementCompetitionOptions(),
    getAnnouncementAudience({
      actorProfileId: profileId,
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
    }),
    listEmailAnnouncementBatches(profileId),
  ]);

  return (
    <EmailAnnouncementsClient
      initialEvents={events.ok ? events.data : []}
      initialAudience={audience.ok ? audience.data : EMPTY_AUDIENCE}
      initialBatches={batches.ok ? batches.data : []}
    />
  );
}
