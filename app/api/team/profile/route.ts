import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

function buildProfileData(
  body: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  return {
    user_id: userId,
    team_name: body.team_name ?? null,
    logo_url: body.logo_url ?? null,
    location: body.location ?? null,
    league: body.league ?? null,
    playing_level: body.playing_level ?? null,
    description: body.description ?? null,
    website_url: body.website_url ?? null,
    social_links: Array.isArray(body.social_links) ? body.social_links : [],
    contact_name: body.contact_name ?? null,
  };
}

// Create the team profile for the authenticated user.
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

    const profileData = buildProfileData(body, session.user.id);

    const { error: insertError } = await supabaseAdmin
      .from("team_profiles")
      .insert(profileData);

    if (insertError) {
      console.error("Failed to create team profile:", insertError);
      return NextResponse.json(
        { error: "Failed to create team profile" },
        { status: 500 },
      );
    }

    // Add 'team' role to the user's roles if not already present
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    const currentRoles: string[] = profile?.role ?? [];
    if (!currentRoles.includes("team")) {
      const { error: roleError } = await supabaseAdmin
        .from("profiles")
        .update({ role: [...currentRoles, "team"] })
        .eq("id", session.user.id);

      if (roleError) {
        console.error("Failed to add team role:", roleError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Team profile creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Update the team profile for the authenticated user.
export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const body = await request.json();

    const profileData = buildProfileData(body, session.user.id);

    const { error: updateError } = await supabaseAdmin
      .from("team_profiles")
      .update(profileData)
      .eq("user_id", session.user.id);

    if (updateError) {
      console.error("Failed to update team profile:", updateError);
      return NextResponse.json(
        { error: "Failed to update team profile" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Team profile update error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}