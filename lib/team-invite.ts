import { createHash, randomBytes } from "node:crypto";
import type { TeamInvite, TeamInviteState } from "@/types";

/**
 * Central default lifetime for newly generated invites.
 * Defined here once so the value is never scattered across files.
 */
export const TEAM_INVITE_EXPIRY_DAYS = 7;

/**
 * Generate a cryptographically secure invite token.
 *
 * Uses Node's crypto.randomBytes (256 bits of entropy) — never
 * Math.random(), timestamps, sequential IDs, or team/user IDs.
 * The token is URL-safe and suitable for use in a join URL path.
 */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Deterministic SHA-256 digest of a raw invite token.
 *
 * Only this digest is persisted in team_invites.token_hash. The raw
 * token is returned to the manager exactly once at creation time and
 * is never stored or logged. A database leak therefore does not expose
 * active invite URLs.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Derive the invite state from timestamps.
 *
 * There is intentionally NO status column: state is derived so it can
 * never drift out of sync with the underlying timestamps.
 *
 * A team invite is a reusable shared recruitment link — it is NOT
 * consumed by a single acceptance. Historical acceptances are
 * represented by team_memberships rows, never by mutating the invite.
 *
 *   revoked_at  != null  → revoked
 *   expires_at  <= now() → expired
 *   otherwise            → pending
 */
export function getTeamInviteState(
  invite: Pick<TeamInvite, "revoked_at" | "expires_at"> | null | undefined,
  now: Date = new Date(),
): TeamInviteState {
  if (!invite) return "expired";
  if (invite.revoked_at != null) return "revoked";
  if (new Date(invite.expires_at).getTime() <= now.getTime()) return "expired";
  return "pending";
}

/**
 * True when the invite can still be accepted.
 *
 * Enforces revocation (revoked_at) and expiration (expires_at <= now).
 * The invite remains usable for any eligible player until it expires
 * or the team revokes it.
 */
export function isInviteUsable(
  invite: Pick<TeamInvite, "revoked_at" | "expires_at"> | null | undefined,
  now: Date = new Date(),
): boolean {
  return getTeamInviteState(invite, now) === "pending";
}

/**
 * Compute the expiration timestamp for a newly created invite.
 */
export function getInviteExpiration(
  now: Date = new Date(),
  expiryDays: number = TEAM_INVITE_EXPIRY_DAYS,
): Date {
  const expires = new Date(now);
  expires.setUTCDate(expires.getUTCDate() + expiryDays);
  return expires;
}