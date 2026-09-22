import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import {
  getCompetitionJoinByToken,
  isRegisteredForEvent,
} from "@/lib/competition-join-server";
import {
  buildCompetitionJoinLoginUrl,
  buildCompetitionJoinPath,
  getJoinPageState,
} from "@/lib/competition-join";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Calendar, MapPin, Target, Repeat, Trophy } from "lucide-react";
import { JoinCompetitionButton } from "./JoinCompetitionButton";

/**
 * COMP-003 — Public competition join page.
 *
 * The player-facing entry point for a competition join link / QR code. Resolves
 * the token SERVER-SIDE (never queries competition_join_links from the browser)
 * and renders the appropriate state.
 *
 * The raw token is never treated as authorization — the protected
 * POST /api/competitions/join performs the authoritative registration checks.
 *
 * This page is intentionally public so unauthenticated visitors can see the
 * competition and be directed through the existing auth flow with the join URL
 * preserved via callbackUrl. It NEVER exposes participant lists, emails,
 * profile ids, database ids, or token hashes.
 */
export default async function CompetitionJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getServerSession(authOptions);
  const isAuthenticated = Boolean(session?.user?.id);

  const join = await getCompetitionJoinByToken(token);
  const pageState = getJoinPageState(
    join ? { state: join.state, eventOpen: join.eventOpen } : null,
    isAuthenticated,
  );

  const alreadyRegistered =
    pageState === "open_authenticated" && join && session?.user?.id
      ? await isRegisteredForEvent(join.event.id, session.user.id)
      : false;

  const event = join?.event ?? null;

  return (
    <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mb-2 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Trophy className="h-7 w-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">
            {event ? event.challenge_name : "Competition"}
          </CardTitle>
          {event && (
            <CardDescription className="text-base">{event.name}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {event ? (
            <>
              {join?.ambassador?.full_name && (
                <p className="text-center text-sm text-muted-foreground">
                  Shared by {join.ambassador.full_name}
                </p>
              )}

              {event.description && (
                <p className="text-center text-sm text-muted-foreground">
                  {event.description}
                </p>
              )}

              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <PublicDetail
                  icon={<MapPin className="h-4 w-4" />}
                  label="Location"
                  value={event.location}
                />
                <PublicDetail
                  icon={<Calendar className="h-4 w-4" />}
                  label="Date"
                  value={formatDateTime(event.event_date)}
                />
                <PublicDetail
                  icon={<Target className="h-4 w-4" />}
                  label="Challenge"
                  value={event.challenge_name}
                />
                <PublicDetail
                  icon={<Repeat className="h-4 w-4" />}
                  label="Max Attempts"
                  value={String(event.max_attempts)}
                />
              </div>

              <p className="text-center text-muted-foreground">
                Complete {event.challenge_threshold} to qualify.
              </p>

              {/* State-specific CTA */}
              {pageState === "open_authenticated" && (
                <div className="flex justify-center">
                  {alreadyRegistered ? (
                    <div className="w-full space-y-3 text-center">
                      <p className="text-muted-foreground">
                        {"You're already registered."}
                      </p>
                      <Link
                        href={`${buildCompetitionJoinPath(token)}/pass`}
                        className="block"
                      >
                        <Button size="lg" className="w-full sm:w-auto">
                          View My Competition Pass
                        </Button>
                      </Link>
                    </div>
                  ) : (
                    <JoinCompetitionButton token={token} />
                  )}
                </div>
              )}

              {pageState === "open_unauthenticated" && (
                <div className="space-y-3 text-center">
                  <p className="text-muted-foreground">
                    Sign in to enter this competition.
                  </p>
                  <Link
                    href={buildCompetitionJoinLoginUrl(token)}
                    className="block"
                  >
                    <Button size="lg" className="w-full sm:w-auto">
                      Sign In to Enter
                    </Button>
                  </Link>
                </div>
              )}

              {pageState === "closed" && (
                <p className="text-center text-muted-foreground">
                  This competition is not currently accepting registrations.
                </p>
              )}

              {pageState === "revoked" && (
                <p className="text-center text-muted-foreground">
                  This competition link is no longer available.
                </p>
              )}
            </>
          ) : (
            <p className="text-center text-muted-foreground">
              This competition link is no longer available.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PublicDetail({
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
    <div className="flex items-start gap-2">
      <div className="mt-0.5 flex-shrink-0 text-muted-foreground">{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
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