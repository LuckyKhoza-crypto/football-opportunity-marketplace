import type { TeamMembership, TeamMembershipStatus } from "@/types";

/**
 * Canonical membership status for the current MVP.
 * Only 'active' exists today. Extend here (and in the DB CHECK
 * constraint) when a real roster lifecycle lands.
 */
export const TEAM_MEMBERSHIP_STATUS: TeamMembershipStatus = "active";

/**
 * True when the membership references the given team profile.
 *
 * TEAM-001 scopes every membership to a specific team_profile_id —
 * never merely to the manager's profiles.id. This is what keeps the
 * multi-team architecture intact (one manager → many teams).
 */
export function isMembershipForTeam(
  membership: Pick<TeamMembership, "team_profile_id"> | null | undefined,
  teamProfileId: string,
): boolean {
  return !!membership && membership.team_profile_id === teamProfileId;
}

/**
 * True when the membership references the given player profile.
 */
export function isMembershipForPlayer(
  membership: Pick<TeamMembership, "player_profile_id"> | null | undefined,
  playerProfileId: string,
): boolean {
  return !!membership && membership.player_profile_id === playerProfileId;
}

/**
 * True when the membership is currently active.
 */
export function isActiveMembership(
  membership: Pick<TeamMembership, "status"> | null | undefined,
): membership is TeamMembership {
  return !!membership && membership.status === "active";
}

/**
 * Filter a list of memberships down to only active ones.
 *
 * The database query should already filter with `.eq("status", "active")`;
 * this helper is a defensive second layer for server-side loaders and
 * unit tests. It is generic so it works with both TeamMembershipWithTeam
 * and TeamMembershipWithPlayer (and any future membership shape).
 */
export function filterActiveMemberships<T extends Pick<TeamMembership, "status">>(
  memberships: readonly T[] | null | undefined,
): T[] {
  if (!memberships) return [];
  return memberships.filter((m) => m.status === "active");
}

/**
 * True when the manager's owned team list contains the team this
 * membership belongs to.
 *
 * This intentionally takes a LIST of owned team IDs rather than a
 * single team ID: it is the authorization helper for the multi-team
 * architecture and must not assume team_profiles.user_id is unique.
 */
export function canAccessMembershipForTeam(
  membership: Pick<TeamMembership, "team_profile_id"> | null | undefined,
  ownedTeamProfileIds: readonly string[],
): boolean {
  if (!membership) return false;
  return ownedTeamProfileIds.includes(membership.team_profile_id);
}