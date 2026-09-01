import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OpportunityCard } from "@/components/marketplace/opportunity-card";
import {
  TEAM_PLAYING_LEVEL_LABELS,
  type TeamProfile,
  type Opportunity,
} from "@/types";
import { ArrowLeft, MapPin, Globe, Users, Swords } from "lucide-react";

export const metadata = {
  title: "Team Profile | Football Opportunity Marketplace",
  description: "View team profile and active opportunities",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PublicTeamProfilePage({ params }: PageProps) {
  const { id } = await params;

  // Fetch team profile
  const { data: teamProfile, error: teamError } = await supabaseAdmin
    .from("team_profiles")
    .select("*")
    .eq("id", id)
    .single();

  if (teamError || !teamProfile) {
    notFound();
  }

  const typedTeam = teamProfile as unknown as TeamProfile;

  // Fetch active opportunities for this team
  const { data: opportunities } = await supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("team_id", id)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const typedOpps = (opportunities ?? []) as unknown as Opportunity[];

  const levelLabel = typedTeam.playing_level
    ? TEAM_PLAYING_LEVEL_LABELS[typedTeam.playing_level] ?? typedTeam.playing_level
    : null;

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-4xl">
        {/* Back Link */}
        <Link
          href="/opportunities"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to opportunities
        </Link>

        {/* Team Header */}
        <Card className="mb-8">
          <CardContent className="p-8">
            <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
              <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-xl bg-muted">
                {typedTeam.logo_url ? (
                  <img
                    src={typedTeam.logo_url}
                    alt={`${typedTeam.team_name} logo`}
                    className="h-20 w-20 rounded-xl object-cover"
                  />
                ) : (
                  <Users className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <div>
                <h1 className="mb-1 text-3xl font-bold">
                  {typedTeam.team_name}
                </h1>
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  {levelLabel && (
                    <span className="text-lg text-primary">{levelLabel}</span>
                  )}
                  {typedTeam.league && (
                    <span className="text-lg text-muted-foreground">
                      &middot; {typedTeam.league}
                    </span>
                  )}
                </div>
                {typedTeam.location && (
                  <p className="mt-1 flex items-center justify-center gap-1 text-sm text-muted-foreground sm:justify-start">
                    <MapPin className="h-3.5 w-3.5" />
                    {typedTeam.location}
                  </p>
                )}
              </div>
            </div>

            {typedTeam.description && (
              <div className="mt-6">
                <p className="text-sm text-muted-foreground">
                  {typedTeam.description}
                </p>
              </div>
            )}

            {typedTeam.website_url && (
              <div className="mt-4 flex justify-center sm:justify-start">
                <a
                  href={typedTeam.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <Globe className="h-4 w-4" />
                  Visit Website
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Opportunities */}
        <div>
          <h2 className="mb-4 text-xl font-semibold">
            Active Opportunities ({typedOpps.length})
          </h2>
          {typedOpps.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {typedOpps.map((opp) => (
                <OpportunityCard
                  key={opp.id}
                  opportunity={opp}
                  teamName={typedTeam.team_name}
                  teamLogo={typedTeam.logo_url}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Swords className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">
                  No active opportunities
                </h3>
                <p className="text-sm text-muted-foreground">
                  This team doesn't have any active opportunities right now.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}