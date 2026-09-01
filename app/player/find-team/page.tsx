import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { matchPlayerToOpportunity } from "@/lib/matching";
import { Suspense } from "react";
import { FindTeamClient } from "./find-team-client";
import type { PlayerProfile, Opportunity } from "@/types";

export const metadata = {
  title: "Find Me a Team | Football Opportunity Marketplace",
  description:
    "Discover football opportunities that match your profile.",
};

async function getLeagues(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("opportunities")
    .select("league")
    .eq("status", "active")
    .not("league", "is", null)
    .order("league");

  const unique = new Set<string>();
  data?.forEach((r) => {
    if (r.league) unique.add(r.league);
  });
  return Array.from(unique).sort();
}

export default async function FindTeamPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  // Fetch profile to check roles
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  const profileRoles: string[] = profile.role ?? [];
  if (!profileRoles.includes("player")) {
    redirect("/");
  }

  // Fetch player profile
  const { data: playerProfile } = await supabaseAdmin
    .from("player_profiles")
    .select("*")
    .eq("user_id", profile.id)
    .single();

  // If no player profile exists, redirect to onboarding
  if (!playerProfile) {
    redirect("/player/onboarding");
  }

  const typedPlayerProfile = playerProfile as unknown as PlayerProfile;

  // Determine if important fields are missing
  const missingImportantFields =
    !typedPlayerProfile.positions?.length ||
    !typedPlayerProfile.playing_level ||
    !typedPlayerProfile.location ||
    !typedPlayerProfile.availability;

  // Get profile completeness details for suggestions
  const matchingMissingFields = [];
  if (!typedPlayerProfile.positions?.length) matchingMissingFields.push("Position");
  if (!typedPlayerProfile.playing_level) matchingMissingFields.push("Playing level");
  if (!typedPlayerProfile.location) matchingMissingFields.push("Location");
  if (!typedPlayerProfile.availability) matchingMissingFields.push("Availability");
  if (!typedPlayerProfile.date_of_birth) matchingMissingFields.push("Date of birth");
  if (!typedPlayerProfile.preferred_foot) matchingMissingFields.push("Preferred foot");
  if (!typedPlayerProfile.preferred_leagues?.length) matchingMissingFields.push("League preferences");

  // Fetch all active opportunities with team info (single query)
  const { data: opportunities, error } = await supabaseAdmin
    .from("opportunities")
    .select(
      `
      *,
      team:team_id (
        team_name,
        logo_url,
        location,
        league,
        playing_level
      )
    `,
    )
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch opportunities:", error);
    const leagues = await getLeagues();
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <h1 className="mb-2 text-3xl font-bold">Find Me a Team</h1>
            <p className="text-lg text-muted-foreground">
              Discover football opportunities that match your profile.
            </p>
          </div>
          <Suspense fallback={<FindTeamSkeleton />}>
            <FindTeamClient
              rankedOpportunities={[]}
              totalCount={0}
              error={true}
              leagues={leagues}
              playerProfileComplete={true}
              missingImportantFields={false}
              missingFields={[]}
              playerProfile={typedPlayerProfile}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  const typedOpportunities = (opportunities ?? []) as unknown as (Opportunity & {
    team: {
      team_name: string;
      logo_url: string | null;
      location: string | null;
      league: string | null;
      playing_level: string | null;
    };
  })[];

  // Run matching engine for each opportunity
  const rankedOpportunities = typedOpportunities
    .map((opp) => {
      const matchResult = matchPlayerToOpportunity(
        typedPlayerProfile,
        opp,
      );
      return {
        opportunity: {
          ...opp,
          team_name: opp.team?.team_name ?? null,
          team_logo: opp.team?.logo_url ?? null,
        },
        matchResult,
      };
    })
    .sort((a, b) => b.matchResult.score - a.matchResult.score);

  const leagues = await getLeagues();

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">Find Me a Team</h1>
          <p className="text-lg text-muted-foreground">
            Discover football opportunities that match your profile.
          </p>
        </div>

        <Suspense fallback={<FindTeamSkeleton />}>
          <FindTeamClient
            rankedOpportunities={rankedOpportunities}
            totalCount={typedOpportunities.length}
            error={false}
            leagues={leagues}
            playerProfileComplete={!missingImportantFields}
            missingImportantFields={missingImportantFields}
            missingFields={matchingMissingFields}
            playerProfile={typedPlayerProfile}
          />
        </Suspense>
      </div>
    </div>
  );
}

function FindTeamSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
      <div className="flex flex-wrap gap-2">
        {[...Array(5)].map((_, i) => (
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