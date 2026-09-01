import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

function buildOpportunityData(
  body: Record<string, unknown>,
  teamId: string,
): Record<string, unknown> {
  return {
    team_id: teamId,
    title: body.title ?? null,
    position: body.position ?? null,
    secondary_positions: Array.isArray(body.secondary_positions)
      ? body.secondary_positions
      : [],
    role: body.role ?? null,
    formation: body.formation ?? null,
    age_min: body.age_min ?? null,
    age_max: body.age_max ?? null,
    playing_level: body.playing_level ?? null,
    league: body.league ?? null,
    location: body.location ?? null,
    radius: body.radius ?? null,
    preferred_foot: body.preferred_foot ?? null,
    availability: body.availability ?? null,
    compensation: body.compensation ?? null,
    housing: body.housing ?? null,
    travel_requirements: body.travel_requirements ?? null,
    visa_requirements: body.visa_requirements ?? null,
    contract_length: body.contract_length ?? null,
    tryout_date: body.tryout_date ?? null,
    description: body.description ?? null,
    status: body.status ?? "draft",
  };
}

// Verify the requesting user owns the team profile
async function verifyTeamOwnership(userId: string): Promise<{
  teamId: string | null;
  error: NextResponse | null;
}> {
  const { data: teamProfile } = await supabaseAdmin
    .from("team_profiles")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (!teamProfile) {
    return {
      teamId: null,
      error: NextResponse.json(
        { error: "Team profile not found" },
        { status: 404 },
      ),
    };
  }

  return { teamId: teamProfile.id, error: null };
}

// List opportunities for the authenticated team
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { teamId, error } = await verifyTeamOwnership(session.user.id);
    if (error || !teamId) return error ?? NextResponse.json(
      { error: "Team profile not found" },
      { status: 404 },
    );

    const { data: opportunities, error: fetchError } = await supabaseAdmin
      .from("opportunities")
      .select("*")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Failed to fetch opportunities:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch opportunities" },
        { status: 500 },
      );
    }

    return NextResponse.json({ opportunities: opportunities ?? [] });
  } catch (err) {
    console.error("Opportunities fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Create a new opportunity
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { teamId, error } = await verifyTeamOwnership(session.user.id);
    if (error || !teamId) return error ?? NextResponse.json(
      { error: "Team profile not found" },
      { status: 404 },
    );

    const body = await request.json();

    // Validate required fields
    if (!body.title || !body.title.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 },
      );
    }

    // Validate status
    const validStatuses = ["draft", "active", "closed"];
    if (body.status && !validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 },
      );
    }

    const opportunityData = buildOpportunityData(body, teamId);

    const { data: opportunity, error: insertError } = await supabaseAdmin
      .from("opportunities")
      .insert(opportunityData)
      .select()
      .single();

    if (insertError) {
      console.error("Failed to create opportunity:", insertError);
      return NextResponse.json(
        { error: "Failed to create opportunity" },
        { status: 500 },
      );
    }

    return NextResponse.json({ opportunity }, { status: 201 });
  } catch (err) {
    console.error("Opportunity creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}