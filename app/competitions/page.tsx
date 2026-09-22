import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, Trophy } from "lucide-react";
import {
  isCompetitionCreationAdmin,
  listAmbassadorCompetitionEvents,
  listManagedCompetitionEvents,
} from "@/lib/competition-server";
import {
  CompetitionCard,
  EmptyCompetitions,
} from "./CompetitionCardClient";

/**
 * COMP-002 — Competitions management page.
 *
 * A management-oriented page (NOT public discovery) for authenticated users
 * who create/manage events. Shows the competitions the current profile
 * created (competition_events.created_by) and, separately, any events they
 * are an ambassador for.
 *
 * This page deliberately uses the auth system + `profiles` only, so it does
 * NOT require marketplace onboarding.
 */
export default async function CompetitionsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  const profileId = session.user.id;

  const [managed, ambassador] = await Promise.all([
    listManagedCompetitionEvents(profileId),
    listAmbassadorCompetitionEvents(profileId),
  ]);

  // COMP-007: only the configured MULTI_TEAM_ADMIN_USER_ID may create a new
  // competition, so the creation action is shown only to that user. This is a
  // UI convenience only — the authoritative checks live server-side.
  const canCreate = isCompetitionCreationAdmin(profileId);

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold">Competitions</h1>
            <p className="text-lg text-muted-foreground">
              Create and manage your competition events
            </p>
          </div>
          {canCreate && (
            <Link href="/competitions/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Competition
              </Button>
            </Link>
          )}
        </div>

        {/* Managed events */}
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-semibold">Your Competitions</h2>
          {managed.length > 0 ? (
            <div className="space-y-4">
              {managed.map((event) => (
                <CompetitionCard key={event.id} event={event} />
              ))}
            </div>
          ) : (
            <EmptyCompetitions variant="managed" />
          )}
        </section>

        {/* Ambassador events (optional section) */}
        <section>
          <h2 className="mb-4 text-xl font-semibold">
            Events you support as Ambassador
          </h2>
          {ambassador.length > 0 ? (
            <div className="space-y-4">
              {ambassador.map((event) => (
                <CompetitionCard key={event.id} event={event} />
              ))}
            </div>
          ) : (
            <EmptyCompetitions variant="ambassador" />
          )}
        </section>

        {/* Icon hint for the global empty state is handled in the card above */}
        {managed.length === 0 && ambassador.length === 0 && (
          <p className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" />
            Competitions are separate from the player/team marketplace.
          </p>
        )}
      </div>
    </div>
  );
}