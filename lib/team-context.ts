import { supabaseAdmin } from "@/lib/supabase-admin";
import type { TeamProfile } from "@/types";

/**
 * Team context helpers for the multi-team feature.
 * The selected team is UI context only — passed via `?team=<id>`.
 * Every server operation must verify team ownership independently.
 */

export function getSelectedTeamId(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
): string | null {
  let teamId: string | null = null;
  if (searchParams instanceof URLSearchParams) {
    teamId = searchParams.get("team");
  } else {
    const raw = searchParams.team;
    if (typeof raw === "string") teamId = raw;
  }
  if (!teamId) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(teamId) ? teamId : null;
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

export function withTeamParam(
  path: string,
  teamId: string | null | undefined,
): string {
  if (!teamId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}team=${encodeURIComponent(teamId)}`;
}