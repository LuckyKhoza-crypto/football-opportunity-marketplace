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
    profile_photo_url: body.profile_photo_url ?? null,
    date_of_birth: body.date_of_birth ?? null,
    location: body.location ?? null,
    positions: Array.isArray(body.positions) ? body.positions : [],
    preferred_role: body.preferred_role ?? null,
    playing_level: body.playing_level ?? null,
    preferred_foot: body.preferred_foot ?? null,
    availability: body.availability ?? null,
    willing_to_travel: Boolean(body.willing_to_travel),
    willing_to_relocate: Boolean(body.willing_to_relocate),
    travel_radius: body.travel_radius ? Number(body.travel_radius) : null,
    compensation_expectation: body.compensation_expectation ?? null,
    previous_clubs: Array.isArray(body.previous_clubs)
      ? body.previous_clubs
      : [],
    stats: body.stats && typeof body.stats === "object" ? body.stats : {},
    achievements: Array.isArray(body.achievements) ? body.achievements : [],
    highlight_video_url: body.highlight_video_url ?? null,
    preferred_leagues: Array.isArray(body.preferred_leagues)
      ? body.preferred_leagues
      : [],
    bio: body.bio ?? null,
    discoverable: true,
  };
}

// Create the player profile for the authenticated user.
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

    // Construct the insert payload explicitly — never trust client-supplied
    // user_id; the authenticated session's ID is always authoritative.
    const profileData = buildProfileData(body, session.user.id);

    // Use the admin client (service role) to bypass RLS — the app manages
    // auth with NextAuth, so Supabase RLS policies (auth.uid()) don't apply.
    const { error: insertError } = await supabaseAdmin
      .from("player_profiles")
      .insert(profileData);

    if (insertError) {
      console.error("Failed to create player profile:", insertError);
      return NextResponse.json(
        { error: "Failed to create player profile" },
        { status: 500 },
      );
    }

    // Add 'player' role to the user's roles if not already present
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    const currentRoles: string[] = profile?.role ?? [];
    if (!currentRoles.includes("player")) {
      const { error: roleError } = await supabaseAdmin
        .from("profiles")
        .update({ role: [...currentRoles, "player"] })
        .eq("id", session.user.id);

      if (roleError) {
        console.error("Failed to add player role:", roleError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Player profile creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Update the player profile for the authenticated user.
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
      .from("player_profiles")
      .update(profileData)
      .eq("user_id", session.user.id);

    if (updateError) {
      console.error("Failed to update player profile:", updateError);
      return NextResponse.json(
        { error: "Failed to update player profile" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Player profile update error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}