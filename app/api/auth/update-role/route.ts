import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { role } = await request.json();

    if (role !== "player" && role !== "team") {
      return NextResponse.json(
        { error: "Invalid role" },
        { status: 400 },
      );
    }

    // Use admin client to bypass RLS
    // Fetch current roles first so we can append instead of replace
    const { data: profile, error: fetchError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("email", session.user.email)
      .single();

    if (fetchError) {
      console.error("Failed to fetch current roles:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch current roles" },
        { status: 500 },
      );
    }

    const currentRoles: string[] = profile?.role ?? [];
    const newRoles = currentRoles.includes(role)
      ? currentRoles
      : [...currentRoles, role];

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ role: newRoles })
      .eq("email", session.user.email);

    if (updateError) {
      console.error("Failed to update role:", updateError);
      return NextResponse.json(
        { error: "Failed to update role" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, roles: newRoles });
  } catch (err) {
    console.error("Update role error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
