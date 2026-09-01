import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { matchPlayerToOpportunity } from "@/lib/matching";
import type { PlayerProfile, Opportunity } from "@/types";
import type { MatchQuality } from "@/lib/matching";

// POST /api/applications — Submit a new application
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { opportunity_id, cover_message } = body;

    if (!opportunity_id) {
      return NextResponse.json(
        { error: "opportunity_id is required" },
        { status: 400 },
      );
    }

    // Verify the user has a player role
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    const roles: string[] = profile?.role ?? [];
    if (!roles.includes("player")) {
      return NextResponse.json(
        { error: "User does not have player capability" },
        { status: 403 },
      );
    }

    // Get the player profile for this user
    const { data: playerProfile } = await supabaseAdmin
      .from("player_profiles")
      .select("id")
      .eq("user_id", session.user.id)
      .single();

    if (!playerProfile) {
      return NextResponse.json(
        { error: "Player profile not found. Please complete your player profile first." },
        { status: 400 },
      );
    }

    // Verify the opportunity exists and is active
    const { data: opportunity } = await supabaseAdmin
      .from("opportunities")
      .select("id, team_id, status")
      .eq("id", opportunity_id)
      .single();

    if (!opportunity) {
      return NextResponse.json(
        { error: "Opportunity not found" },
        { status: 404 },
      );
    }

    if (opportunity.status !== "active") {
      return NextResponse.json(
        { error: "This opportunity is no longer accepting applications" },
        { status: 400 },
      );
    }

    // Prevent applying to own team's opportunity
    const { data: teamProfile } = await supabaseAdmin
      .from("team_profiles")
      .select("user_id")
      .eq("id", opportunity.team_id)
      .single();

    if (teamProfile && teamProfile.user_id === session.user.id) {
      return NextResponse.json(
        { error: "You cannot apply to your own team's opportunity" },
        { status: 403 },
      );
    }

    // Check for existing application (duplicate prevention)
    const { data: existingApp } = await supabaseAdmin
      .from("applications")
      .select("id, status")
      .eq("opportunity_id", opportunity_id)
      .eq("player_profile_id", playerProfile.id)
      .maybeSingle();

    if (existingApp) {
      return NextResponse.json(
        { error: "You have already applied to this opportunity", existingStatus: existingApp.status },
        { status: 409 },
      );
    }

    // Create the application
    const { data: application, error: insertError } = await supabaseAdmin
      .from("applications")
      .insert({
        opportunity_id,
        player_profile_id: playerProfile.id,
        cover_message: cover_message?.trim() || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to create application:", insertError);
      return NextResponse.json(
        { error: "Failed to submit application" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, application }, { status: 201 });
  } catch (err) {
    console.error("Application creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// GET /api/applications — List applications (player or team context)
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const context = searchParams.get("context") || "player"; // "player" or "team"
    const statusFilter = searchParams.get("status"); // optional filter
    const opportunityFilter = searchParams.get("opportunity_id"); // filter by opportunity
    const positionFilter = searchParams.get("position"); // filter by position
    const matchQualityFilter = searchParams.get("match_quality"); // filter by match quality
    const sortBy = searchParams.get("sort") || "newest"; // newest, oldest, highest_match, lowest_match

    if (context === "player") {
      // Player viewing their own applications
      const { data: playerProfile } = await supabaseAdmin
        .from("player_profiles")
        .select("id, positions, playing_level, location, date_of_birth, availability, willing_to_travel, willing_to_relocate, travel_radius, preferred_foot, preferred_leagues")
        .eq("user_id", session.user.id)
        .single();

      if (!playerProfile) {
        return NextResponse.json(
          { error: "Player profile not found" },
          { status: 404 },
        );
      }

      let query = supabaseAdmin
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
          )
        `)
        .eq("player_profile_id", playerProfile.id)
        .order("created_at", { ascending: false });

      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }

      const { data: applications, error } = await query;

      if (error) {
        console.error("Failed to fetch applications:", error);
        return NextResponse.json(
          { error: "Failed to fetch applications" },
          { status: 500 },
        );
      }

      // Calculate match scores for each application
      const applicationsWithMatches = await Promise.all(
        (applications ?? []).map(async (app) => {
          try {
            const opportunity = app.opportunity as unknown as Opportunity | null;
            if (playerProfile && opportunity) {
              const typedProfile = playerProfile as unknown as PlayerProfile;
              const matchResult = matchPlayerToOpportunity(typedProfile, opportunity);
              return { ...app, match_result: matchResult };
            }
          } catch {
            // Silently fail match calculation
          }
          return { ...app, match_result: null };
        }),
      );

      // Apply sorting
      const sortField = sortBy || "newest";
      applicationsWithMatches.sort((a, b) => {
        switch (sortField) {
          case "oldest":
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          case "highest_match":
            return (b.match_result?.score ?? 0) - (a.match_result?.score ?? 0);
          case "lowest_match":
            return (a.match_result?.score ?? 0) - (b.match_result?.score ?? 0);
          case "newest":
          default:
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
      });

      return NextResponse.json({ applications: applicationsWithMatches ?? [] });
    } else if (context === "team") {
      // Team viewing applications for their opportunities
      const { data: teamProfile } = await supabaseAdmin
        .from("team_profiles")
        .select("id")
        .eq("user_id", session.user.id)
        .single();

      if (!teamProfile) {
        return NextResponse.json(
          { error: "Team profile not found" },
          { status: 404 },
        );
      }

      // Get all opportunities owned by this team
      let oppQuery = supabaseAdmin
        .from("opportunities")
        .select("id, title, position, playing_level, location, status, created_at")
        .eq("team_id", teamProfile.id);

      if (opportunityFilter) {
        oppQuery = oppQuery.eq("id", opportunityFilter);
      }

      const { data: teamOpportunities } = await oppQuery;

      const opportunityIds = (teamOpportunities ?? []).map((o) => o.id);

      if (opportunityIds.length === 0) {
        return NextResponse.json({ applications: [], opportunities: teamOpportunities ?? [] });
      }

      let query = supabaseAdmin
        .from("applications")
        .select(`
          *,
          opportunity:opportunity_id (
            id,
            title,
            position,
            secondary_positions,
            role,
            playing_level,
            league,
            location,
            radius,
            preferred_foot,
            availability,
            compensation,
            status,
            created_at
          ),
          player_profile:player_profile_id (
            id,
            user_id,
            profile_photo_url,
            date_of_birth,
            location,
            positions,
            preferred_role,
            playing_level,
            preferred_foot,
            availability,
            willing_to_travel,
            willing_to_relocate,
            travel_radius,
            compensation_expectation,
            previous_clubs,
            stats,
            achievements,
            highlight_video_url,
            preferred_leagues,
            bio,
            created_at,
            updated_at,
            user:user_id (
              id,
              full_name,
              email
            )
          )
        `)
        .in("opportunity_id", opportunityIds)
        .order("created_at", { ascending: false });

      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }

      const { data: applications, error } = await query;

      if (error) {
        console.error("Failed to fetch team applications:", error);
        return NextResponse.json(
          { error: "Failed to fetch applications" },
          { status: 500 },
        );
      }

      // Calculate match scores for each application
      const applicationsWithMatches = await Promise.all(
        (applications ?? []).map(async (app) => {
          try {
            const playerProfile = app.player_profile as unknown as PlayerProfile | null;
            const opportunity = app.opportunity as unknown as Opportunity | null;

            if (playerProfile && opportunity) {
              const matchResult = matchPlayerToOpportunity(playerProfile, opportunity);
              return { ...app, match_result: matchResult };
            }
          } catch {
            // Silently fail match calculation
          }
          return { ...app, match_result: null };
        }),
      );

      // Apply position filter (client-side since we need match results)
      let filtered = applicationsWithMatches;
      if (positionFilter) {
        const posLower = positionFilter.toLowerCase();
        filtered = filtered.filter((app) => {
          const positions = app.player_profile?.positions ?? [];
          return positions.some((p: string) => p.toLowerCase() === posLower);
        });
      }

      // Apply match quality filter
      if (matchQualityFilter) {
        const validQualities: MatchQuality[] = ["excellent", "strong", "possible", "weak", "poor"];
        if (validQualities.includes(matchQualityFilter as MatchQuality)) {
          filtered = filtered.filter((app) => {
            return app.match_result?.classification === matchQualityFilter;
          });
        }
      }

      // Apply sorting
      const sortField = sortBy || "newest";
      filtered.sort((a, b) => {
        switch (sortField) {
          case "oldest":
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          case "highest_match":
            return (b.match_result?.score ?? 0) - (a.match_result?.score ?? 0);
          case "lowest_match":
            return (a.match_result?.score ?? 0) - (b.match_result?.score ?? 0);
          case "newest":
          default:
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
      });

      return NextResponse.json({
        applications: filtered,
        opportunities: teamOpportunities ?? [],
      });
    }

    return NextResponse.json(
      { error: "Invalid context" },
      { status: 400 },
    );
  } catch (err) {
    console.error("Applications fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}