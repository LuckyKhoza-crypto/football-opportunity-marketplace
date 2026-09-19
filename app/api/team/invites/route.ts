import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  generateInviteToken,
  hashInviteToken,
  getInviteExpiration,
  getTeamInviteState,
} from "@/lib/team-invite";
import type { TeamInvite } from "@/types";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verify the authenticated user owns the SPECIFIC team profile.
 *
 * This intentionally never falls back to "the user's first team":
 * under the multi-team architecture the requested team_profile_id is
 * always explicit and ownership is always verified server-side.
 */
async function verifyTeamOwnership(
  userId: string,
  teamId: string,
): Promise<{ teamId: string | null; error: NextResponse | null }> {
  const { data: teamProfile } = await supabaseAdmin
    .from("team_profiles")
    .select("id")
    .eq("id", teamId)
    .eq("user_id", userId)
    .single();

  if (!teamProfile) {
    return {
      teamId: null,
      error: NextResponse.json(
        { error: "Team profile not found or access denied" },
        { status: 404 },
      ),
    };
  }

  return { teamId: teamProfile.id, error: null };
}

// POST /api/team/invites — Create a new invite for a specific team
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
    const teamIdParam = body.team_profile_id as string | undefined;

    if (!teamIdParam || !UUID_REGEX.test(teamIdParam)) {
      return NextResponse.json(
        { error: "team_profile_id is required" },
        { status: 400 },
      );
    }

    const { teamId, error } = await verifyTeamOwnership(session.user.id, teamIdParam);
    if (error || !teamId) {
      return error ?? NextResponse.json(
        { error: "Team profile not found" },
        { status: 404 },
      );
    }

    // Generate the raw token server-side. It is returned to the manager
    // exactly once below and is NEVER persisted or logged.
    const rawToken = generateInviteToken();
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = getInviteExpiration();

    const { data: invite, error: insertError } = await supabaseAdmin
      .from("team_invites")
      .insert({
        team_profile_id: teamId,
        token_hash: tokenHash,
        created_by: session.user.id,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to create team invite:", insertError);
      return NextResponse.json(
        { error: "Failed to create team invite" },
        { status: 500 },
      );
    }

    const typedInvite = invite as unknown as TeamInvite;

    return NextResponse.json(
      {
        invite: {
          id: typedInvite.id,
          team_profile_id: typedInvite.team_profile_id,
          expires_at: typedInvite.expires_at,
          created_at: typedInvite.created_at,
          state: getTeamInviteState(typedInvite),
        },
        token: rawToken,
        join_url: `/team/join/${rawToken}`,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Team invite creation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// GET /api/team/invites?team_id=<id> — List invites for a specific team
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const teamIdParam = searchParams.get("team_id");

    if (!teamIdParam || !UUID_REGEX.test(teamIdParam)) {
      return NextResponse.json(
        { error: "team_id is required" },
        { status: 400 },
      );
    }

    const { teamId, error } = await verifyTeamOwnership(session.user.id, teamIdParam);
    if (error || !teamId) {
      return error ?? NextResponse.json(
        { error: "Team profile not found" },
        { status: 404 },
      );
    }

    const { data: invites, error: fetchError } = await supabaseAdmin
      .from("team_invites")
      .select("id, team_profile_id, expires_at, revoked_at, created_at, updated_at")
      .eq("team_profile_id", teamId)
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Failed to fetch team invites:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch team invites" },
        { status: 500 },
      );
    }

    // Never expose token_hash (or raw tokens) from previously created invites.
    const safeInvites = (invites ?? []).map((invite) => ({
      id: invite.id,
      team_profile_id: invite.team_profile_id,
      expires_at: invite.expires_at,
      revoked_at: invite.revoked_at,
      created_at: invite.created_at,
      updated_at: invite.updated_at,
      state: getTeamInviteState(invite as unknown as TeamInvite),
    }));

    return NextResponse.json({ invites: safeInvites });
  } catch (err) {
    console.error("Team invites fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}