import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import {
  COMPETITION_EVENT_STATUS_LABELS,
  COMPETITION_EVENT_STATUS_COLORS,
} from "@/types";
import {
  getCompetitionAmbassadorsWithProfiles,
  getCompetitionEvent,
  getCompetitionStatistics,
  getCompetitionViewerRole,
} from "@/lib/competition-server";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Target,
  Repeat,
  Pencil,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  UserCheck,
  Trophy,
} from "lucide-react";
import { LifecycleControls } from "./LifecycleControls";
import { AmbassadorManager } from "./AmbassadorManager";
import { JoinLinkManager } from "./JoinLinkManager";
import { DrawingPanel } from "./DrawingPanel";
import { getCompetitionJoinLinks } from "@/lib/competition-join-server";
import {
  getCompetitionDrawing,
  getQualifiedParticipantCount,
} from "@/lib/competition-drawing-server";

/**
 * COMP-002 / COMP-004 — Event management page.
 *
 * Serves BOTH the event creator and authorized ambassadors with role-aware
 * sections:
 *
 *   Creator:    event details, edit, lifecycle, ambassadors, join links, stats,
 *               participant verification & challenge recording (COMP-004)
 *   Ambassador: event details + stats + event-day operations
 *               (participant verification & challenge recording)
 *
 * The viewer role is resolved server-side from competition_events.created_by
 * and competition_ambassadors. It is never inferred from profiles.role.
 *
 * COMP-005 operational delegation: ambassadors run the event (participants,
 * verification, attempts). Creator-only administration — editing configuration,
 * lifecycle changes, ambassador management and join links — remains gated on
 * `isManager`.
 */

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "Not set";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-3xl font-bold ${accent ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex-shrink-0 text-muted-foreground">{icon}</div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
    </div>
  );
}

export default async function CompetitionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;

  const role = await getCompetitionViewerRole(id, session.user.id);
  if (!role) {
    // Not the creator and not an ambassador — no access.
    redirect("/competitions");
  }

  const event = await getCompetitionEvent(id);
  if (!event) {
    redirect("/competitions");
  }

  const isManager = role === "manager";

  const stats = await getCompetitionStatistics(id);
  const ambassadors = isManager
    ? await getCompetitionAmbassadorsWithProfiles(id)
    : [];
  const joinLinks = isManager ? await getCompetitionJoinLinks(id) : [];

  // COMP-006 drawing — available to the creator AND assigned ambassadors.
  const qualifiedCount = await getQualifiedParticipantCount(id);
  const drawing = await getCompetitionDrawing(id, session.user.id);

  const statusColor = COMPETITION_EVENT_STATUS_COLORS[event.status] ?? "";

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-4xl">
        {/* Back */}
        <div className="mb-6">
          <Link href="/competitions">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Competitions
            </Button>
          </Link>
        </div>

        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold">{event.name}</h1>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${statusColor}`}
                >
                  {COMPETITION_EVENT_STATUS_LABELS[event.status]}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {isManager ? "Manager" : "Ambassador"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {/* Operational control — available to the creator AND ambassadors */}
              <Link href={`/competitions/${event.id}/participants`}>
                <Button>
                  <UserCheck className="mr-2 h-4 w-4" />
                  Manage Participants
                </Button>
              </Link>
              {/* Creator-only administration */}
              {isManager && (
                <Link href={`/competitions/${event.id}/edit`}>
                  <Button variant="outline">
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit Event
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Description */}
          {event.description && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {event.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Event information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Event Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2">
                <InfoRow
                  icon={<MapPin className="h-4 w-4" />}
                  label="Location"
                  value={event.location}
                />
                <InfoRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Event Date"
                  value={formatDateTime(event.event_date)}
                />
                <InfoRow
                  icon={<Target className="h-4 w-4" />}
                  label="Challenge"
                  value={event.challenge_name}
                />
                <InfoRow
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label="Qualification Threshold"
                  value={String(event.challenge_threshold)}
                />
                <InfoRow
                  icon={<Repeat className="h-4 w-4" />}
                  label="Maximum Attempts"
                  value={String(event.max_attempts)}
                />
                <InfoRow
                  icon={<Clock className="h-4 w-4" />}
                  label="Status"
                  value={COMPETITION_EVENT_STATUS_LABELS[event.status]}
                />
              </div>
            </CardContent>
          </Card>

          {/* Statistics */}
          <section>
            <h2 className="mb-4 text-xl font-semibold">Statistics</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Total Participants"
                value={stats.total}
                icon={<Users className="h-4 w-4" />}
              />
              <StatCard
                label="Qualified"
                value={stats.qualified}
                icon={<CheckCircle2 className="h-4 w-4" />}
                accent="text-green-600 dark:text-green-400"
              />
              <StatCard
                label="Not Qualified"
                value={stats.not_qualified}
                icon={<XCircle className="h-4 w-4" />}
                accent="text-red-600 dark:text-red-400"
              />
              <StatCard
                label="Pending / Registered"
                value={stats.registered + stats.challenge_pending}
                icon={<Clock className="h-4 w-4" />}
                accent="text-yellow-600 dark:text-yellow-400"
              />
              <StatCard
                label="Ambassadors"
                value={stats.ambassadors}
                icon={<ShieldCheck className="h-4 w-4" />}
              />
            </div>
            {stats.total === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                No participants yet. Share an ambassador's join link or QR
                code below to invite players.
              </p>
            )}
          </section>

          {/* Operational: event-day participant verification & challenge.
              Available to the creator AND assigned ambassadors. */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <UserCheck className="h-5 w-5 text-primary" />
                Run Competition
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Verify registered participants on-site and record their
                challenge attempts.
              </p>
              <Link href={`/competitions/${event.id}/participants`}>
                <Button>
                  <UserCheck className="mr-2 h-4 w-4" />
                  Open Participant Manager
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* COMP-006 drawing: start the draw or show the immutable winner.
              Available to the creator AND assigned ambassadors. */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
              <Trophy className="h-5 w-5 text-primary" />
              Drawing
            </h2>
            <DrawingPanel
              eventId={event.id}
              status={event.status}
              qualifiedCount={qualifiedCount}
              initialDrawing={drawing}
            />
          </section>

          {/* Creator-only: lifecycle + ambassador management + join links */}
          {isManager && (
            <>
              <LifecycleControls eventId={event.id} status={event.status} />
              <AmbassadorManager eventId={event.id} ambassadors={ambassadors} />
              <JoinLinkManager
                eventId={event.id}
                ambassadors={ambassadors}
                initialLinks={joinLinks}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}