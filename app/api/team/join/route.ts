import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hashInviteToken } from "@/lib/team-invite";
import { createNotification } from "@/lib/notifications";

/**
 * TEAM-004 — Accept a shared team invite link.
 *
 * A team invite is a reusable shared recruitment link, NOT a single-use
 * invitation. The same URL may be accepted by multiple eligible players
 * while the invite remains valid. Historical acceptances are represented
 * by team_memberships rows — the invite itself is never mutated.
 *
 * The atomic membership creation is performed by the
 * accept_team_invite(...) SECURITY DEFINER RPC, which:
 *   1. Verifies the player profile belongs to the authenticated user
 *   2. Locks the invite row (FOR UPDATE) to serialize concurrent requests
 *   3. Rejects revoked / expired invites
 *   4. Rejects players already on a DIFFERENT team (PLAYER_ALREADY_ON_TEAM)
 *   5. Returns idempotent success when the player is already on THIS team
 *   6. Otherwise inserts the team_memberships row
 *
 * The team_memberships unique index on player_profile_id is the final
 * protection against duplicate memberships under concurrency.
 *
 * The team notification is created ONLY after a successful membership
 * creation (created: true). Idempotent re-acceptance (created: false)
 * never generates a duplicate notification. The notification's source_id
 * is the membership id, and a partial unique index on
 * (user_id, source_id) for type 'player_joined_team' provides a final
 * database-level dedup guarantee.
 */

// POST /api/team/join — Accept a shared invite link
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
    const token = body.token as string | undefined;

    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return NextResponse.json(
        { error: "token is required" },
        { status: 400 },
      );
    }

    // Resolve the player's profiles.id (the authenticated user).
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", session.user.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 },
      );
    }

    // Resolve the player's player_profiles.id.
    const { data: playerProfile } = await supabaseAdmin
      .from("player_profiles")
      .select("id")
      .eq("user_id", session.user.id)
      .single();

    if (!playerProfile) {
      return NextResponse.json(
        { error: "Player profile not found. Please complete your player profile first." },
        { status: 400 },
      );
    }

    // Hash the raw token — the database only ever stores digests.
    const tokenHash = hashInviteToken(token.trim());

    // Atomic membership creation via the SECURITY DEFINER RPC.
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "accept_team_invite",
      {
        p_token_hash: tokenHash,
        p_player_profile_id: playerProfile.id,
        p_user_id: session.user.id,
      },
    );

    if (rpcError || !rpcResult?.success) {
      const errorCode = rpcResult?.error ?? rpcError?.message ?? "Failed to accept invite";

      switch (errorCode) {
        case "INVITE_NOT_FOUND":
          return NextResponse.json(
            { error: "Invitation not found" },
            { status: 404 },
          );
        case "INVITE_REVOKED":
          return NextResponse.json(
            { error: "This invitation has been revoked" },
            { status: 400 },
          );
        case "INVITE_EXPIRED":
          return NextResponse.json(
            { error: "This invitation has expired" },
            { status: 400 },
          );
        case "PLAYER_ALREADY_ON_TEAM":
          return NextResponse.json(
            { error: "You are already a member of a different team" },
            { status: 409 },
          );
        default:
          console.error("Team invite acceptance failed:", rpcError ?? rpcResult);
          return NextResponse.json(
            { error: errorCode },
            { status: 500 },
          );
      }
    }

    const result = rpcResult as {
      success: boolean;
      created: boolean;
      already_member?: boolean;
      membership_id: string;
      team_profile_id: string;
      team_user_id: string | null;
      team_name: string | null;
    };

    // ─── Notification: player joined through the team's invite link ───
    // Only after a successful membership CREATION. Idempotent re-acceptance
    // (created: false) must NOT generate another notification.
    if (result.created && result.team_user_id) {
      try {
        // Fetch the player's full name for the notification body.
        const { data: playerProfileData } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", session.user.id)
          .single();

        const playerName = playerProfileData?.full_name ?? "A player";
        const teamName = result.team_name ?? "your team";

        await createNotification({
          userId: result.team_user_id,
          type: "player_joined_team",
          title: "New player joined your team",
          body: `${playerName} joined ${teamName} through your team's invite link.`,
          link: "/team/players",
          sourceId: result.membership_id,
        });
      } catch (notifErr) {
        // Notification failure should not fail the membership creation.
        console.error("Failed to create team join notification:", notifErr);
      }
    }

    return NextResponse.json(
      {
        success: true,
        created: result.created,
        already_member: result.already_member ?? false,
        membership_id: result.membership_id,
        team_profile_id: result.team_profile_id,
        team_name: result.team_name,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (err) {
    console.error("Team invite acceptance error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}