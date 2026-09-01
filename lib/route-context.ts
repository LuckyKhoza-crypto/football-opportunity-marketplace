/**
 * Route context utility — determines whether a given pathname
 * represents a player management area, team management area, public
 * resource, or neutral route.
 *
 * This is used by the AppView provider to auto-sync the active view
 * when navigating to management routes, and by the middleware to
 * determine which role check to apply.
 */

export type RouteContext = "player" | "team" | "public" | "neutral";

/**
 * Player management route prefixes.
 * Visiting these establishes Player View.
 */
const PLAYER_MGMT_PREFIXES = ["/player", "/player/onboarding", "/player/profile", "/player/find-team"];

/**
 * Team management route prefixes.
 * Visiting these establishes Team View.
 */
const TEAM_MGMT_PREFIXES = ["/team", "/team/onboarding", "/team/profile", "/team/opportunities", "/team/find-players", "/team/players"];

/**
 * Public resource route prefixes.
 * Visiting these should NOT change the active view.
 */
const PUBLIC_PREFIXES = ["/players", "/teams", "/opportunities"];

/**
 * Determine the route context for a given pathname.
 */
export function getRouteContext(pathname: string): RouteContext {
  const normalized = pathname.split("?")[0].split("#")[0];

  // Check player management routes first (more specific)
  if (PLAYER_MGMT_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix + "/") || normalized.startsWith(prefix + "?"))) {
    return "player";
  }

  // Check team management routes
  if (TEAM_MGMT_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix + "/") || normalized.startsWith(prefix + "?"))) {
    return "team";
  }

  // Check public resource routes
  if (PUBLIC_PREFIXES.some((prefix) => normalized.startsWith(prefix + "/") || normalized === prefix)) {
    return "public";
  }

  return "neutral";
}

/**
 * Check if a route is a player management route.
 */
export function isPlayerRoute(pathname: string): boolean {
  return getRouteContext(pathname) === "player";
}

/**
 * Check if a route is a team management route.
 */
export function isTeamRoute(pathname: string): boolean {
  return getRouteContext(pathname) === "team";
}

/**
 * Check if a route is a public resource route.
 */
export function isPublicRoute(pathname: string): boolean {
  return getRouteContext(pathname) === "public";
}