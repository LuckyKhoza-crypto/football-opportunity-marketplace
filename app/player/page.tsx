import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { matchPlayerToOpportunity } from "@/lib/matching";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";
import {
  calculateProfileCompleteness,
} from "@/lib/player-profile";
import {
  PLAYING_LEVEL_LABELS,
  PREFERRED_FOOT_LABELS,
  AVAILABILITY_LABELS,
  type PlayerProfile,
  type Position,
  type Opportunity,
} from "@/types";
import { MapPin, Target, Users, ArrowRight, UserPlus, Swords } from "lucide-react";

function formatPositions(positions: Position[]): string {
  return positions.join(" / ");
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  excellent:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  strong:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  possible:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  weak: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  poor: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  excellent: "Excellent Match",
  strong: "Strong Match",
  possible: "Possible Match",
  weak: "Weak Match",
  poor: "Poor Match",
};

export default async function PlayerDashboardPage() {
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
    // If user has team role but not player, redirect to team
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

  // If no player profile exists, redirect to onboarding
  if (!playerProfile) {
    redirect("/player/onboarding");
  }

  const typedProfile = playerProfile as unknown as PlayerProfile;
  const completeness = calculateProfileCompleteness(typedProfile);
  const isComplete = completeness.percentage >= 100;

  // Fetch top 3 recommendations for the dashboard preview
  let topRecommendations: { teamName: string; score: number; classification: string; opportunityId: string }[] = [];

  try {
    const { data: opportunities } = await supabaseAdmin
      .from("opportunities")
      .select(
        `
        id,
        title,
        team:team_id (
          team_name
        )
      `,
      )
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (opportunities && opportunities.length > 0) {
      const typedOpps = opportunities as unknown as (Opportunity & {
        team: { team_name: string };
      })[];

      const ranked = typedOpps
        .map((opp) => {
          const matchResult = matchPlayerToOpportunity(typedProfile, opp);
          return {
            teamName: opp.team?.team_name ?? "Unknown Team",
            score: matchResult.score,
            classification: matchResult.classification,
            opportunityId: opp.id,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      topRecommendations = ranked;
    }
  } catch (err) {
    console.error("Failed to fetch recommendations for dashboard:", err);
  }

  const strongMatchCount = topRecommendations.filter(
    (r) => r.score >= 75,
  ).length;

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-4xl">
        {/* Welcome Header */}
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">
            Welcome, {profile.full_name || "Player"}
          </h1>
          <p className="text-lg text-muted-foreground">Your Player Dashboard</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Profile Card */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Your Player Profile</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                  {/* Photo */}
                  <div className="flex-shrink-0">
                    {typedProfile.profile_photo_url ? (
                      <img
                        src={typedProfile.profile_photo_url}
                        alt="Profile"
                        className="h-24 w-24 rounded-xl object-cover ring-2 ring-primary/20"
                      />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted">
                        <Users className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1">
                    <h2 className="text-xl font-bold">
                      {profile.full_name || "Player"}
                    </h2>
                    {typedProfile.positions &&
                      typedProfile.positions.length > 0 && (
                        <p className="text-lg font-medium text-primary">
                          {formatPositions(typedProfile.positions)}
                        </p>
                      )}
                    <div className="mt-2 space-y-1">
                      {typedProfile.playing_level && (
                        <p className="text-sm text-muted-foreground">
                          {PLAYING_LEVEL_LABELS[typedProfile.playing_level]}
                        </p>
                      )}
                      {typedProfile.location && (
                        <p className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          {typedProfile.location}
                        </p>
                      )}
                      {typedProfile.availability && (
                        <p className="text-sm text-muted-foreground">
                          {AVAILABILITY_LABELS[typedProfile.availability]}
                        </p>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link href="/player/profile">
                        <Button variant="outline" size="sm">
                          View Full Profile
                        </Button>
                      </Link>
                      <Link href="/player/profile/edit">
                        <Button variant="outline" size="sm">
                          Edit Profile
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Profile Completeness */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Profile Completeness</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {completeness.completedFields} of {completeness.totalFields}{" "}
                    fields completed
                  </span>
                  <span className="text-2xl font-bold text-primary">
                    {completeness.percentage}%
                  </span>
                </div>
                <Progress value={completeness.percentage} className="h-3" />

                {!isComplete && completeness.missingFields.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-sm font-medium text-muted-foreground">
                      Missing information:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {completeness.missingFields.map((field) => (
                        <span
                          key={field}
                          className="inline-flex items-center rounded-full bg-destructive/10 px-3 py-1 text-xs text-destructive"
                        >
                          {field}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4">
                      <Link href="/player/profile/edit">
                        <Button size="sm">
                          <UserPlus className="mr-1 h-4 w-4" /> Complete Profile
                        </Button>
                      </Link>
                    </div>
                  </div>
                )}

                {isComplete && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-primary">
                      Your profile is complete! Teams can now discover you.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Link href="/player/profile">
                  <Button variant="outline" className="w-full justify-start">
                    <Target className="mr-2 h-4 w-4" />
                    View Profile
                  </Button>
                </Link>
                <Link href="/player/profile/edit">
                  <Button variant="outline" className="w-full justify-start">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Edit Profile
                  </Button>
                </Link>
                <Link href="/player/find-team">
                  <Button
                    variant="default"
                    className="w-full justify-start"
                  >
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Find a Team
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Top Recommendations Preview */}
            {topRecommendations.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Swords className="h-4 w-4" />
                    Find Your Next Team
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {strongMatchCount > 0 && (
                    <p className="mb-3 text-sm text-muted-foreground">
                      {strongMatchCount} strong{" "}
                      {strongMatchCount === 1 ? "match" : "matches"} found.
                    </p>
                  )}
                  <div className="space-y-3">
                    {topRecommendations.map((rec) => {
                      const colorClass =
                        CLASSIFICATION_COLORS[rec.classification] ??
                        "bg-muted text-muted-foreground";
                      const label =
                        CLASSIFICATION_LABELS[rec.classification] ??
                        rec.classification;
                      return (
                        <Link
                          key={rec.opportunityId}
                          href={`/opportunities/${rec.opportunityId}`}
                          className="block rounded-lg border p-3 transition-colors hover:bg-accent"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                              {rec.teamName}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${colorClass}`}
                            >
                              {rec.score}%
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {label}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                  <div className="mt-3">
                    <Link href="/player/find-team">
                      <Button variant="outline" size="sm" className="w-full">
                        View All Matches
                        <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Profile Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Positions</span>
                  <span className="font-medium">
                    {typedProfile.positions?.length
                      ? formatPositions(typedProfile.positions)
                      : "Not set"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Level</span>
                  <span className="font-medium">
                    {typedProfile.playing_level
                      ? PLAYING_LEVEL_LABELS[typedProfile.playing_level]
                      : "Not set"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Foot</span>
                  <span className="font-medium">
                    {typedProfile.preferred_foot
                      ? PREFERRED_FOOT_LABELS[typedProfile.preferred_foot]
                      : "Not set"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Availability</span>
                  <span className="font-medium">
                    {typedProfile.availability
                      ? AVAILABILITY_LABELS[typedProfile.availability]
                      : "Not set"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Clubs</span>
                  <span className="font-medium">
                    {typedProfile.previous_clubs?.length || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Achievements</span>
                  <span className="font-medium">
                    {typedProfile.achievements?.length || 0}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}