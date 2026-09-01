import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/applications/eligibility?opportunity_id=xxx
// Returns the eligibility state for the current user relative to an opportunity.
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const { searchParams } = new URL(request.url);
    const opportunityId = searchParams.get("opportunity_id");

    if (!opportunityId) {
      return NextResponse.json(
        { error: "opportunity_id is required" },
        { status: 400 },
      );
    }

    // Not authenticated
    if (!session?.user?.id) {
      return NextResponse.json({
        authenticated: false,
      });
    }

    const result: {
      authenticated: boolean;
      has_player_role: boolean;
      has_player_profile: boolean;
      already_applied: boolean;
      existing_status: string | null;
      opportunity_active: boolean;
    } = {
      authenticated: true,
      has_player_role: false,
      has_player_profile: false,
      already_applied: false,
      existing_status: null,
      opportunity_active: false,
    };

    // Check the opportunity is active
    const { data: opportunity } = await supabaseAdmin
      .from("opportunities")
      .select("id, status")
      .eq("id", opportunityId)
      .single();

    if (opportunity) {
      result.opportunity_active = opportunity.status === "active";
    }

    // Check user roles
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, role")
      .eq("id", session.user.id)
      .single();

    const roles: string[] = profile?.role ?? [];
    result.has_player_role = roles.includes("player");

    if (result.has_player_role) {
      // Check for player profile
      const { data: playerProfile } = await supabaseAdmin
        .from("player_profiles")
        .select("id")
        .eq("user_id", session.user.id)
        .single();

      if (playerProfile) {
        result.has_player_profile = true;

        // Check for existing application
        const { data: existing } = await supabaseAdmin
          .from("applications")
          .select("status")
          .eq("opportunity_id", opportunityId)
          .eq("player_profile_id", playerProfile.id)
          .maybeSingle();

        if (existing) {
          result.already_applied = true;
          result.existing_status = existing.status;
        }
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("Application eligibility check error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}