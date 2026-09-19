import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTeamInviteState } from "@/lib/team-invite";
import type { TeamInvite } from "@/types";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/team/invites/[id]/revoke — Revoke an invite (soft delete)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { id } = await params;
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: "Invalid invite id" },
        { status: 400 },
      );
    }

    // Fetch the invite with its team's owner so we can verify the
    // authenticated manager owns the SPECIFIC team this invite belongs to.
    // Authorization is never based on merely knowing the invite ID.
    const { data: invite, error: fetchError } = await supabaseAdmin
      .from("team_invites")
      .select(
        `
        id,
        team_profile_id,
        expires_at,
        revoked_at,
        created_at,
        team:team_profile_id (
          user_id
        )
      `,
      )
      .eq("id", id)
      .single();

    if (fetchError || !invite) {
      return NextResponse.json(
        { error: "Invite not found" },
        { status: 404 },
      );
    }

    const teamOwnerId = (invite.team as unknown as { user_id: string } | null)?.user_id;
    if (teamOwnerId !== session.user.id) {
      return NextResponse.json(
        { error: "Invite not found" },
        { status: 404 },
      );
    }

    const typedInvite = invite as unknown as TeamInvite;

    // Already revoked — idempotent success.
    if (typedInvite.revoked_at != null) {
      return NextResponse.json({
        success: true,
        invite: {
          id: typedInvite.id,
          team_profile_id: typedInvite.team_profile_id,
          expires_at: typedInvite.expires_at,
          revoked_at: typedInvite.revoked_at,
          created_at: typedInvite.created_at,
          state: getTeamInviteState(typedInvite),
        },
      });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("team_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Failed to revoke team invite:", updateError);
      return NextResponse.json(
        { error: "Failed to revoke team invite" },
        { status: 500 },
      );
    }

    const typedUpdated = updated as unknown as TeamInvite;

    return NextResponse.json({
      success: true,
      invite: {
        id: typedUpdated.id,
        team_profile_id: typedUpdated.team_profile_id,
        expires_at: typedUpdated.expires_at,
        revoked_at: typedUpdated.revoked_at,
        created_at: typedUpdated.created_at,
        state: getTeamInviteState(typedUpdated),
      },
    });
  } catch (err) {
    console.error("Team invite revocation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}