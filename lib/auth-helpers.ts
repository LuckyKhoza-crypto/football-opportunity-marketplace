import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { UserRole } from "@/types";

/**
 * Get the current session on the server side.
 */
export async function getSession() {
  return getServerSession(authOptions);
}

/**
 * Require authentication. Redirects to /login if not authenticated.
 */
export async function requireAuth() {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  return session;
}

/**
 * Check if the user has a specific role.
 */
export function hasRole(roles: string[] | undefined, role: string): boolean {
  return Array.isArray(roles) && roles.includes(role);
}

/**
 * Check if the user has the player role capability.
 */
export function hasPlayerRole(roles: string[] | undefined): boolean {
  return hasRole(roles, "player");
}

/**
 * Check if the user has the team role capability.
 */
export function hasTeamRole(roles: string[] | undefined): boolean {
  return hasRole(roles, "team");
}

/**
 * Check if the user can access the player area.
 * Requires the player role capability.
 */
export function canAccessPlayerArea(roles: string[] | undefined): boolean {
  return hasPlayerRole(roles);
}

/**
 * Check if the user can access the team area.
 * Requires the team role capability.
 */
export function canAccessTeamArea(roles: string[] | undefined): boolean {
  return hasTeamRole(roles);
}

/**
 * Redirect to the appropriate dashboard based on the user's roles.
 * If the user has no roles, redirects to onboarding.
 */
export function redirectToDashboard(roles: string[] | undefined) {
  if (!roles || roles.length === 0) {
    redirect("/onboarding");
  }
  if (roles.includes("player")) {
    redirect("/player");
  }
  if (roles.includes("team")) {
    redirect("/team");
  }
  redirect("/onboarding");
}

/**
 * Require a specific role. Redirects to the appropriate area if wrong role.
 */
export async function requireRole(allowedRoles: UserRole[]) {
  const session = await requireAuth();
  const userRoles = session.user.roles as string[] | undefined;

  if (!userRoles || userRoles.length === 0) {
    redirect("/onboarding");
  }

  const hasAllowedRole = allowedRoles.some((role) => userRoles.includes(role));

  if (!hasAllowedRole) {
    redirectToDashboard(userRoles);
  }

  return session;
}

/**
 * Get the current user's roles from the session.
 */
export async function getUserRoles(): Promise<string[]> {
  const session = await getSession();
  return (session?.user?.roles as string[]) ?? [];
}
