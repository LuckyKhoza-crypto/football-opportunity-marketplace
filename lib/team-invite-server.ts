import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hashInviteToken, getTeamInviteState } from "@/lib/team-invite";
import type { PublicTeamInvite, TeamInvite } from "@/types";

/**
 * Resolve a raw invite token to public-safe invite metadata.
 *
 * TEAM-003 will use this to render the future join page. The raw token
 * is hashed before lookup — the database only ever stores digests.
 *
 * Returns null (never throws) when the token is unknown, so callers
 * cannot distinguish "no such invite" from "invalid token" and no
 * sensitive database information leaks.
 */
export async function getTeamInviteByToken(
  token: string,
): Promise<PublicTeamInvite | null> {
  if (!token) return null;

  const tokenHash = hashInviteToken(token);

  const { data, error } = await supabaseAdmin
    .from("team_invites")
    .select(
      `
      id,
      team_profile_id,
      expires_at,
      revoked_at,
      created_at,
      team:team_profile_id (
        id,
        team_name,
        logo_url,
        location,
        league
      )
    `,
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;

  const invite = data as unknown as TeamInvite & {
    team: {
      id: string;
      team_name: string;
      logo_url: string | null;
      location: string | null;
      league: string | null;
    };
  };

  return {
    id: invite.id,
    team: {
      id: invite.team.id,
      team_name: invite.team.team_name,
      logo_url: invite.team.logo_url,
      location: invite.team.location,
      league: invite.team.league,
    },
    state: getTeamInviteState(invite),
    expires_at: invite.expires_at,
    created_at: invite.created_at,
  };
}