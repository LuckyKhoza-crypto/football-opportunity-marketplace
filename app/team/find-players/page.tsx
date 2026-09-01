import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import {
  POSITION_LABELS,
  PLAYING_LEVEL_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  type Opportunity,
} from "@/types";
import { Plus, MapPin, Swords, Users, Search } from "lucide-react";

export default async function TeamFindPlayersPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const userRoles = session.user.roles as string[] | undefined;
  if (!userRoles?.includes("team")) {
    redirect("/");
  }

  // Fetch profile
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  // Fetch team profile
  const { data: teamProfile } = await supabaseAdmin
    .from("team_profiles")
    .select("*")
    .eq("user_id", profile.id)
    .single();

  if (!teamProfile) {
    redirect("/team/onboarding");
  }

  // Fetch this team's opportunities
  const { data: opportunities } = await supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("team_id", teamProfile.id)
    .order("created_at", { ascending: false });

  const typedOpps = (opportunities ?? []) as unknown as Opportunity[];
  const activeOpps = typedOpps.filter((o) => o.status === "active");
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">Find Players</h1>
          <p className="text-lg text-muted-foreground">
            Discover players looking for team opportunities
          </p>
        </div>

        {/* Browse All Players Option */}
        <Card className="mb-8 border-2 border-dashed border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col items-center py-8 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Search className="h-7 w-7 text-primary" />
            </div>
            <h2 className="mb-2 text-2xl font-bold">Browse All Players</h2>
            <p className="mb-6 max-w-md text-muted-foreground">
              See every discoverable player without linking to a specific
              opportunity. Filter by position, level, location, and more.
            </p>
            <Link href="/team/players">
              <Button size="lg" variant="default">
                <Search className="mr-2 h-5 w-5" />
                Browse All Players
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Divider */}
        <div className="relative mb-8">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or find players for a specific opportunity
            </span>
          </div>
        </div>

        {/* No active opportunities */}
        {activeOpps.length === 0 && typedOpps.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Swords className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="mb-2 text-2xl font-bold">
                Create an opportunity first
              </h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                You need to post an opportunity before you can discover players
                who match your requirements.
              </p>
              <Link href="/team/opportunities/new">
                <Button size="lg">
                  <Plus className="mr-2 h-5 w-5" />
                  Post an Opportunity
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* No active opportunities but have drafts/closed */}
        {activeOpps.length === 0 && typedOpps.length > 0 && (
          <Card>
            <CardContent className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="mb-2 text-2xl font-bold">
                No active opportunities
              </h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                You have opportunities, but none are currently active. Activate
                an opportunity or create a new one to start finding players.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/team/opportunities">
                  <Button variant="outline">View Opportunities</Button>
                </Link>
                <Link href="/team/opportunities/new">
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Post an Opportunity
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Active opportunities list */}
        {activeOpps.length > 1 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select an opportunity to find matching players:
            </p>
            {activeOpps.map((opp) => {
              const positionLabel = opp.position
                ? POSITION_LABELS[opp.position] ?? opp.position
                : "Any Position";
              const levelLabel = opp.playing_level
                ? PLAYING_LEVEL_LABELS[
                    opp.playing_level as keyof typeof PLAYING_LEVEL_LABELS
                  ] ?? opp.playing_level
                : null;
              return (
                <Link
                  key={opp.id}
                  href={`/team/opportunities/${opp.id}/players`}
                  className="block"
                >
                  <Card className="transition-shadow hover:shadow-md cursor-pointer">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-lg font-bold">{opp.title}</h3>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-sm font-medium text-primary">
                              {positionLabel}
                            </span>
                            {levelLabel && (
                              <span className="text-sm text-muted-foreground">
                                {levelLabel}
                              </span>
                            )}
                            {opp.location && (
                              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                                <MapPin className="h-3.5 w-3.5" />
                                {opp.location}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                          {OPPORTUNITY_STATUS_LABELS[opp.status]}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}