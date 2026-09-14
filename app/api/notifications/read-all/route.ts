import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

// PATCH /api/notifications/read-all — Mark all of the user's notifications as read
export async function PATCH() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const userId = session.user.id;

    // Mark all unread notifications belonging to the authenticated user as read
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null)
      .select("id");

    if (error) {
      console.error("Failed to mark all notifications as read:", error);
      return NextResponse.json(
        { error: "Failed to mark all notifications as read" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      marked_count: (data ?? []).length,
    });
  } catch (err) {
    console.error("Mark all notifications read error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}