import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { canManageMultipleTeams } from "@/lib/multi-team";

// GET /api/team/list — List all team profiles for the authenticated user
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { data: teams, error } = await supabaseAdmin
      .from("team_profiles")
      .select("id, team_name, logo_url, user_id")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to fetch teams:", error);
      return NextResponse.json(
        { error: "Failed to fetch teams" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      teams: teams ?? [],
      can_create_team: canManageMultipleTeams(session.user.id),
    });
  } catch (err) {
    console.error("Team list fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}