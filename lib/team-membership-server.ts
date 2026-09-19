import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { filterActiveMemberships } from "@/lib/team-membership";
import type { TeamMembershipWithPlayer, TeamMembershipWithTeam } from "@/types";

/**
 * TEAM-006 — Server-side loaders for canonical team membership data.
 *
 * Both loaders use a single Supabase query with embedded joins (no N+1)
 * and filter on `status = 'active'` at the database level. The
 * `filterActiveMemberships` helper is applied as a defensive second
 * layer so an unexpected non-active row can never leak into the UI.
 *
 * These loaders are the ONLY source of team/roster data for profile
 * pages. They never read applications, outreach, or player profile
 * fields to determine membership.
 */

/**
 * Load the active team memberships for a player, joined with the
 * team profile. Returns an array (future multi-team safe) — the
 * current MVP database constraint guarantees at most one row.
 */
export async function getActiveMembershipsForPlayer(
  playerProfileId: string,
): Promise<TeamMembershipWithTeam[]> {
  const { data, error } = await supabaseAdmin
    .from("team_memberships")
    .select(
      `
      id,
      team_profile_id,
      player_profile_id,
      position,
      role,
      status,
      joined_at,
      created_at,
      updated_at,
      team:team_profile_id (
        id,
        team_name,
        logo_url,
        location,
        league
      )
    `,
    )
    .eq("player_profile_id", playerProfileId)
    .eq("status", "active");

  if (error) {
    console.error("Failed to fetch player team memberships:", error);
    return [];
  }

  return filterActiveMemberships(
    (data ?? []) as unknown as TeamMembershipWithTeam[],
  );
}

/**
 * Load the active team memberships for a team, joined with the
 * player profile and the player's profiles row (name/avatar).
 * Returns an array of roster members.
 */
export async function getActiveMembershipsForTeam(
  teamProfileId: string,
): Promise<TeamMembershipWithPlayer[]> {
  const { data, error } = await supabaseAdmin
    .from("team_memberships")
    .select(
      `
      id,
      team_profile_id,
      player_profile_id,
      position,
      role,
      status,
      joined_at,
      created_at,
      updated_at,
      player_profile:player_profile_id (
        id,
        profile_photo_url,
        profile:user_id (
          full_name,
          avatar_url
        )
      )
    `,
    )
    .eq("team_profile_id", teamProfileId)
    .eq("status", "active");

  if (error) {
    console.error("Failed to fetch team roster memberships:", error);
    return [];
  }

  return filterActiveMemberships(
    (data ?? []) as unknown as TeamMembershipWithPlayer[],
  );
}