import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  listParticipantCompetitionEntries,
  type ParticipantCompetitionEntry,
} from "@/lib/competition-server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  COMPETITION_EVENT_STATUS_COLORS,
  COMPETITION_EVENT_STATUS_LABELS,
  COMPETITION_PARTICIPANT_STATUS_LABELS,
} from "@/types";
import {
  ArrowRight,
  Calendar,
  MapPin,
  Repeat,
  Target,
  Trophy,
  UserCheck,
} from "lucide-react";

/**
 * T-REM-2 — "My Competitions" (participant-facing).
 *
 * Lists the competitions the authenticated profile has entered (ACTIVE
 * registrations only). Each competition links to its entry page, where the
 * participant can view their pass and unregister before check-in.
 *
 * Identity is the session profile id; the listing never trusts a client value.
 * A participant does not need a marketplace role/onboarding to reach this page.
 */
export default async function MyCompetitionsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=%2Fcompetitions%2Fentries");
  }

  const entries = await listParticipantCompetitionEntries(session.user.id);

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">My Competitions</h1>
          <p className="text-lg text-muted-foreground">
            Competitions you have entered. Open one to view your pass or
            unregister before check-in.
          </p>
        </div>

        {entries.length > 0 ? (
          <div className="space-y-4">
            {entries.map((entry) => (
              <EntryCard key={entry.participantId} entry={entry} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Trophy className="h-6 w-6 text-muted-foreground" />
              </div>
              <h2 className="mb-2 text-lg font-semibold">
                You haven&apos;t entered any competitions yet
              </h2>
              <p className="max-w-md text-sm text-muted-foreground">
                When you register for a competition through an organizer&apos;s
                join link or QR code, it will appear here so you can view your
                pass or unregister before check-in.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function EntryCard({ entry }: { entry: ParticipantCompetitionEntry }) {
  const { event } = entry;
  const statusColor = COMPETITION_EVENT_STATUS_COLORS[event.status] ?? "";

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-bold">{event.name}</h2>
            <span
              className={`inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
            >
              {COMPETITION_EVENT_STATUS_LABELS[event.status]}
            </span>
          </div>

          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>{event.location ?? "Location not set"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>{formatDate(event.event_date)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>
                {event.challenge_name} · target {event.challenge_threshold}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>
                {event.max_attempts}{" "}
                {event.max_attempts === 1 ? "attempt" : "attempts"} max
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserCheck className="h-3.5 w-3.5" />
              {entry.checkedInAt
                ? "Checked in"
                : COMPETITION_PARTICIPANT_STATUS_LABELS[entry.status]}
            </span>
            <Link href={`/competitions/${event.id}/entry`}>
              <Button size="sm">
                View Entry
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Date not set";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
