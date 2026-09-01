import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import {
  PLAYING_LEVEL_LABELS,
  PREFERRED_FOOT_LABELS,
  AVAILABILITY_LABELS,
  PREFERRED_ROLE_LABELS,
  type PlayerProfile,
  type Position,
  type PreviousClub,
} from "@/types";
import { MapPin, Calendar, Target, Trophy, Video, Award, Users, Globe } from "lucide-react";

function formatPositions(positions: Position[]): string {
  return positions.join(" / ");
}

function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export default async function PlayerProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  // Use session roles from JWT for authentication decisions
  const userRoles = session.user.roles as string[] | undefined;
  if (!userRoles || userRoles.length === 0) {
    redirect("/onboarding");
  }
  if (!userRoles.includes("player")) {
    if (userRoles.includes("team")) {
      redirect("/team");
    }
    redirect("/onboarding");
  }

  // Fetch profile data for display using admin client (bypasses RLS)
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  const { data: playerProfile } = await supabaseAdmin
    .from("player_profiles")
    .select("*")
    .eq("user_id", profile.id)
    .single();

  if (!playerProfile) {
    redirect("/player/onboarding");
  }

  const typedProfile = playerProfile as unknown as PlayerProfile;

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-3xl">
        {/* Profile Header */}
        <div className="mb-8">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            {/* Photo */}
            <div className="flex-shrink-0">
              {typedProfile.profile_photo_url ? (
                <img
                  src={typedProfile.profile_photo_url}
                  alt="Profile"
                  className="h-32 w-32 rounded-xl object-cover ring-2 ring-primary/20"
                />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-xl bg-muted">
                  <Users className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Basic Info */}
            <div className="flex-1">
              <h1 className="text-3xl font-bold">
                {profile.full_name || "Player"}
              </h1>
              <div className="mt-2 space-y-1">
                {typedProfile.positions && typedProfile.positions.length > 0 && (
                  <p className="text-lg font-medium text-primary">
                    {formatPositions(typedProfile.positions)}
                    {typedProfile.preferred_role && (
                      <span className="text-muted-foreground">
                        {" "}
                        &middot;{" "}
                        {PREFERRED_ROLE_LABELS[typedProfile.preferred_role]}
                      </span>
                    )}
                  </p>
                )}
                {typedProfile.location && (
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {typedProfile.location}
                  </p>
                )}
                {typedProfile.date_of_birth && (
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    {calculateAge(typedProfile.date_of_birth)} years old
                  </p>
                )}
              </div>
            </div>

            {/* Edit Button */}
            <Link href="/player/profile/edit">
              <Button variant="outline">Edit Profile</Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-6">
          {/* Bio */}
          {typedProfile.bio && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">About</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{typedProfile.bio}</p>
              </CardContent>
            </Card>
          )}

          {/* Football Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="h-5 w-5 text-primary" />
                Football Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">Playing Level</p>
                  <p className="font-medium">
                    {typedProfile.playing_level
                      ? PLAYING_LEVEL_LABELS[typedProfile.playing_level]
                      : "Not specified"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Preferred Foot
                  </p>
                  <p className="font-medium">
                    {typedProfile.preferred_foot
                      ? PREFERRED_FOOT_LABELS[typedProfile.preferred_foot]
                      : "Not specified"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Availability</p>
                  <p className="font-medium">
                    {typedProfile.availability
                      ? AVAILABILITY_LABELS[typedProfile.availability]
                      : "Not specified"}
                  </p>
                </div>
                {typedProfile.travel_radius && (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Travel Radius
                    </p>
                    <p className="font-medium">
                      {typedProfile.travel_radius} miles
                    </p>
                  </div>
                )}
              </div>

              {(typedProfile.willing_to_travel ||
                typedProfile.willing_to_relocate) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {typedProfile.willing_to_travel && (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      Willing to Travel
                    </span>
                  )}
                  {typedProfile.willing_to_relocate && (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      Willing to Relocate
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Previous Clubs */}
          {typedProfile.previous_clubs &&
            typedProfile.previous_clubs.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Trophy className="h-5 w-5 text-primary" />
                    Previous Clubs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {typedProfile.previous_clubs.map(
                      (club: PreviousClub, index: number) => (
                        <div
                          key={index}
                          className="border-b pb-4 last:border-b-0 last:pb-0"
                        >
                          <p className="font-medium">{club.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {club.position}
                            {club.startDate &&
                              ` · ${club.startDate}${club.endDate ? ` - ${club.endDate}` : " - Present"}`}
                          </p>
                          {club.achievements && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {club.achievements}
                            </p>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

          {/* Stats */}
          {typedProfile.stats &&
            Object.keys(typedProfile.stats).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Award className="h-5 w-5 text-primary" />
                    Career Stats
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                    {typedProfile.stats.appearances !== undefined && (
                      <div className="text-center">
                        <p className="text-2xl font-bold text-primary">
                          {typedProfile.stats.appearances}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Appearances
                        </p>
                      </div>
                    )}
                    {typedProfile.stats.goals !== undefined && (
                      <div className="text-center">
                        <p className="text-2xl font-bold text-primary">
                          {typedProfile.stats.goals}
                        </p>
                        <p className="text-xs text-muted-foreground">Goals</p>
                      </div>
                    )}
                    {typedProfile.stats.assists !== undefined && (
                      <div className="text-center">
                        <p className="text-2xl font-bold text-primary">
                          {typedProfile.stats.assists}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Assists
                        </p>
                      </div>
                    )}
                    {typedProfile.stats.cleanSheets !== undefined && (
                      <div className="text-center">
                        <p className="text-2xl font-bold text-primary">
                          {typedProfile.stats.cleanSheets}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Clean Sheets
                        </p>
                      </div>
                    )}
                    {typedProfile.stats.manOfTheMatch !== undefined && (
                      <div className="text-center">
                        <p className="text-2xl font-bold text-primary">
                          {typedProfile.stats.manOfTheMatch}
                        </p>
                        <p className="text-xs text-muted-foreground">MOTM</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

          {/* Achievements */}
          {typedProfile.achievements &&
            typedProfile.achievements.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Award className="h-5 w-5 text-primary" />
                    Achievements
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {typedProfile.achievements.map((achievement, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <Trophy className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                        <span>{achievement}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

          {/* Highlight Video */}
          {typedProfile.highlight_video_url && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Video className="h-5 w-5 text-primary" />
                  Highlight Video
                </CardTitle>
              </CardHeader>
              <CardContent>
                <a
                  href={typedProfile.highlight_video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Watch highlight reel →
                </a>
              </CardContent>
            </Card>
          )}

          {/* Preferred Leagues */}
          {typedProfile.preferred_leagues &&
            typedProfile.preferred_leagues.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Globe className="h-5 w-5 text-primary" />
                    Preferred Leagues
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {typedProfile.preferred_leagues.map((league, index) => (
                      <span
                        key={index}
                        className="inline-flex rounded-full bg-secondary px-3 py-1 text-sm"
                      >
                        {league}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

          {/* Compensation */}
          {typedProfile.compensation_expectation && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="h-5 w-5 text-primary" />
                  Compensation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  {typedProfile.compensation_expectation}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}