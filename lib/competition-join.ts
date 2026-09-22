import { createHash, randomBytes, randomInt } from "node:crypto";
import type {
  CompetitionEventStatus,
  CompetitionJoinLink,
  CompetitionJoinLinkState,
} from "@/types";

/**
 * COMP-003 — Pure (client-safe) competition join-link helpers.
 *
 * These functions contain no I/O and no Supabase access, so they can be
 * imported from both client and server code and unit-tested in isolation.
 * Server-side authorization/data access lives in lib/competition-join-server.ts.
 *
 * A competition join link is a REUSABLE shared entry link (rendered as a QR
 * code). It is never consumed by a single registration — many participants may
 * scan the same link while it remains usable.
 */

// ═══════════════════════════════════════════════════════════════
// Join token generation / hashing
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a cryptographically secure competition join token.
 *
 * Uses Node's crypto.randomBytes (256 bits of entropy) — never Math.random(),
 * timestamps, sequential IDs, or event/ambassador/profile IDs. The token is
 * URL-safe and suitable for use in a public join URL path and QR code.
 */
export function generateJoinToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Deterministic SHA-256 digest of a raw join token.
 *
 * Only this digest is persisted in competition_join_links.token_hash. The raw
 * token is returned to the manager exactly once at creation time and is never
 * stored or logged. A database leak therefore does not expose active join URLs.
 */
export function hashJoinToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ═══════════════════════════════════════════════════════════════
// Join-link state (derived — never a status column)
// ═══════════════════════════════════════════════════════════════

/**
 * Derive the join-link state from its timestamp.
 *
 *   revoked_at != null -> revoked
 *   otherwise          -> active
 */
export function getJoinLinkState(
  link: Pick<CompetitionJoinLink, "revoked_at"> | null | undefined,
): CompetitionJoinLinkState {
  if (!link) return "revoked";
  if (link.revoked_at != null) return "revoked";
  return "active";
}

/**
 * True when the join link can still be used to register participants.
 */
export function isJoinLinkUsable(
  link: Pick<CompetitionJoinLink, "revoked_at"> | null | undefined,
): boolean {
  return getJoinLinkState(link) === "active";
}

// ═══════════════════════════════════════════════════════════════
// Event eligibility
// ═══════════════════════════════════════════════════════════════

/**
 * Whether an event is currently accepting registrations.
 *
 * For the MVP only `active` events accept registration. `draft`, `drawing`,
 * `completed` and `cancelled` do NOT. This is enforced server-side — the public
 * page hiding the button is never sufficient.
 */
export function isEventOpenForRegistration(
  status: CompetitionEventStatus,
): boolean {
  return status === "active";
}

/**
 * Human-readable reason an event is not accepting registration (for the
 * public page). Returns null when the event IS open.
 */
export function getRegistrationClosedReason(
  status: CompetitionEventStatus,
): string | null {
  switch (status) {
    case "active":
      return null;
    case "draft":
      return "This competition is not open for registration yet.";
    case "drawing":
      return "This competition is no longer accepting registrations.";
    case "completed":
      return "This competition has ended.";
    case "cancelled":
      return "This competition has been cancelled.";
  }
}

// ═══════════════════════════════════════════════════════════════
// Join page state
// ═══════════════════════════════════════════════════════════════

export type JoinPageState =
  | "not_found"
  | "revoked"
  | "open_unauthenticated"
  | "open_authenticated"
  | "closed";

/**
 * Derive the public join page state from a resolved link + authentication
 * presence. A link that resolves is either revoked or active; an active link is
 * only actionable when the event is open for registration.
 */
export function getJoinPageState(
  link: { state: CompetitionJoinLinkState; eventOpen: boolean } | null,
  isAuthenticated: boolean,
): JoinPageState {
  if (!link) return "not_found";
  if (link.state === "revoked") return "revoked";
  if (!link.eventOpen) return "closed";
  return isAuthenticated ? "open_authenticated" : "open_unauthenticated";
}

// ═══════════════════════════════════════════════════════════════
// Join URL / path builders
// ═══════════════════════════════════════════════════════════════

/**
 * Build the canonical public join path for a token (used for display and for
 * the callback URL passed to NextAuth). The token is URL-encoded so it
 * survives the round trip.
 */
export function buildCompetitionJoinPath(token: string): string {
  return `/competitions/join/${encodeURIComponent(token)}`;
}

/**
 * Build the login URL that preserves the original join path through
 * authentication. Reuses the existing safe callbackUrl continuation pattern.
 */
export function buildCompetitionJoinLoginUrl(token: string): string {
  const path = buildCompetitionJoinPath(token);
  return `/login?callbackUrl=${encodeURIComponent(path)}`;
}

/**
 * Build the absolute public join URL from an origin (e.g. request origin).
 * Only the opaque public token is embedded — never participant data, emails,
 * profile ids, or private event information.
 */
export function buildCompetitionJoinUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${buildCompetitionJoinPath(token)}`;
}

// ═══════════════════════════════════════════════════════════════
// Participant verification token / pass identifier
// ═══════════════════════════════════════════════════════════════

// Unambiguous alphabet (no 0/O/1/I) so a code can be read aloud or typed.
const VERIFICATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VERIFICATION_CODE_LENGTH = 8;

/**
 * Generate a short, human-readable, random participant verification code.
 *
 * Used as the public pass identifier an ambassador can later use to locate a
 * participant. Random (crypto.randomInt) and non-guessable — never derived from
 * email, profile id, or player profile id.
 */
export function generateVerificationCode(): string {
  let code = "";
  for (let i = 0; i < VERIFICATION_CODE_LENGTH; i += 1) {
    code += VERIFICATION_CODE_ALPHABET[randomInt(VERIFICATION_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Generate a longer, opaque participant verification token. The raw token is
 * shown once (future QR-scan flow); only its digest is persisted.
 */
export function generateVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Deterministic SHA-256 digest of a raw verification token.
 */
export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Format a verification code for display (e.g. "ABCD1234" -> "ABCD-1234").
 */
export function formatVerificationCode(code: string): string {
  if (code.length !== VERIFICATION_CODE_LENGTH) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}