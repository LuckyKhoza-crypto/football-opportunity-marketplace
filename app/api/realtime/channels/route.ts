import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  signChannel,
  getUserChannelName,
} from "@/lib/realtime-broadcast";

// GET /api/realtime/channels?type=notification
// GET /api/realtime/channels?type=conversation&conversationId=xxx
//
// Returns a signed realtime channel name for the authenticated user.
// The signature prevents unauthorized clients from subscribing to
// another user's or conversation's realtime channel.

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
    const type = searchParams.get("type");
    const conversationId = searchParams.get("conversationId");

    if (!type) {
      return NextResponse.json(
        { error: "type is required (notification or conversation)" },
        { status: 400 },
      );
    }

    if (type === "notification") {
      // User's own notification channel
      const channelName = getUserChannelName(userId);
      return NextResponse.json({
        channel: signChannel(channelName, userId),
        userId,
      });
    }

    if (type === "conversation") {
      if (!conversationId) {
        return NextResponse.json(
          { error: "conversationId is required" },
          { status: 400 },
        );
      }

      // Verify the user is a participant in this conversation
      const { data: participant } = await supabaseAdmin
        .from("conversation_participants")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!participant) {
        return NextResponse.json(
          { error: "Conversation not found or access denied" },
          { status: 404 },
        );
      }

      const { getConversationChannelName } = await import(
        "@/lib/realtime-broadcast"
      );
      const channelName = getConversationChannelName(conversationId);
      return NextResponse.json({
        channel: signChannel(channelName, userId),
        conversationId,
      });
    }

    return NextResponse.json(
      { error: "Invalid type. Must be 'notification' or 'conversation'" },
      { status: 400 },
    );
  } catch (err) {
    console.error("Realtime channel error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}