import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createNotification } from "@/lib/notifications";

const MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LENGTH = 5000;

// GET /api/messages/[conversationId] — Get messages for a conversation
export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { conversationId } = await params;
    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const before = searchParams.get("before"); // cursor for pagination (message ID)
    const limit = Math.min(
      parseInt(searchParams.get("limit") ?? String(MESSAGE_LIMIT), 10),
      MESSAGE_LIMIT,
    );

    // Verify the user is a participant in this conversation
    const { data: participant } = await supabaseAdmin
      .from("conversation_participants")
      .select("id, last_read_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .single();

    if (!participant) {
      return NextResponse.json(
        { error: "Conversation not found or access denied" },
        { status: 404 },
      );
    }

    // Fetch the conversation with application details
    const { data: conversation } = await supabaseAdmin
      .from("conversations")
      .select(`
        id,
        application_id,
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
              logo_url,
              location,
              league,
              playing_level
            )
          ),
          player_profile:player_profile_id (
            id,
            profile_photo_url,
            user_id,
            positions,
            playing_level,
            location
          )
        )
      `)
      .eq("id", conversationId)
      .single();

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    // Fetch participants
    const { data: participants } = await supabaseAdmin
      .from("conversation_participants")
      .select(`
        user_id,
        last_read_at,
        user:user_id (
          id,
          full_name,
          avatar_url
        )
      `)
      .eq("conversation_id", conversationId);

    // Fetch messages with pagination
    let messageQuery = supabaseAdmin
      .from("messages")
      .select(`
        id,
        conversation_id,
        sender_id,
        body,
        created_at,
        updated_at,
        sender:sender_id (
          id,
          full_name,
          avatar_url
        )
      `)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) {
      // Get the timestamp of the "before" message to use as cursor
      const { data: beforeMsg } = await supabaseAdmin
        .from("messages")
        .select("created_at")
        .eq("id", before)
        .single();

      if (beforeMsg) {
        messageQuery = messageQuery.lt("created_at", beforeMsg.created_at);
      }
    }

    const { data: messages, error: messagesError } = await messageQuery;

    if (messagesError) {
      console.error("Failed to fetch messages:", messagesError);
      return NextResponse.json(
        { error: "Failed to fetch messages" },
        { status: 500 },
      );
    }

    // Reverse to get chronological order
    const sortedMessages = (messages ?? []).reverse();

    // Check if there are more messages
    const hasMore = (messages ?? []).length === limit;

    // Fetch match score for the application
    let matchResult = null;
    try {
      const application = conversation.application as any;
      if (application?.opportunity && application?.player_profile) {
        const { matchPlayerToOpportunity } = await import("@/lib/matching");
        const { data: playerProfile } = await supabaseAdmin
          .from("player_profiles")
          .select("*")
          .eq("id", application.player_profile.id)
          .single();

        const { data: opportunity } = await supabaseAdmin
          .from("opportunities")
          .select("*")
          .eq("id", application.opportunity.id)
          .single();

        if (playerProfile && opportunity) {
          matchResult = matchPlayerToOpportunity(
            playerProfile as any,
            opportunity as any,
          );
        }
      }
    } catch {
      // Silently fail match calculation
    }

    return NextResponse.json({
      conversation,
      participants: participants ?? [],
      messages: sortedMessages,
      has_more: hasMore,
      match_result: matchResult,
    });
  } catch (err) {
    console.error("Conversation detail error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/messages/[conversationId] — Send a message
export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { conversationId } = await params;
    const userId = session.user.id;

    // Verify the user is a participant in this conversation
    const { data: participant } = await supabaseAdmin
      .from("conversation_participants")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .single();

    if (!participant) {
      return NextResponse.json(
        { error: "Conversation not found or access denied" },
        { status: 404 },
      );
    }

    const body = await request.json();
    const { body: messageBody } = body;

    // Validate message body
    if (!messageBody || typeof messageBody !== "string") {
      return NextResponse.json(
        { error: "Message body is required" },
        { status: 400 },
      );
    }

    const trimmedBody = messageBody.trim();

    if (trimmedBody.length === 0) {
      return NextResponse.json(
        { error: "Message cannot be empty" },
        { status: 400 },
      );
    }

    if (trimmedBody.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        {
          error: `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
        },
        { status: 400 },
      );
    }

    // Insert the message — sender_id is derived from the session, not the request
    const { data: message, error: insertError } = await supabaseAdmin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        body: trimmedBody,
      })
      .select(`
        id,
        conversation_id,
        sender_id,
        body,
        created_at,
        updated_at,
        sender:sender_id (
          id,
          full_name,
          avatar_url
        )
      `)
      .single();

    if (insertError) {
      console.error("Failed to send message:", insertError);
      return NextResponse.json(
        { error: "Failed to send message" },
        { status: 500 },
      );
    }

    // ─── Notification: New message received ─────────────────────
    // Notify the OTHER participant in the conversation.
    // The sender never receives a notification for their own message.
    // Works for all application statuses (pending, reviewing, accepted,
    // rejected, withdrawn) — messaging remains available regardless.
    try {
      // Fetch the conversation with application details to determine
      // the sender's display name and the other participant.
      const { data: conversationData } = await supabaseAdmin
        .from("conversations")
        .select(`
          id,
          application:application_id (
            opportunity:opportunity_id (
              team:team_id (
                user_id,
                team_name
              )
            ),
            player_profile:player_profile_id (
              user_id
            )
          )
        `)
        .eq("id", conversationId)
        .single();

      const application = conversationData?.application as any;
      const teamUserId = application?.opportunity?.[0]?.team?.[0]?.user_id;
      const teamName = application?.opportunity?.[0]?.team?.[0]?.team_name;
      const playerUserId = application?.player_profile?.[0]?.user_id;

      // Determine the sender's display name
      let senderName: string | null = null;
      if (teamUserId === userId) {
        senderName = teamName ?? "The team";
      } else {
        const { data: senderProfile } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", userId)
          .single();
        senderName = senderProfile?.full_name ?? "A player";
      }

      // Find the other participant (the recipient)
      const { data: otherParticipants } = await supabaseAdmin
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", conversationId)
        .neq("user_id", userId);

      const recipient = otherParticipants?.[0];
      if (recipient?.user_id) {
        await createNotification({
          userId: recipient.user_id,
          type: "message_received",
          title: "New message",
          body: `${senderName} sent you a new message.`,
          link: `/messages/${conversationId}`,
          sourceId: message.id,
        });
      }
    } catch (notifErr) {
      // Notification failure should not fail the message send
      console.error("Failed to create message notification:", notifErr);
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    console.error("Message send error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PATCH /api/messages/[conversationId]/read — Mark conversation as read
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { conversationId } = await params;
    const userId = session.user.id;

    // Check if this is a read-mark request
    const body = await request.json();
    if (body.action !== "mark_read") {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 },
      );
    }

    // Update last_read_at for this participant
    const { error: updateError } = await supabaseAdmin
      .from("conversation_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("user_id", userId);

    if (updateError) {
      console.error("Failed to mark conversation as read:", updateError);
      return NextResponse.json(
        { error: "Failed to mark conversation as read" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Mark read error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}