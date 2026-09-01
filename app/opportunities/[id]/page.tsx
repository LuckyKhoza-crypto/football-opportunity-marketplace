import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { matchPlayerToOpportunity } from "@/lib/matching";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  POSITION_LABELS,
  PLAYING_LEVEL_LABELS,
  AVAILABILITY_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  OPPORTUNITY_STATUS_COLORS,
  type Opportunity,
  type PlayerProfile,
} from "@/types";
import { MatchDetails } from "@/components/marketplace/match-details";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Users,
  DollarSign,
  Shield,
  FileText,
  Star,
  Eye,
} from "lucide-react";

export const metadata = {
  title: "Opportunity Details | Football Opportunity Marketplace",
  description: "View full opportunity details",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Not specified";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function OpportunityDetailPage({ params }: PageProps) {
  const { id } = await params;

  const { data: opportunity, error } = await supabaseAdmin
    .from("opportunities")
    .select(
      `
      *,
      team:team_id (
        id,
        team_name,
        logo_url,
        location,
        league,
        playing_level,
        description,
        website_url
      )
    `,
    )
    .eq("id", id)
    .single();

  if (error || !opportunity) {
    notFound();
  }

  // If the opportunity is not active, redirect to marketplace (don't expose closed/draft)
  if (opportunity.status !== "active") {
    notFound();
  }

  const opp = opportunity as unknown as Opportunity & {
    team: {
      id: string;
      team_name: string;
      logo_url: string | null;
      location: string | null;
      league: string | null;
      playing_level: string | null;
      description: string | null;
      website_url: string | null;
    };
  };

  const positionLabel = opp.position
    ? POSITION_LABELS[opp.position] ?? opp.position
    : "Any Position";

  const levelLabel = opp.playing_level
    ? PLAYING_LEVEL_LABELS[
        opp.playing_level as keyof typeof PLAYING_LEVEL_LABELS
      ] ?? opp.playing_level
    : null;

  const availabilityLabel = opp.availability
    ? AVAILABILITY_LABELS[
        opp.availability as keyof typeof AVAILABILITY_LABELS
      ] ?? opp.availability
    : null;

  // Check if the current user is a player and has a profile, then calculate match
  let playerMatchResult: import("@/lib/matching").MatchResult | null = null;

  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, role")
        .eq("email", session.user.email)
        .single();

      const profileRoles: string[] = profile?.role ?? [];
      if (profileRoles.includes("player") && profile) {
        const { data: playerProfile } = await supabaseAdmin
          .from("player_profiles")
          .select("*")
          .eq("user_id", profile.id)
          .single();

        if (playerProfile) {
          const typedProfile = playerProfile as unknown as PlayerProfile;
          playerMatchResult = matchPlayerToOpportunity(typedProfile, opp);
        }
      }
    }
  } catch (err) {
    // Silently fail - match info is a nice-to-have, not critical
    console.error("Failed to calculate player match:", err);
  }

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

        {/* Personalized Match Banner */}
        {playerMatchResult && (
          <Card className="mb-6 border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/20">
            <CardContent className="p-6">
              <h2 className="mb-3 text-sm font-semibold text-green-700 dark:text-green-300">
                Your Match
              </h2>
              <MatchDetails
                matchResult={playerMatchResult}
                compact
                showBreakdown
                showReasons
                showSuggestions={false}
                showWhyCallout
                completeProfileHref="/player/profile/edit"
              />
            </CardContent>
          </Card>
        )}

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main Content */}
          <div className="space-y-6 lg:col-span-2">
            {/* Opportunity Header */}
            <Card>
              <CardContent className="p-6">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h1 className="mb-2 text-2xl font-bold">{opp.title}</h1>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary">
                        {positionLabel}
                      </span>
                      {opp.role && (
                        <span className="text-sm text-muted-foreground">
                          {opp.role}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {opp.description && (
                  <div className="mt-4">
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <FileText className="h-4 w-4" />
                      Description
                    </h3>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {opp.description}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Player Requirements */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4" />
                  Player Requirements
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(opp.age_min || opp.age_max) && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Age Range
                      </p>
                      <p className="text-sm font-medium">
                        {opp.age_min ?? "Any"} - {opp.age_max ?? "Any"} years
                      </p>
                    </div>
                  )}
                  {levelLabel && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Playing Level
                      </p>
                      <p className="text-sm font-medium">{levelLabel}</p>
                    </div>
                  )}
                  {opp.preferred_foot && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Preferred Foot
                      </p>
                      <p className="text-sm font-medium capitalize">
                        {opp.preferred_foot}
                      </p>
                    </div>
                  )}
                  {opp.formation && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Formation
                      </p>
                      <p className="text-sm font-medium">{opp.formation}</p>
                    </div>
                  )}
                  {opp.secondary_positions &&
                    opp.secondary_positions.length > 0 && (
                      <div className="sm:col-span-2">
                        <p className="text-xs text-muted-foreground">
                          Secondary Positions
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {opp.secondary_positions.map((pos) => (
                            <span
                              key={pos}
                              className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                            >
                              {POSITION_LABELS[pos] ?? pos}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </CardContent>
            </Card>

            {/* Location & Logistics */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4" />
                  Location & Logistics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  {opp.location && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Location
                      </p>
                      <p className="text-sm font-medium">{opp.location}</p>
                    </div>
                  )}
                  {opp.radius && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Travel Radius
                      </p>
                      <p className="text-sm font-medium">
                        {opp.radius} miles
                      </p>
                    </div>
                  )}
                  {opp.travel_requirements && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Travel Requirements
                      </p>
                      <p className="text-sm font-medium">
                        {opp.travel_requirements}
                      </p>
                    </div>
                  )}
                  {opp.housing && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Housing
                      </p>
                      <p className="text-sm font-medium">{opp.housing}</p>
                    </div>
                  )}
                  {opp.visa_requirements && (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-muted-foreground">
                        Visa Requirements
                      </p>
                      <p className="text-sm font-medium">
                        {opp.visa_requirements}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Compensation */}
            {opp.compensation && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <DollarSign className="h-4 w-4" />
                    Compensation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Compensation
                      </p>
                      <p className="text-sm font-medium">
                        {opp.compensation}
                      </p>
                    </div>
                    {opp.contract_length && (
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Contract Length
                        </p>
                        <p className="text-sm font-medium">
                          {opp.contract_length}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Availability */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calendar className="h-4 w-4" />
                  Availability
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  {availabilityLabel && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Available
                      </p>
                      <p className="text-sm font-medium">
                        {availabilityLabel}
                      </p>
                    </div>
                  )}
                  {opp.tryout_date && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Tryout Date
                      </p>
                      <p className="text-sm font-medium">
                        {formatDate(opp.tryout_date)}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Team Info */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" />
                  Team
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                      {opp.team.logo_url ? (
                        <img
                          src={opp.team.logo_url}
                          alt={`${opp.team.team_name} logo`}
                          className="h-12 w-12 rounded-lg object-cover"
                        />
                      ) : (
                        <Users className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="font-semibold">{opp.team.team_name}</p>
                      {levelLabel && (
                        <p className="text-sm text-muted-foreground">
                          {levelLabel}
                          {opp.team.league && (
                            <span> &middot; {opp.team.league}</span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  {opp.team.description && (
                    <p className="text-sm text-muted-foreground">
                      {opp.team.description}
                    </p>
                  )}

                  {opp.team.location && (
                    <p className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      {opp.team.location}
                    </p>
                  )}

                  <Link href={`/teams/${opp.team.id}`}>
                    <Button variant="outline" className="w-full">
                      <Eye className="mr-2 h-4 w-4" />
                      View Team Profile
                    </Button>
                  </Link>

                  {opp.team.website_url && (
                    <a
                      href={opp.team.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-sm text-primary hover:underline"
                    >
                      Visit Team Website
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Opportunity Meta */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Star className="h-4 w-4" />
                  Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      OPPORTUNITY_STATUS_COLORS[opp.status]
                    }`}
                  >
                    {OPPORTUNITY_STATUS_LABELS[opp.status]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Posted</span>
                  <span className="font-medium">
                    {formatDate(opp.created_at)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="font-medium">
                    {formatDate(opp.updated_at)}
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