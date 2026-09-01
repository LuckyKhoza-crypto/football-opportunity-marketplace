import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email || !session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: teamProfile, error } = await supabaseAdmin
      .from("team_profiles")
      .select("*")
      .eq("user_id", session.user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned
      console.error("Failed to fetch team profile:", error);
      return NextResponse.json(
        { error: "Failed to fetch team profile" },
        { status: 500 },
      );
    }

    return NextResponse.json({ teamProfile });
  } catch (err) {
    console.error("Team profile fetch error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}