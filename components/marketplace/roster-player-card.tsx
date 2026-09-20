import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Users } from "lucide-react";
import type { TeamMembershipWithPlayer } from "@/types";

/**
 * TEAM-006 — "Roster" player card for a team profile.
 *
 * Displays an active roster member. The position and role shown here
 * come from `team_memberships` (the player's role on THIS team), never
 * from the player's general profile positions/preferred_role.
 *
 * The player name links to the public player profile route.
 */
export function RosterPlayerCard({
  membership,
}: {
  membership: TeamMembershipWithPlayer;
}) {
  const { player_profile: playerProfile, position, role } = membership;
  const fullName = playerProfile.profile?.full_name ?? "Unknown Player";
  const avatarUrl = playerProfile.profile?.avatar_url ?? null;
  const photoUrl = playerProfile.profile_photo_url ?? avatarUrl;

  return (
    <Card className="relative overflow-hidden border-[rgba(255,255,255,0.14)] transition-shadow hover:shadow-md">
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/images/home-page-im3.jpg')" }}
        aria-hidden="true"
      />
      <CardContent className="relative z-10 p-5">
        <div className="flex items-center gap-3">
          {/* Photo / Avatar */}
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={`${fullName} photo`}
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              <Users className="h-6 w-6 text-[#D1D5DB]" />
            )}
          </div>

          {/* Player Info */}
          <div className="min-w-0 flex-1">
            <Link
              href={`/players/${playerProfile.id}`}
              className="truncate text-base font-bold text-white hover:text-primary hover:underline"
            >
              {fullName}
            </Link>
            {(position || role) && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {position && (
                  <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                    {position}
                  </span>
                )}
                {role && (
                  <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-[#D1D5DB]">
                    {role}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}