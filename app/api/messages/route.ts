import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/messages — List conversations for the current user
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

    // Get all conversations where the user is a participant
    const { data: participants, error: participantError } = await supabaseAdmin
      .from("conversation_participants")
      .select(`
        conversation_id,
        last_read_at,
        conversation:conversation_id (
          id,
          application_id,
          outreach_id,
          created_at,
          updated_at,
          application:application_id (
            id,
            status,
            opportunity:opportunity_id (
              id,
              title,
              position,
              playing_level,
              location,
              team:team_id (
                id,
                team_name,
                logo_url
              )
            ),
            player_profile:player_profile_id (
              id,
              profile_photo_url,
              user_id
            )
          ),
          outreach:outreach_id (
            id,
            status,
            opportunity:opportunity_id (
              id,
              title,
              position,
              playing_level,
              location,
              team:team_id (
                id,
                team_name,
                logo_url
              )
            ),
            player_profile:player_profile_id (
              id,
              profile_photo_url,
              user_id
            )
          )
        )
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false, referencedTable: "conversation" });

    if (participantError) {
      console.error("Failed to fetch conversations:", participantError);
      return NextResponse.json(
        { error: "Failed to fetch conversations" },
        { status: 500 },
      );
    }

    if (!participants || participants.length === 0) {
      return NextResponse.json({ conversations: [] });
    }

    // Fetch the latest message and unread count for each conversation
    const conversationIds = participants.map((p: any) => p.conversation_id);

    // Calculate unread counts and latest messages per conversation
    const { data: allMessages } = await supabaseAdmin
      .from("messages")
      .select("id, conversation_id, body, sender_id, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false });

    // Build maps
    const latestMessageMap = new Map<string, any>();
    const unreadCountMap = new Map<string, number>();

    if (allMessages) {
      const seen = new Set<string>();
      for (const msg of allMessages) {
        if (!seen.has(msg.conversation_id)) {
          seen.add(msg.conversation_id);
          latestMessageMap.set(msg.conversation_id, msg);
        }
      }
    }

    // Calculate unread counts per conversation
    for (const participant of participants as any[]) {
      const lastReadAt = participant.last_read_at;
      const convId = participant.conversation_id;
      if (allMessages) {
        const unread = allMessages.filter(
          (m: any) =>
            m.conversation_id === convId &&
            m.sender_id !== userId &&
            new Date(m.created_at) > new Date(lastReadAt),
        ).length;
        unreadCountMap.set(convId, unread);
      }
    }

    // Fetch player profile names for the other participant display
    const playerProfileIds = (participants as any[])
      .map((p: any) =>
        p.conversation?.application?.player_profile?.user_id ??
        p.conversation?.outreach?.player_profile?.user_id
      )
      .filter(Boolean);

    const { data: playerProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", [...new Set<string>(playerProfileIds)]);

    const profileMap = new Map<string, { full_name: string | null; avatar_url: string | null }>();
    if (playerProfiles) {
      for (const p of playerProfiles) {
        profileMap.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url });
      }
    }

    // Build the response
    const conversations = (participants as any[]).map((p: any) => {
      const conversation = p.conversation || {};
      const application = conversation.application || {};
      const outreach = conversation.outreach || {};
      const appOrOutreach = application.id ? application : outreach;
      const opportunity = appOrOutreach.opportunity || {};
      const playerProfile = appOrOutreach.player_profile || {};
      const latestMsg = latestMessageMap.get(p.conversation_id) ?? null;

      // Get the other participant's name
      const otherParticipantId =
        playerProfile.user_id === userId
          ? null
          : playerProfile.user_id;

      const otherParticipantProfile = otherParticipantId
        ? profileMap.get(otherParticipantId)
        : null;

      return {
        id: conversation.id,
        application_id: conversation.application_id,
        outreach_id: conversation.outreach_id,
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
        display_name:
          opportunity?.team?.team_name ??
          otherParticipantProfile?.full_name ??
          "Unknown",
        opportunity_title: opportunity?.title ?? "Unknown Opportunity",
        opportunity_position: opportunity?.position,
        application_status: appOrOutreach?.status ?? "pending",
        latest_message: latestMsg,
        unread_count: unreadCountMap.get(p.conversation_id) ?? 0,
        other_participant: otherParticipantProfile,
      };
    });

    // Sort by latest message time (most recent first)
    conversations.sort((a: any, b: any) => {
      const aTime = a.latest_message?.created_at ?? a.created_at;
      const bTime = b.latest_message?.created_at ?? b.created_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    return NextResponse.json({ conversations });
  } catch (err) {
    console.error("Conversations fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}