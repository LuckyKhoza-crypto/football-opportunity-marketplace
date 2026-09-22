import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getCompetitionJoinByToken, getCompetitionPass } from "@/lib/competition-join-server";
import { getParticipantChallengeState } from "@/lib/competition-attempt-server";
import { formatVerificationCode } from "@/lib/competition-join";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  COMPETITION_PARTICIPANT_STATUS_LABELS,
  type Profile,
} from "@/types";
import { Calendar, MapPin, ShieldCheck, Ticket, Repeat, Target } from "lucide-react";
import { PassQr } from "./PassQr";

/**
 * COMP-003 / COMP-004 — Participant pre-entry pass.
 *
 * The registrant's confirmation that they are entered in the competition. The
 * pass is PRIVATE to the participant: it is only rendered when the authenticated
 * profile owns a participant row for the event, and it never exposes other
 * participants, emails, or database ids.
 *
 * COMP-004 additions:
 *   * the verification code an organizer can type, plus an opaque QR (only the
 *     verification URL/token is encoded — never an internal id),
 *   * the participant's own challenge progress (attempts used/remaining and
 *     qualified state). No organizer-only controls are shown here.
 */
export default async function CompetitionPassPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/competitions/join/${token}/pass`)}`);
  }

  const join = await getCompetitionJoinByToken(token);
  if (!join) {
    redirect(`/competitions/join/${encodeURIComponent(token)}`);
  }

  const pass = await getCompetitionPass(join.event.id, session.user.id);
  if (!pass) {
    // Not registered — send them back to the join page.
    redirect(`/competitions/join/${encodeURIComponent(token)}`);
  }

  const challenge = await getParticipantChallengeState(
    join.event.id,
    pass.participantId,
  );

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name, email")
    .eq("id", session.user.id)
    .maybeSingle();

  const participantName =
    (profile as Pick<Profile, "full_name" | "email"> | null)?.full_name ||
    (profile as Pick<Profile, "full_name" | "email"> | null)?.email ||
    "Participant";

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
          <CardTitle className="text-2xl">Competition Pass</CardTitle>
          <CardDescription className="text-base">{join.event.name}</CardDescription>
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

          {/* Opaque QR for event staff verification */}
          <PassQr eventId={join.event.id} />

          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <PassDetail label="Participant" value={participantName} />
            <PassDetail label="Challenge" value={join.event.challenge_name} />
            <PassDetail
              label="Location"
              value={join.event.location}
              icon={<MapPin className="h-4 w-4" />}
            />
            <PassDetail
              label="Date"
              value={formatDateTime(join.event.event_date)}
              icon={<Calendar className="h-4 w-4" />}
            />
          </div>

          {/* Challenge progress */}
          {challenge && (
            <div className="rounded-lg border p-4">
              <p className="mb-3 text-sm font-medium">Challenge Progress</p>
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <PassDetail
                  label="Qualification Threshold"
                  value={String(join.event.challenge_threshold)}
                  icon={<Target className="h-4 w-4" />}
                />
                <PassDetail
                  label="Attempts Used"
                  value={`${challenge.attemptsUsed} of ${challenge.maxAttempts}`}
                  icon={<Repeat className="h-4 w-4" />}
                />
                <PassDetail
                  label="Attempts Remaining"
                  value={String(challenge.attemptsRemaining)}
                />
                {challenge.bestResult != null && (
                  <PassDetail
                    label="Best Result"
                    value={String(challenge.bestResult)}
                  />
                )}
              </div>
              {passed ? (
                <p className="mt-3 rounded-md bg-green-100 px-3 py-2 text-sm font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                  You qualified! You completed the challenge.
                </p>
              ) : challenge.attemptsRemaining <= 0 ? (
                <p className="mt-3 rounded-md bg-red-100 px-3 py-2 text-sm font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">
                  You have used all of your attempts.
                </p>
              ) : null}
            </div>
          )}

          <div className="flex items-center justify-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="font-medium">
              {COMPETITION_PARTICIPANT_STATUS_LABELS[pass.status]}
            </span>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            {passed
              ? "Your challenge is complete."
              : "Complete the challenge at the event to qualify."}
          </p>

          <div className="flex justify-center">
            <Link href={`/competitions/join/${encodeURIComponent(token)}`}>
              <Button variant="ghost" size="sm">
                Back to Competition
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PassDetail({
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