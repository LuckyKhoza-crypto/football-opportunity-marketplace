import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { matchPlayerToOpportunity } from "@/lib/matching";
import { Suspense } from "react";
import { TeamPlayerDiscoveryClient } from "./TeamPlayerDiscoveryClient";
import type { PlayerProfile, Opportunity } from "@/types";
import { ArrowLeft, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  POSITION_LABELS,
  PLAYING_LEVEL_LABELS,
  OPPORTUNITY_STATUS_LABELS,
} from "@/types";

export default async function TeamOpportunityPlayersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const userRoles = session.user.roles as string[] | undefined;
  if (!userRoles?.includes("team")) {
    redirect("/");
  }

  const { id: opportunityId } = await params;

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

  // Fetch the opportunity and verify ownership
  const { data: opportunity } = await supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("id", opportunityId)
    .eq("team_id", teamProfile.id)
    .single();

  if (!opportunity) {
    redirect("/team/find-players");
  }

  const typedOpportunity = opportunity as unknown as Opportunity;

  // Eligibility filtering — fetch discoverable players
  // Using supabaseAdmin to bypass RLS for the owner check, but the actual
  // discoverable filter is applied in the query
  const { data: playerProfiles, error } = await supabaseAdmin
    .from("player_profiles")
    .select(
      `
      *,
      profile:user_id (
        full_name,
        avatar_url
      )
    `,
    )
    .eq("discoverable", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch player profiles:", error);
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-6xl">
          <ErrorState />
        </div>
      </div>
    );
  }

  // Transform and run matching engine
  const eligiblePlayers = (playerProfiles ?? [])
    .filter((row: Record<string, unknown>) => {
      // Filter out the team owner's own player profile (team owner might also be a player)
      const rowUserId = row.user_id as string;
      return rowUserId !== profile.id;
    })
    .map((row: Record<string, unknown>) => {
      const player = row as unknown as PlayerProfile & {
        profile?: { full_name: string | null; avatar_url: string | null };
      };

      const matchResult = matchPlayerToOpportunity(
        player,
        typedOpportunity,
      );

      return {
        player: {
          ...player,
          full_name: player.profile?.full_name ?? null,
          avatar_url: player.profile?.avatar_url ?? null,
        },
        matchResult,
      };
    })
    .sort((a, b) => b.matchResult.score - a.matchResult.score);

  const positionLabel = typedOpportunity.position
    ? POSITION_LABELS[typedOpportunity.position] ?? typedOpportunity.position
    : "Any Position";
  const levelLabel = typedOpportunity.playing_level
    ? PLAYING_LEVEL_LABELS[
        typedOpportunity.playing_level as keyof typeof PLAYING_LEVEL_LABELS
      ] ?? typedOpportunity.playing_level
    : null;

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-6xl">
        {/* Back */}
        <div className="mb-6">
          <Link href="/team/find-players">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Opportunity Selection
            </Button>
          </Link>
        </div>

        {/* Opportunity Context Header */}
        <div className="mb-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="mb-1 text-3xl font-bold">
                {typedOpportunity.title}
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-sm font-medium text-primary">
                  {positionLabel}
                </span>
                {levelLabel && (
                  <span className="text-sm text-muted-foreground">
                    {levelLabel}
                  </span>
                )}
                {typedOpportunity.location && (
                  <span className="text-sm text-muted-foreground">
                    {typedOpportunity.location}
                  </span>
                )}
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    typedOpportunity.status === "active"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
                  }`}
                >
                  {OPPORTUNITY_STATUS_LABELS[typedOpportunity.status]}
                </span>
              </div>
            </div>
          </div>
          <p className="mt-4 text-lg text-muted-foreground">
            {teamProfile.team_name}
            {" — "}
            Discover players who match this opportunity
          </p>
        </div>

        <Suspense fallback={<PlayersSkeleton />}>
          <TeamPlayerDiscoveryClient
            rankedPlayers={eligiblePlayers}
            totalCount={eligiblePlayers.length}
            opportunityId={opportunityId}
            opportunityStatus={typedOpportunity.status}
            opportunity={typedOpportunity}
          />
        </Suspense>
      </div>
    </div>
  );
}

function PlayersSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
      <div className="flex flex-wrap gap-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-10 w-32 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-80 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <Swords className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="mb-2 text-2xl font-bold">
        Failed to load players.
      </h2>
      <p className="mb-6 max-w-md text-muted-foreground">
        Something went wrong loading player profiles. Please try again.
      </p>
      <Link href="/team/find-players">
        <Button variant="outline">Back to Opportunity Selection</Button>
      </Link>
    </div>
  );
}