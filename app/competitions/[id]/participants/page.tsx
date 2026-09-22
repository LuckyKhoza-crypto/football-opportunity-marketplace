import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  getCompetitionEvent,
  getCompetitionViewerRole,
} from "@/lib/competition-server";
import { listCompetitionParticipantsWithState } from "@/lib/competition-attempt-server";
import { ParticipantManager } from "./ParticipantManager";
import { ArrowLeft, UserCheck } from "lucide-react";

/**
 * COMP-004 / COMP-005 — Competition participant / challenge management page.
 *
 * The event-day operations screen. Access is granted to the event CREATOR and
 * to any AMBASSADOR assigned to the event (operational delegation). Anyone else
 * — including a participant of the event or an unrelated authenticated user —
 * is redirected back to the event page.
 *
 * The participant list + derived challenge state are loaded server-side; the
 * interactive verify/record flow lives in the client ParticipantManager, which
 * still re-verifies every action against the creator-or-ambassador API.
 *
 * `?verified=<participantId>` lets the QR verification page hand off a resolved
 * participant so the attempt screen opens immediately after a scan.
 */
export default async function CompetitionParticipantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ verified?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;
  const { verified } = await searchParams;

  // Creator OR assigned ambassador. Everyone else is sent back to the event page.
  const role = await getCompetitionViewerRole(id, session.user.id);
  if (!role) {
    redirect(`/competitions/${id}`);
  }

  const event = await getCompetitionEvent(id);
  if (!event) {
    redirect("/competitions");
  }

  const participants = await listCompetitionParticipantsWithState(
    id,
    session.user.id,
  );

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <Link href={`/competitions/${event.id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Event
            </Button>
          </Link>
        </div>

        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <UserCheck className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Run Competition</h1>
            <p className="text-sm text-muted-foreground">
              {event.name} — verify participants and record challenge attempts
            </p>
          </div>
        </div>

        <ParticipantManager
          eventId={event.id}
          event={{
            id: event.id,
            name: event.name,
            challenge_name: event.challenge_name,
            challenge_threshold: event.challenge_threshold,
            max_attempts: event.max_attempts,
          }}
          initialParticipants={participants}
          verifiedParticipantId={verified ?? null}
        />
      </div>
    </div>
  );
}