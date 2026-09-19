import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTeamInviteState } from "@/lib/team-invite";
import { getSelectedTeamIdWithFallback, resolveSelectedTeam } from "@/lib/team-context-server";
import { TeamInvitesClient } from "./TeamInvitesClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link2 } from "lucide-react";
import type { TeamInvite } from "@/types";

export default async function TeamInvitesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const userRoles = session.user.roles as string[] | undefined;
  if (!userRoles?.includes("team")) {
    redirect("/");
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  const resolvedSearchParams = await searchParams;
  const selectedTeamId = await getSelectedTeamIdWithFallback(resolvedSearchParams);
  const teamProfile = await resolveSelectedTeam(profile.id, selectedTeamId);

  if (!teamProfile) {
    redirect("/team/onboarding");
  }

  // Fetch existing invites for this team
  const { data: invites, error } = await supabaseAdmin
    .from("team_invites")
    .select("id, team_profile_id, expires_at, revoked_at, created_at, updated_at")
    .eq("team_profile_id", teamProfile.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch team invites:", error);
  }

  const safeInvites = (invites ?? []).map((invite) => ({
    id: invite.id,
    team_profile_id: invite.team_profile_id,
    expires_at: invite.expires_at,
    revoked_at: invite.revoked_at,
    created_at: invite.created_at,
    updated_at: invite.updated_at,
    state: getTeamInviteState(invite as unknown as TeamInvite),
  }));

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="mb-2 flex items-center gap-2 text-3xl font-bold">
            <Link2 className="h-7 w-7 text-primary" />
            Team Invite Links
          </h1>
          <p className="text-lg text-muted-foreground">
            {teamProfile.team_name} — Create reusable recruitment links that
            multiple players can accept while the invite is valid.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Invite Links</CardTitle>
            <CardDescription>
              Each link is reusable: any eligible player can accept it until it
              expires or you revoke it. Players who join are added to your team
              roster and {"you'll"} receive a notification.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TeamInvitesClient
              teamId={teamProfile.id}
              initialInvites={safeInvites}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}