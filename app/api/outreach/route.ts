import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createNotification } from "@/lib/notifications";

const MAX_MESSAGE_LENGTH = 5000;

// POST /api/outreach — Team contacts a player about an opportunity
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
    const { player_profile_id, opportunity_id, message, team_id } = body;

    if (!player_profile_id || !opportunity_id || !message) {
      return NextResponse.json(
        { error: "player_profile_id, opportunity_id, and message are required" },
        { status: 400 },
      );
    }

    if (!team_id) {
      return NextResponse.json(
        { error: "team_id is required" },
        { status: 400 },
      );
    }

    if (typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { error: "Initial message is required" },
        { status: 400 },
      );
    }

    if (message.trim().length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters` },
        { status: 400 },
      );
    }

    const userId = session.user.id;

    // Verify the specific team belongs to the user
    const { data: teamProfile } = await supabaseAdmin
      .from("team_profiles")
      .select("id, team_name, user_id")
      .eq("user_id", userId)
      .eq("id", team_id)
      .single();

    if (!teamProfile) {
      return NextResponse.json(
        { error: "Team profile not found or access denied. Complete team onboarding first." },
        { status: 403 },
      );
    }

    // Verify player profile exists
    const { data: playerProfile } = await supabaseAdmin
      .from("player_profiles")
      .select("id, user_id")
      .eq("id", player_profile_id)
      .single();

    if (!playerProfile) {
      return NextResponse.json(
        { error: "Player profile not found" },
        { status: 404 },
      );
    }

    // Verify opportunity belongs to this team
    const { data: opportunity } = await supabaseAdmin
      .from("opportunities")
      .select("id, team_id, title, status")
      .eq("id", opportunity_id)
      .single();

    if (!opportunity) {
      return NextResponse.json(
        { error: "Opportunity not found" },
        { status: 404 },
      );
    }

    if (opportunity.team_id !== teamProfile.id) {
      return NextResponse.json(
        { error: "Opportunity does not belong to this team" },
        { status: 403 },
      );
    }

    // Prevent self-contact
    if (playerProfile.user_id === userId) {
      return NextResponse.json(
        { error: "You cannot contact your own player profile" },
        { status: 400 },
      );
    }

    // Check for existing outreach (duplicate prevention)
    const { data: existingOutreach } = await supabaseAdmin
      .from("outreach")
      .select("id")
      .eq("opportunity_id", opportunity_id)
      .eq("team_profile_id", teamProfile.id)
      .eq("player_profile_id", player_profile_id)
      .maybeSingle();

    if (existingOutreach) {
      // Reuse existing outreach + conversation
      const { data: existingConv } = await supabaseAdmin
        .from("conversations")
        .select("id")
        .eq("outreach_id", existingOutreach.id)
        .maybeSingle();

      if (existingConv) {
        // Send message in existing conversation
        const { data: msg } = await supabaseAdmin
          .from("messages")
          .insert({
            conversation_id: existingConv.id,
            sender_id: userId,
            body: message.trim(),
          })
          .select("id, conversation_id, sender_id, body, created_at")
          .single();

        return NextResponse.json(
          {
            success: true,
            outreach_id: existingOutreach.id,
            conversation_id: existingConv.id,
            message_id: msg?.id,
            already_existed: true,
          },
          { status: 200 },
        );
      }
    }

    // Use RPC for atomic outreach + conversation + initial message creation
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "create_outreach_with_initial_message",
      {
        p_opportunity_id: opportunity_id,
        p_player_profile_id: player_profile_id,
        p_initial_message: message.trim(),
        p_user_id: userId,
        p_team_profile_id: teamProfile.id,
      },
    );

    if (rpcError || !rpcResult?.success) {
      console.error("Outreach RPC failed:", rpcError ?? rpcResult?.error);
      return NextResponse.json(
        { error: rpcResult?.error ?? "Failed to create outreach" },
        { status: 500 },
      );
    }

    // Create notification for the player
    const { data: playerProfileData } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", playerProfile.user_id)
      .single();

    const teamName = teamProfile.team_name ?? "A team";
    const playerName = playerProfileData?.full_name ?? "a player";

    await createNotification({
      userId: playerProfile.user_id,
      type: "message_received",
      title: "New message from a team",
      body: `${teamName} contacted you about "${opportunity.title ?? "an opportunity"}".`,
      link: `/messages/${rpcResult.conversation_id}`,
      sourceId: rpcResult.message_id,
    }).catch((err) => {
      console.error("Outreach notification failed:", err);
    });

    return NextResponse.json(
      {
        success: true,
        outreach_id: rpcResult.outreach_id,
        conversation_id: rpcResult.conversation_id,
        message_id: rpcResult.message_id,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Outreach creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// GET /api/outreach?context=player|team — List outreach
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const context = searchParams.get("context") || "player";

    if (context === "player") {
      // Player viewing outreach sent to them
      const { data: playerProfile } = await supabaseAdmin
        .from("player_profiles")
        .select("id")
        .eq("user_id", userId)
        .single();

      if (!playerProfile) {
        return NextResponse.json({ outreach: [] });
      }

      const { data: outreach } = await supabaseAdmin
        .from("outreach")
        .select(`
          *,
          opportunity:opportunity_id (
            id, title, position, status,
            team:team_id (id, team_name, logo_url)
          )
        `)
        .eq("player_profile_id", playerProfile.id)
        .order("created_at", { ascending: false });

      return NextResponse.json({ outreach: outreach ?? [] });
    }

    if (context === "team") {
      // Team viewing their own outreach
      const teamIdParam = searchParams.get("team_id");

      let teamProfile: { id: string } | null = null;

      if (teamIdParam) {
        const { data } = await supabaseAdmin
          .from("team_profiles")
          .select("id")
          .eq("user_id", userId)
          .eq("id", teamIdParam)
          .single();
        teamProfile = data;
      } else {
        const { data } = await supabaseAdmin
          .from("team_profiles")
          .select("id")
          .eq("user_id", userId)
          .single();
        teamProfile = data;
      }

      if (!teamProfile) {
        return NextResponse.json({ outreach: [] });
      }

      const { data: outreach } = await supabaseAdmin
        .from("outreach")
        .select(`
          *,
          opportunity:opportunity_id (
            id, title, position, status
          ),
          player_profile:player_profile_id (
            id, user_id, profile_photo_url,
            user:user_id (full_name)
          )
        `)
        .eq("team_profile_id", teamProfile.id)
        .order("created_at", { ascending: false });

      return NextResponse.json({ outreach: outreach ?? [] });
    }

    return NextResponse.json(
      { error: "Invalid context" },
      { status: 400 },
    );
  } catch (err) {
    console.error("Outreach fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}