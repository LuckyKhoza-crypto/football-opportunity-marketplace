import type { PublicTeamInvite } from "@/types";

/**
 * TEAM-003 — Invite landing page state helpers.
 *
 * Pure functions that map a resolved invite + authentication state to
 * the UI state the join page renders. Kept free of any database or
 * Next.js imports so they are trivially unit-testable and can never
 * accidentally reach for service-role credentials.
 */

export type InvitePageState =
  | "not_found"
  | "expired"
  | "revoked"
  | "pending_authenticated"
  | "pending_unauthenticated";

/**
 * Derive the page state from the resolved invite and session presence.
 *
 * A team invite is a reusable shared recruitment link — it is never
 * "accepted" as a whole. Historical acceptances are represented by
 * team_memberships rows, never by mutating the invite itself.
 *
 *   invite === null             -> not_found
 *   invite.state === "expired"  -> expired
 *   invite.state === "revoked"  -> revoked
 *   invite.state === "pending"  -> pending_authenticated | pending_unauthenticated
 */
export function getInvitePageState(
  invite: PublicTeamInvite | null,
  isAuthenticated: boolean,
): InvitePageState {
  if (!invite) return "not_found";
  switch (invite.state) {
    case "expired":
      return "expired";
    case "revoked":
      return "revoked";
    case "pending":
      return isAuthenticated ? "pending_authenticated" : "pending_unauthenticated";
  }
}

/**
 * The action label shown for a pending invite, or null when the invite
 * cannot be accepted. TEAM-003 only surfaces the action — the actual
 * acceptance transaction is implemented by TEAM-004.
 */
export function getInviteAction(
  state: InvitePageState,
): { label: string } | null {
  if (state === "pending_authenticated" || state === "pending_unauthenticated") {
    return { label: "Accept Invite" };
  }
  return null;
}

/**
 * Build the login URL that preserves the original invite path through
 * authentication. The token is URL-encoded so it survives the round trip.
 */
export function buildInviteLoginUrl(token: string): string {
  const encoded = encodeURIComponent(token);
  return `/login?callbackUrl=/team/join/${encoded}`;
}

/**
 * Build the canonical invite path for a token (used for display and
 * for the callback URL passed to NextAuth).
 */
export function buildInvitePath(token: string): string {
  return `/team/join/${encodeURIComponent(token)}`;
}