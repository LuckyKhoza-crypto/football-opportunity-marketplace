import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { matchPlayerToOpportunity } from "@/lib/matching";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MatchDetails } from "@/components/marketplace/match-details";
import { ApplicationDetailClient } from "./ApplicationDetailClient";
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
  APPLICATION_STATUS_DESCRIPTIONS,
  POSITION_LABELS,
  PLAYING_LEVEL_LABELS,
  AVAILABILITY_LABELS,
  PREFERRED_FOOT_LABELS,
  type ApplicationStatus,
  type PlayerProfile,
  type Opportunity,
} from "@/types";
import {
  ArrowLeft,
  Building,
  MapPin,
  Calendar,
  Clock,
  MessageSquare,
  Swords,
  Shield,
  Star,
  DollarSign,
  FileText,
  AlertCircle,
} from "lucide-react";

export const metadata = {
  title: "Application Details | Football Opportunity Marketplace",
  description: "View your application details",
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

export default async function ApplicationDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  // Fetch the application with full details
  const { data: application, error } = await supabaseAdmin
    .from("applications")
    .select(`
      *,
      opportunity:opportunity_id (
        id,
        title,
        position,
        secondary_positions,
        role,
        formation,
        age_min,
        age_max,
        playing_level,
        league,
        location,
        radius,
        preferred_foot,
        availability,
        compensation,
        housing,
        travel_requirements,
        visa_requirements,
        contract_length,
        tryout_date,
        description,
        status,
        created_at,
        updated_at,
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
      ),
      player_profile:player_profile_id (
        id,
        user_id
      )
    `)
    .eq("id", id)
    .single();

  if (error || !application) {
    notFound();
  }

  // Verify the current user owns this application
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  const { data: playerProfile } = await supabaseAdmin
    .from("player_profiles")
    .select("id")
    .eq("user_id", profile.id)
    .single();

  if (!playerProfile || playerProfile.id !== application.player_profile_id) {
    notFound();
  }

  const appStatus = application.status as ApplicationStatus;
  const statusLabel = APPLICATION_STATUS_LABELS[appStatus] ?? appStatus;
  const statusColor =
    APPLICATION_STATUS_COLORS[appStatus] ?? "bg-gray-100 text-gray-800";
  const statusDescription =
    APPLICATION_STATUS_DESCRIPTIONS[appStatus] ?? "";

  const opp = application.opportunity as unknown as (Opportunity & {
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
  }) | null;

  const positionLabel = opp?.position
    ? POSITION_LABELS[opp.position] ?? opp.position
    : "Any Position";

  const teamPlayingLevel = opp?.team?.playing_level
    ? PLAYING_LEVEL_LABELS[
        opp.team.playing_level as keyof typeof PLAYING_LEVEL_LABELS
      ] ?? opp.team.playing_level
    : null;

  const oppPlayingLevel = opp?.playing_level
    ? PLAYING_LEVEL_LABELS[
        opp.playing_level as keyof typeof PLAYING_LEVEL_LABELS
      ] ?? opp.playing_level
    : null;

  const availability = opp?.availability
    ? AVAILABILITY_LABELS[
        opp.availability as keyof typeof AVAILABILITY_LABELS
      ] ?? opp.availability
    : null;

  const preferredFoot = opp?.preferred_foot
    ? (PREFERRED_FOOT_LABELS[
        opp.preferred_foot as keyof typeof PREFERRED_FOOT_LABELS
      ] ?? opp.preferred_foot)
    : null;

  // Calculate match score
  const { data: fullPlayerProfile } = await supabaseAdmin
    .from("player_profiles")
    .select("*")
    .eq("user_id", profile.id)
    .single();

  let matchResult = null;
  if (fullPlayerProfile && opp) {
    try {
      matchResult = matchPlayerToOpportunity(
        fullPlayerProfile as unknown as PlayerProfile,
        opp,
      );
    } catch {
      // Silently fail
    }
  }

  const canWithdraw = appStatus === "pending" || appStatus === "reviewing";
  const opportunityClosed = opp?.status && opp.status !== "active";

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-4xl">
        {/* Back Link */}
        <Link
          href="/player/applications"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to applications
        </Link>

        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">Application Details</h1>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${statusColor}`}
            >
              {statusLabel}
            </span>
            {opportunityClosed && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                Opportunity Closed
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-8">
          {/* Application Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Application
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {statusDescription}
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Date Submitted</p>
                  <p className="text-sm font-medium">
                    {formatDate(application.created_at)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Updated</p>
                  <p className="text-sm font-medium">
                    {formatDate(application.updated_at)}
                  </p>
                </div>
              </div>

              {application.cover_message && (
                <div>
                  <p className="text-xs text-muted-foreground">
                    Your Application Message
                  </p>
                  <p className="mt-1 rounded-md bg-muted/50 p-3 text-sm">
                    {application.cover_message}
                  </p>
                </div>
              )}

              {/* Withdraw action */}
              {canWithdraw && (
                <ApplicationDetailClient
                  applicationId={application.id}
                  canWithdraw={canWithdraw}
                />
              )}

              {/* Accepted Experience */}
              {appStatus === "accepted" && (
                <div className="rounded-md bg-green-50 p-4 dark:bg-green-950/20">
                  <div className="flex items-start gap-3">
                    <Star className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" />
                    <div>
                      <p className="font-medium text-green-800 dark:text-green-300">
                        Your application was accepted by this team.
                      </p>
                      <p className="mt-1 text-sm text-green-700 dark:text-green-400">
                        No further actions are available at this time.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Rejected Experience */}
              {appStatus === "rejected" && (
                <div className="rounded-md bg-red-50 p-4 dark:bg-red-950/20">
                  <div className="flex items-start gap-3">
                    <MessageSquare className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
                    <div>
                      <p className="font-medium text-red-800 dark:text-red-300">
                        Your application was not selected for this position.
                      </p>
                      <p className="mt-1 text-sm text-red-700 dark:text-red-400">
                        You can continue exploring other opportunities.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Withdrawn Experience */}
              {appStatus === "withdrawn" && (
                <div className="rounded-md bg-gray-50 p-4 dark:bg-gray-900/20">
                  <div className="flex items-start gap-3">
                    <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-600 dark:text-gray-400" />
                    <div>
                      <p className="font-medium text-gray-800 dark:text-gray-300">
                        You withdrew this application. It is no longer active.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Opportunity Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4" />
                Opportunity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Title & Team */}
              <div>
                <h2 className="text-xl font-bold">
                  {opp?.title ?? "Unknown Opportunity"}
                </h2>
                {opp?.team && (
                  <div className="mt-2 flex items-center gap-2">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{opp.team.team_name}</span>
                    {teamPlayingLevel && (
                      <span className="text-sm text-muted-foreground">
                        &middot; {teamPlayingLevel}
                      </span>
                    )}
                    {opp.team.league && (
                      <span className="text-sm text-muted-foreground">
                        &middot; {opp.team.league}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Position & Details */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Position</p>
                  <p className="text-sm font-medium">{positionLabel}</p>
                </div>
                {opp?.role && (
                  <div>
                    <p className="text-xs text-muted-foreground">Role</p>
                    <p className="text-sm font-medium">{opp.role}</p>
                  </div>
                )}
                {opp?.league && (
                  <div>
                    <p className="text-xs text-muted-foreground">League</p>
                    <p className="text-sm font-medium">{opp.league}</p>
                  </div>
                )}
                {oppPlayingLevel && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Playing Level
                    </p>
                    <p className="text-sm font-medium">{oppPlayingLevel}</p>
                  </div>
                )}
                {opp?.location && (
                  <div>
                    <p className="text-xs text-muted-foreground">Location</p>
                    <p className="flex items-center gap-1 text-sm font-medium">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {opp.location}
                    </p>
                  </div>
                )}
                {availability && (
                  <div>
                    <p className="text-xs text-muted-foreground">Availability</p>
                    <p className="text-sm font-medium">{availability}</p>
                  </div>
                )}
                {preferredFoot && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Preferred Foot
                    </p>
                    <p className="text-sm font-medium">{preferredFoot}</p>
                  </div>
                )}
                {opp?.compensation && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Compensation
                    </p>
                    <p className="flex items-center gap-1 text-sm font-medium">
                      <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                      {opp.compensation}
                    </p>
                  </div>
                )}
              </div>

              {/* Secondary Positions */}
              {opp?.secondary_positions &&
                opp.secondary_positions.length > 0 && (
                  <div>
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

              {/* Description */}
              {opp?.description && (
                <div>
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {opp.description}
                  </p>
                </div>
              )}

              {/* Opportunity Closed Notice */}
              {opportunityClosed && (
                <div className="flex items-start gap-2 rounded-md bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-900/20 dark:text-gray-400">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>
                    This opportunity is no longer accepting applications, but
                    your application remains visible in your history.
                  </span>
                </div>
              )}

              {/* Opportunity dates */}
              {opp?.created_at && (
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Posted {formatDate(opp.created_at)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Updated {formatDate(opp.updated_at)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Match Section */}
          {matchResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Swords className="h-4 w-4" />
                  Match
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MatchDetails
                  matchResult={matchResult}
                  showBreakdown
                  showReasons
                  showSuggestions={false}
                  showWhyCallout
                  completeProfileHref="/player/profile/edit"
                />
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-4">
            {opp && (
              <Link href={`/opportunities/${opp.id}`}>
                <Button variant="outline">
                  <Swords className="mr-2 h-4 w-4" />
                  View Opportunity
                </Button>
              </Link>
            )}
            {opp?.team && (
              <Link href={`/teams/${opp.team.id}`}>
                <Button variant="outline">
                  <Building className="mr-2 h-4 w-4" />
                  View Team
                </Button>
              </Link>
            )}
            <Link href="/player/applications">
              <Button variant="ghost">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Applications
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}