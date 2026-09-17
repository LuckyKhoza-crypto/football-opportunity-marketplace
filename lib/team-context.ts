export const SELECTED_TEAM_COOKIE = "fom-selected-team";
export const SELECTED_TEAM_STORAGE_KEY = "fom-selected-team";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return UUID_REGEX.test(teamId) ? teamId : null;
}

/**
 * Read the persisted selected team ID from localStorage (client-side).
 * Returns null if not set or invalid.
 */
export function getSelectedTeamIdFromLocalStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(SELECTED_TEAM_STORAGE_KEY);
    if (!stored) return null;
    return UUID_REGEX.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Persist the selected team ID to localStorage (client-side).
 */
export function persistSelectedTeamId(teamId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SELECTED_TEAM_STORAGE_KEY, teamId);
  } catch {
    // localStorage may be unavailable
  }
  try {
    document.cookie = `${SELECTED_TEAM_COOKIE}=${encodeURIComponent(teamId)}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // cookie may be unavailable
  }
}

export function withTeamParam(
  path: string,
  teamId: string | null | undefined,
): string {
  if (!teamId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}team=${encodeURIComponent(teamId)}`;
}