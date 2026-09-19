import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { matchPlayerToOpportunity } from "@/lib/matching";
import { HomeClient } from "./home-client";
import type { PlayerProfile, Opportunity, TeamProfile } from "@/types";

interface OpportunityWithTeam extends Opportunity {
  team: { team_name: string; logo_url: string | null; location: string | null; league: string | null; playing_level: string | null } | null;
}

async function getLatestOpportunities() {
  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .select(`
      *,
      team:team_id (
        team_name,
        logo_url,
        location,
        league,
        playing_level
      )
    `)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(6);

  if (error) {
    console.error("Failed to fetch latest opportunities:", error);
    return [];
  }

  return (data ?? []) as unknown as OpportunityWithTeam[];
}

async function getPlayerRecommendations(
  playerProfile: PlayerProfile,
  limit = 4,
) {
  try {
    const { data: opportunities } = await supabaseAdmin
      .from("opportunities")
      .select(`
        *,
        team:team_id (
          team_name,
          logo_url,
          location,
          league,
          playing_level
        )
      `)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (!opportunities || opportunities.length === 0) return [];

    const typedOpps = opportunities as unknown as OpportunityWithTeam[];

    const ranked = typedOpps
      .map((opp) => {
        const matchResult = matchPlayerToOpportunity(playerProfile, opp);
        return {
          ...opp,
          matchScore: matchResult.score,
          matchClassification: matchResult.classification,
        };
      })
      .filter((opp) => opp.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);

    return ranked;
  } catch (err) {
    console.error("Failed to fetch recommendations:", err);
    return [];
  }
}

async function getTeamPlayerRecommendations(
  teamProfile: TeamProfile,
  limit = 4,
) {
  try {
    const { data: players } = await supabaseAdmin
      .from("player_profiles")
      .select("*");

    if (!players || players.length === 0) return [];

    const typedPlayers = players as unknown as PlayerProfile[];

    // Get the team's active opportunities for matching context
    const { data: teamOpps } = await supabaseAdmin
      .from("opportunities")
      .select("*")
      .eq("team_id", teamProfile.id)
      .eq("status", "active");

    const opportunities = (teamOpps ?? []) as unknown as Opportunity[];

    if (opportunities.length === 0) {
      // No active opportunities — return players sorted by location/level match
      const scored = typedPlayers.map((player) => {
        let score = 50;
        const reasons: string[] = [];
        const mismatches: string[] = [];

        if (player.location && teamProfile.location) {
          if (
            player.location.toLowerCase().includes(teamProfile.location.toLowerCase()) ||
            teamProfile.location.toLowerCase().includes(player.location.toLowerCase())
          ) {
            score += 20;
            reasons.push("Location match");
          } else {
            mismatches.push("Location mismatch");
          }
        }

        if (player.playing_level && teamProfile.playing_level) {
          if (player.playing_level === teamProfile.playing_level) {
            score += 20;
            reasons.push("Playing level match");
          } else {
            mismatches.push("Playing level mismatch");
          }
        }

        return {
          player,
          matchScore: Math.min(100, score),
          matchClassification: score >= 80 ? "excellent" as const : score >= 60 ? "strong" as const : score >= 40 ? "possible" as const : "weak" as const,
        };
      })
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, limit);

      return scored;
    }

    // Use the first active opportunity for matching
    const primaryOpp = opportunities[0];
    const scored = typedPlayers.map((player) => {
      const matchResult = matchPlayerToOpportunity(player, primaryOpp);
      return {
        player,
        matchScore: matchResult.score,
        matchClassification: matchResult.classification,
      };
    })
      .filter((r) => r.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);

    return scored;
  } catch (err) {
    console.error("Failed to fetch team recommendations:", err);
    return [];
  }
}

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const isAuthenticated = !!session?.user;

  // Fetch latest opportunities for all users
  const latestOpportunities = await getLatestOpportunities();

  // Authenticated user data
  let userRoles: string[] = [];
  let profile: { id: string; full_name: string | null } | null = null;
  let playerProfile: PlayerProfile | null = null;
  let teamProfile: TeamProfile | null = null;
  let playerRecommendations: (OpportunityWithTeam & { matchScore: number; matchClassification: string })[] = [];
  let teamPlayerRecommendations: { player: PlayerProfile; matchScore: number; matchClassification: string }[] = [];

  if (isAuthenticated) {
    userRoles = (session.user.roles as string[] | undefined) ?? [];

    if (userRoles.length > 0) {
      const { data: profileData } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .eq("email", session.user.email)
        .single();

      if (profileData) {
        profile = profileData;

        if (userRoles.includes("player")) {
          const { data: pProfile } = await supabaseAdmin
            .from("player_profiles")
            .select("*")
            .eq("user_id", profileData.id)
            .single();

          if (pProfile) {
            playerProfile = pProfile as unknown as PlayerProfile;
            playerRecommendations = await getPlayerRecommendations(playerProfile);
          }
        }

        if (userRoles.includes("team")) {
          const { data: tProfile } = await supabaseAdmin
            .from("team_profiles")
            .select("*")
            .eq("user_id", profileData.id)
            .single();

          if (tProfile) {
            teamProfile = tProfile as unknown as TeamProfile;
            teamPlayerRecommendations = await getTeamPlayerRecommendations(teamProfile);
          }
        }
      }
    }
  }

  return (
    <HomeClient
      isAuthenticated={isAuthenticated}
      userRoles={userRoles}
      profileName={profile?.full_name ?? null}
      hasPlayerProfile={!!playerProfile}
      hasTeamProfile={!!teamProfile}
      latestOpportunities={latestOpportunities.map((opp) => ({
        id: opp.id,
        title: opp.title,
        position: opp.position,
        playing_level: opp.playing_level,
        league: opp.league,
        location: opp.location,
        compensation: opp.compensation,
        tryout_date: opp.tryout_date,
        role: opp.role,
        team_name: opp.team?.team_name ?? null,
        team_logo: opp.team?.logo_url ?? null,
        created_at: opp.created_at,
        status: opp.status,
        team_id: opp.team_id,
      }))}
      playerRecommendations={playerRecommendations.map((rec) => ({
        id: rec.id,
        title: rec.title,
        position: rec.position,
        playing_level: rec.playing_level,
        league: rec.league,
        location: rec.location,
        compensation: rec.compensation,
        tryout_date: rec.tryout_date,
        role: rec.role,
        team_name: rec.team?.team_name ?? null,
        team_logo: rec.team?.logo_url ?? null,
        created_at: rec.created_at,
        status: rec.status,
        team_id: rec.team_id,
        matchScore: rec.matchScore,
        matchClassification: rec.matchClassification,
      }))}
      teamPlayerRecommendations={teamPlayerRecommendations.map((rec) => ({
        id: rec.player.id,
        full_name: null,
        positions: rec.player.positions,
        location: rec.player.location,
        playing_level: rec.player.playing_level,
        matchScore: rec.matchScore,
        matchClassification: rec.matchClassification,
      }))}
    />
  );
}