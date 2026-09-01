import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";
import {
  calculateTeamProfileCompleteness,
} from "@/lib/team-profile";
import {
  TEAM_PLAYING_LEVEL_LABELS,
  type TeamProfile,
  type Opportunity,
} from "@/types";
import { MapPin, Users, Trophy, Plus, ArrowRight, Swords, Search } from "lucide-react";

export default async function TeamDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const userRoles = session.user.roles as string[] | undefined;
  if (!userRoles || userRoles.length === 0) {
    redirect("/onboarding");
  }
  if (!userRoles.includes("team")) {
    if (userRoles.includes("player")) {
      redirect("/player");
    }
    redirect("/onboarding");
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  const { data: teamProfile } = await supabaseAdmin
    .from("team_profiles")
    .select("*")
    .eq("user_id", profile.id)
    .single();

  // If no team profile exists, redirect to onboarding
  if (!teamProfile) {
    redirect("/team/onboarding");
  }

  const typedProfile = teamProfile as unknown as TeamProfile;
  const completeness = calculateTeamProfileCompleteness(typedProfile);
  const isComplete = completeness.percentage >= 100;

  // Fetch opportunities
  const { data: opportunities } = await supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("team_id", teamProfile.id);

  const typedOpps = (opportunities ?? []) as unknown as Opportunity[];
  const activeCount = typedOpps.filter((o) => o.status === "active").length;
  const draftCount = typedOpps.filter((o) => o.status === "draft").length;
  const closedCount = typedOpps.filter((o) => o.status === "closed").length;

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-4xl">
        {/* Welcome Header */}
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">
            Welcome, {profile.full_name || "Team"}
          </h1>
          <p className="text-lg text-muted-foreground">Your Team Dashboard</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Profile Card */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Your Team</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                  {/* Logo */}
                  <div className="flex-shrink-0">
                    {typedProfile.logo_url ? (
                      <img
                        src={typedProfile.logo_url}
                        alt={`${typedProfile.team_name} logo`}
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
                      {typedProfile.team_name}
                    </h2>
                    {typedProfile.playing_level && (
                      <p className="text-lg font-medium text-primary">
                        {TEAM_PLAYING_LEVEL_LABELS[typedProfile.playing_level]}
                        {typedProfile.league && (
                          <span className="text-muted-foreground">
                            {" "}
                            &middot;{" "}
                            {typedProfile.league}
                          </span>
                        )}
                      </p>
                    )}
                    <div className="mt-2 space-y-1">
                      {typedProfile.location && (
                        <p className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          {typedProfile.location}
                        </p>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link href="/team/profile">
                        <Button variant="outline" size="sm">
                          View Full Profile
                        </Button>
                      </Link>
                      <Link href="/team/profile/edit">
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
                      <Link href="/team/profile/edit">
                        <Button size="sm">
                          <Users className="mr-1 h-4 w-4" /> Complete Profile
                        </Button>
                      </Link>
                    </div>
                  </div>
                )}

                {isComplete && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-primary">
                      Your team profile is complete! Players can now discover you.
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
                <Link href="/team/profile">
                  <Button variant="outline" className="w-full justify-start">
                    <Trophy className="mr-2 h-4 w-4" />
                    View Team Profile
                  </Button>
                </Link>
                <Link href="/team/profile/edit">
                  <Button variant="outline" className="w-full justify-start">
                    <Users className="mr-2 h-4 w-4" />
                    Edit Profile
                  </Button>
                </Link>
                <Link href="/team/opportunities/new">
                  <Button variant="default" className="w-full justify-start">
                    <Plus className="mr-2 h-4 w-4" />
                    Post an Opportunity
                  </Button>
                </Link>
                <Link href="/team/find-players">
                  <Button variant="default" className="w-full justify-start">
                    <Search className="mr-2 h-4 w-4" />
                    Find Players
                  </Button>
                </Link>
                <Link href="/team/opportunities">
                  <Button variant="outline" className="w-full justify-start">
                    <Swords className="mr-2 h-4 w-4" />
                    View Opportunities
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Opportunities Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Your Opportunities</CardTitle>
              </CardHeader>
              <CardContent>
                {typedOpps.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                        Active
                      </span>
                      <span className="font-bold">{activeCount}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-yellow-500" />
                        Drafts
                      </span>
                      <span className="font-bold">{draftCount}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-gray-400" />
                        Closed
                      </span>
                      <span className="font-bold">{closedCount}</span>
                    </div>
                    {/* Active opportunity match links */}
                    {activeCount > 0 && (
                      <div className="border-t pt-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          Find players for:
                        </p>
                        <div className="space-y-2">
                          {typedOpps
                            .filter((o) => o.status === "active")
                            .slice(0, 3)
                            .map((opp) => (
                              <Link
                                key={opp.id}
                                href={`/team/opportunities/${opp.id}/players`}
                                className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm transition-colors hover:bg-muted"
                              >
                                <span className="truncate font-medium">
                                  {opp.title}
                                </span>
                                <Search className="ml-2 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                              </Link>
                            ))}
                          {activeCount > 3 && (
                            <Link
                              href="/team/find-players"
                              className="block text-xs text-primary hover:underline"
                            >
                              View all {activeCount} active opportunities
                            </Link>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="pt-2">
                      <Link href="/team/opportunities">
                        <Button variant="outline" size="sm" className="w-full">
                          <ArrowRight className="mr-2 h-4 w-4" />
                          View All Opportunities
                        </Button>
                      </Link>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      No opportunities yet. Post your first opportunity to start
                      finding players.
                    </p>
                    <div className="mt-4">
                      <Link href="/team/opportunities/new">
                        <Button variant="outline" className="w-full">
                          <Plus className="mr-2 h-4 w-4" />
                          Post an Opportunity
                        </Button>
                      </Link>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Profile Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Level</span>
                  <span className="font-medium">
                    {typedProfile.playing_level
                      ? TEAM_PLAYING_LEVEL_LABELS[typedProfile.playing_level]
                      : "Not set"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">League</span>
                  <span className="font-medium">
                    {typedProfile.league || "Not set"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location</span>
                  <span className="font-medium">
                    {typedProfile.location || "Not set"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Contact</span>
                  <span className="font-medium">
                    {typedProfile.contact_name || "Not set"}
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