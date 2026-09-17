import "server-only";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSelectedTeamId, SELECTED_TEAM_COOKIE } from "@/lib/team-context";
import type { TeamProfile } from "@/types";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the persisted selected team ID from the cookie (server-side).
 * Returns null if not set or invalid.
 */
export async function getSelectedTeamIdFromCookie(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const teamId = cookieStore.get(SELECTED_TEAM_COOKIE)?.value;
    if (!teamId) return null;
    return UUID_REGEX.test(teamId) ? teamId : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the selected team ID from URL params first, then fall back to
 * the persisted cookie value. This ensures the user's selected team
 * persists across page navigations even when the `?team=` param is absent.
 */
export async function getSelectedTeamIdWithFallback(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
): Promise<string | null> {
  const fromParams = getSelectedTeamId(searchParams);
  if (fromParams) return fromParams;
  return getSelectedTeamIdFromCookie();
}

export async function getUserTeams(userId: string): Promise<TeamProfile[]> {
  const { data, error } = await supabaseAdmin
    .from("team_profiles")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to fetch user teams:", error);
    return [];
  }
  return (data ?? []) as unknown as TeamProfile[];
}

export async function verifyTeamOwnership(
  userId: string,
  teamId: string,
): Promise<TeamProfile | null> {
  const { data, error } = await supabaseAdmin
    .from("team_profiles")
    .select("*")
    .eq("id", teamId)
    .eq("user_id", userId)
    .single();
  if (error || !data) return null;
  return data as unknown as TeamProfile;
}

export async function resolveSelectedTeam(
  userId: string,
  teamId: string | null,
): Promise<TeamProfile | null> {
  if (teamId) {
    const team = await verifyTeamOwnership(userId, teamId);
    if (team) return team;
    return null;
  }
  const teams = await getUserTeams(userId);
  return teams[0] ?? null;
}