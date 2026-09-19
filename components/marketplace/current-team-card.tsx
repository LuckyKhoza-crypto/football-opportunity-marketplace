import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Shield, Users } from "lucide-react";
import type { TeamMembershipWithTeam } from "@/types";

/**
 * TEAM-006 — "Current Team" card for a player profile.
 *
 * Displays the player's active team membership. The position and role
 * shown here come from `team_memberships` (the player's role on THIS
 * team), never from the player's general profile positions/preferred_role.
 *
 * The team name links to the public team profile route.
 */
export function CurrentTeamCard({
  membership,
}: {
  membership: TeamMembershipWithTeam;
}) {
  const { team, position, role } = membership;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5 text-primary" />
          Current Team
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          {/* Team Logo */}
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-muted">
            {team.logo_url ? (
              <img
                src={team.logo_url}
                alt={`${team.team_name} logo`}
                className="h-16 w-16 rounded-xl object-cover"
              />
            ) : (
              <Users className="h-8 w-8 text-muted-foreground" />
            )}
          </div>

          {/* Team Info */}
          <div className="min-w-0 flex-1">
            <Link
              href={`/teams/${team.id}`}
              className="text-lg font-bold hover:text-primary hover:underline"
            >
              {team.team_name}
            </Link>
            <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
              {team.league && <p>{team.league}</p>}
              {team.location && (
                <p className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {team.location}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Membership position/role — from team_memberships */}
        {(position || role) && (
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            {position && (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {position}
              </span>
            )}
            {role && (
              <span className="inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                {role}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}