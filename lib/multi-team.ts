import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Centralized authorization helper for the multi-team capability.
 *
 * The ability to manage multiple team profiles is a permission/capability,
 * NOT a marketplace role. It is controlled by a server-side environment
 * variable containing the authorized user's profiles.id.
 *
 * This value must NEVER be exposed to the browser. Do not use
 * NEXT_PUBLIC_MULTI_TEAM_ADMIN_USER_ID.
 */

/**
 * Check whether a user ID is the configured multi-team administrator.
 * Server-side only.
 */
export function canManageMultipleTeams(userId: string): boolean {
  const adminUserId = process.env.MULTI_TEAM_ADMIN_USER_ID;
  if (!adminUserId) return false;
  return userId === adminUserId;
}

/**
 * Get the multi-team admin user ID from the environment.
 * Server-side only.
 */
export function getMultiTeamAdminUserId(): string | null {
  return process.env.MULTI_TEAM_ADMIN_USER_ID ?? null;
}

/**
 * Check whether the current authenticated session user
 * has the multi-team capability.
 * Server-side only.
 */
export async function isMultiTeamAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return false;
  return canManageMultipleTeams(session.user.id);
}