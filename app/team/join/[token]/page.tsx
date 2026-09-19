import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getTeamInviteByToken } from "@/lib/team-invite-server";
import {
  getInvitePageState,
  getInviteAction,
  buildInviteLoginUrl,
} from "@/lib/team-join";
import { AcceptInviteButton } from "./AcceptInviteButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";

/**
 * TEAM-003 — Team invite landing page.
 *
 * Resolves the invite token server-side via the TEAM-002 secure lookup
 * (never queries team_invites from the browser) and renders the
 * appropriate state. The raw token in the URL is never treated as
 * authorization — TEAM-004 performs the actual acceptance.
 *
 * A team invite is a reusable shared recruitment link — it is never
 * "accepted" as a whole. Historical acceptances are represented by
 * team_memberships rows, never by mutating the invite itself.
 *
 * This page is intentionally public so unauthenticated visitors can see
 * the invitation and be directed through the existing auth flow with the
 * invite URL preserved via callbackUrl.
 */
export default async function TeamJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getServerSession(authOptions);
  const isAuthenticated = Boolean(session?.user?.id);

  const invite = await getTeamInviteByToken(token);
  const pageState = getInvitePageState(invite, isAuthenticated);
  const action = getInviteAction(pageState);

  return (
    <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{"You've been invited to join"}</CardTitle>
          <CardDescription className="text-base">
            {invite ? "You've been invited to join this team." : "Invitation not found"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {invite ? (
            <>
              {/* Team Logo */}
              <div className="flex justify-center">
                {invite.team.logo_url ? (
                  <img
                    src={invite.team.logo_url}
                    alt={`${invite.team.team_name} logo`}
                    className="h-24 w-24 rounded-xl object-cover ring-2 ring-primary/20"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted">
                    <Users className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Team Name */}
              <div className="text-center">
                <h2 className="text-xl font-bold">{invite.team.team_name}</h2>
                {invite.team.location && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {invite.team.location}
                  </p>
                )}
                {invite.team.league && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {invite.team.league}
                  </p>
                )}
              </div>

              {/* State-specific content */}
              {pageState === "pending_authenticated" && (
                <div className="space-y-4 text-center">
                  {action && (
                    <div className="flex justify-center">
                      <AcceptInviteButton token={token} />
                    </div>
                  )}
                </div>
              )}

              {pageState === "pending_unauthenticated" && (
                <div className="space-y-4 text-center">
                  <p className="text-muted-foreground">
                    {"You've been invited to join this team. Log in to accept the invitation."}
                  </p>
                  <div className="flex justify-center">
                    <Link href={buildInviteLoginUrl(token)}>
                      <Button size="lg" className="w-full sm:w-auto">
                        Log In to Accept
                      </Button>
                    </Link>
                  </div>
                </div>
              )}

              {pageState === "revoked" && (
                <div className="text-center">
                  <p className="text-muted-foreground">
                    This invitation has been revoked.
                  </p>
                </div>
              )}

              {pageState === "expired" && (
                <div className="text-center">
                  <p className="text-muted-foreground">
                    This invitation has expired.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="text-center">
              <p className="text-muted-foreground">
                This invitation link is invalid or no longer available.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
