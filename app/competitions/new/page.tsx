import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isCompetitionCreationAdmin } from "@/lib/competition-server";
import { NewCompetitionForm } from "./NewCompetitionForm";

/**
 * COMP-007 — Competition creation page (server-guarded).
 *
 * Only the authenticated profile whose id equals the server-only
 * `MULTI_TEAM_ADMIN_USER_ID` may reach the creation UI. This mirrors (and
 * backs up) the authoritative checks in POST /api/competitions and
 * createCompetitionEvent so that a direct visit to /competitions/new by an
 * ambassador, a normal player, or anyone else is denied.
 *
 * Unauthorized users get the application's standard not-found response (which
 * does not reveal that a competition-creation admin is configured).
 *
 * NOTE: This is a temporary restriction and does NOT change ambassador
 * operational permissions — ambassadors can still manage/operate the events
 * they are assigned to.
 */
export default async function NewCompetitionPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  if (!isCompetitionCreationAdmin(session.user.id)) {
    notFound();
  }

  return <NewCompetitionForm />;
}