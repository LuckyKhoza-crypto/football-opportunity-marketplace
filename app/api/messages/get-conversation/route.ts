import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

// POST /api/messages/get-conversation — Get or create a conversation for an application
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
    const { application_id } = body;

    if (!application_id) {
      return NextResponse.json(
        { error: "application_id is required" },
        { status: 400 },
      );
    }

    // Verify the user has access to this application
    // (either as the player who submitted it or the team that owns the opportunity)
    const userId = session.user.id;

    // Check if the user is the player who owns this application
    const { data: playerProfile } = await supabaseAdmin
      .from("player_profiles")
      .select("id")
      .eq("user_id", userId)
      .single();

    const { data: teamProfile } = await supabaseAdmin
      .from("team_profiles")
      .select("id")
      .eq("user_id", userId)
      .single();

    // Check application access
    const { data: application } = await supabaseAdmin
      .from("applications")
      .select("id, player_profile_id, opportunity_id")
      .eq("id", application_id)
      .single();

    if (!application) {
      return NextResponse.json(
        { error: "Application not found" },
        { status: 404 },
      );
    }

    // Verify user is either the player who submitted or the team that owns the opportunity
    const isPlayer = playerProfile && application.player_profile_id === playerProfile.id;
    const { data: opportunity } = await supabaseAdmin
      .from("opportunities")
      .select("team_id")
      .eq("id", application.opportunity_id)
      .single();

    const isTeam = teamProfile && opportunity && opportunity.team_id === teamProfile.id;

    if (!isPlayer && !isTeam) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 },
      );
    }

    // Use the RPC function to get or create the conversation
    const { data: result, error: rpcError } = await supabaseAdmin.rpc(
      "get_or_create_conversation_for_application",
      {
        p_application_id: application_id,
        p_user_id: userId,
      },
    );

    if (rpcError || !result?.success) {
      console.error("Failed to get/create conversation:", rpcError ?? result?.error);
      return NextResponse.json(
        { error: result?.error ?? "Failed to open conversation" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      conversation_id: result.conversation_id,
    });
  } catch (err) {
    console.error("Get conversation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}