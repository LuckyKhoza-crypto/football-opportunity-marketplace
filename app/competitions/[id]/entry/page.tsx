import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCompetitionEvent } from "@/lib/competition-server";
import { getCompetitionPass } from "@/lib/competition-join-server";
import { getParticipantChallengeState } from "@/lib/competition-attempt-server";
import {
  formatVerificationCode,
  getWithdrawalBlockReason,
} from "@/lib/competition-join";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { COMPETITION_PARTICIPANT_STATUS_LABELS } from "@/types";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Repeat,
  ShieldCheck,
  Target,
  Ticket,
  UserMinus,
} from "lucide-react";
import { PassQr } from "@/app/competitions/join/[token]/pass/PassQr";
import { UnregisterCompetitionButton } from "@/components/competitions/UnregisterCompetitionButton";

/**
 * T-REM-2 — participant entry page (`/competitions/[id]/entry`).
 *
 * The destination of a "My Competitions" card: shows the authenticated
 * participant their entry for this competition and lets them unregister before
 * check-in. Reached by event id (no join token required), so a participant who
 * has lost their original join link can still manage their registration.
 *
 * Only the OWNING participant can view this page — `getCompetitionPass` is
 * looked up by (event id, session profile id); anyone else is redirected.
 */
export default async function CompetitionEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/competitions/${id}/entry`)}`,
    );
  }

  const event = await getCompetitionEvent(id);
  if (!event) notFound();

  const pass = await getCompetitionPass(id, session.user.id);
  if (!pass) {
    // Not registered for this event — send them to their competitions list.
    redirect("/competitions/entries");
  }

  // A removed registration is never presented as an active entry.
  if (pass.removedAt) {
    return (
      <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mb-2 flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <UserMinus className="h-7 w-7 text-muted-foreground" />
              </div>
            </div>
            <CardTitle className="text-2xl">You&apos;ve unregistered</CardTitle>
            <CardDescription className="text-base">{event.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6 text-center">
            <p className="text-sm text-muted-foreground">
              You are no longer registered for this competition. Your
              registration history has been kept.
            </p>
            <div className="flex justify-center">
              <Link href="/competitions/entries">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to My Competitions
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const challenge = await getParticipantChallengeState(id, pass.participantId);

  const withdrawalBlockedReason = getWithdrawalBlockReason({
    eventStatus: event.status,
    removedAt: pass.removedAt,
    checkedInAt: pass.checkedInAt,
    hasAttempts: (challenge?.attemptsUsed ?? 0) > 0,
    providerMapped: pass.providerMapped,
  });
  const canWithdraw = withdrawalBlockedReason === null;

  const passed = challenge?.passed ?? false;

  return (
    <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-lg overflow-hidden">
        <CardHeader className="bg-primary/5 text-center">
          <div className="mb-2 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Ticket className="h-7 w-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Your Entry</CardTitle>
          <CardDescription className="text-base">{event.name}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="rounded-lg border-2 border-dashed border-primary/30 p-6 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Verification Code
            </p>
            <p className="mt-2 font-mono text-3xl font-bold tracking-widest">
              {pass.verificationCode
                ? formatVerificationCode(pass.verificationCode)
                : "—"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Show this code to the event staff.
            </p>
          </div>

          <PassQr eventId={event.id} />

          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <Detail label="Challenge" value={event.challenge_name} />
            <Detail
              label="Location"
              value={event.location}
              icon={<MapPin className="h-4 w-4" />}
            />
            <Detail
              label="Date"
              value={formatDateTime(event.event_date)}
              icon={<Calendar className="h-4 w-4" />}
            />
            <Detail
              label="Qualification Threshold"
              value={String(event.challenge_threshold)}
              icon={<Target className="h-4 w-4" />}
            />
            {challenge && (
              <Detail
                label="Attempts Used"
                value={`${challenge.attemptsUsed} of ${challenge.maxAttempts}`}
                icon={<Repeat className="h-4 w-4" />}
              />
            )}
          </div>

          <div className="flex items-center justify-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="font-medium">
              {pass.checkedInAt
                ? "Checked in"
                : COMPETITION_PARTICIPANT_STATUS_LABELS[pass.status]}
            </span>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            {passed
              ? "Your challenge is complete."
              : "Complete the challenge at the event to qualify."}
          </p>

          {/* T-REM-2: self-unregistration (gated by the shared server rule). */}
          <UnregisterCompetitionButton
            eventId={event.id}
            canWithdraw={canWithdraw}
            blockedReason={withdrawalBlockedReason}
          />

          <div className="flex justify-center">
            <Link href="/competitions/entries">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to My Competitions
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function formatDateTime(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
