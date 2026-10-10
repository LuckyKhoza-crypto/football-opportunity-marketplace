import { createHash, randomBytes, randomInt } from "node:crypto";
import { isActiveParticipant } from "@/lib/competition";
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
// Player self-unregistration (T-REM-2)
// ═══════════════════════════════════════════════════════════════

/**
 * The `removal_reason` recorded for a player unregistering THEMSELVES. Kept as
 * a named constant so the value is consistent everywhere and later tickets
 * (host/ambassador removal) can record a different, equally explicit reason.
 */
export const COMPETITION_SELF_REMOVAL_REASON = "self_unregistration";

/**
 * The data needed to decide whether a participant may unregister. Deliberately
 * primitive so it can be built from a pass row or a fresh server read.
 */
export interface CompetitionWithdrawalState {
  /** The event lifecycle status. */
  eventStatus: CompetitionEventStatus;
  /** `competition_participants.removed_at` (null/undefined === active). */
  removedAt: string | null | undefined;
  /** `competition_participants.checked_in_at` (null when not checked in). */
  checkedInAt: string | null | undefined;
  /** Whether the participant has ANY recorded `competition_attempts`. */
  hasAttempts: boolean;
  /** Whether the participant is mapped to an external tournament. */
  providerMapped: boolean;
}

/**
 * T-REM-2 — Withdrawal eligibility rule.
 *
 * Returns the human-readable reason withdrawal is BLOCKED, or `null` when the
 * participant is allowed to unregister. It is intentionally pure so the player
 * UI (which hides/disables the action) and the authoritative server mutation
 * share the SAME rule and cannot drift apart. Hiding the button is never the
 * gate — `withdrawFromCompetition` re-applies this rule server-side.
 *
 * A participant may unregister only while:
 *   * the event is still accepting registrations (`active`); once it moves to
 *     `drawing` / `completed` / `cancelled` the participant list is frozen,
 *   * the registration is still active (`removed_at IS NULL`),
 *   * they have NOT checked in,
 *   * they have NO recorded attempts,
 *   * they have NOT been synchronized to an external tournament.
 *
 * The messages never mention a provider or an internal id.
 */
export function getWithdrawalBlockReason(
  state: CompetitionWithdrawalState,
): string | null {
  // Withdrawal follows the registration window: only an `active` event accepts
  // (or releases) participants.
  if (!isEventOpenForRegistration(state.eventStatus)) {
    return "This competition is no longer accepting withdrawals.";
  }

  // Reuse the T-REM-1 active-participant rule rather than re-deriving it.
  if (!isActiveParticipant({ removed_at: state.removedAt ?? null })) {
    return "You have already unregistered from this competition.";
  }

  if (state.checkedInAt != null) {
    return "You have already checked in and can no longer unregister.";
  }

  if (state.hasAttempts) {
    return "You have already started the challenge and can no longer unregister.";
  }

  if (state.providerMapped) {
    return "You can no longer unregister from this competition.";
  }

  return null;
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
// Participant verification URL (pass QR payload)
// ═══════════════════════════════════════════════════════════════

/**
 * Build the canonical public verification path for an opaque participant
 * token. This is the ONLY payload encoded in the participant pass QR — it
 * never contains a profile id, participant id, email or event id.
 */
export const COMPETITION_VERIFY_PATH_PREFIX = "/competitions/verify/";

export function buildCompetitionVerifyPath(token: string): string {
  return `${COMPETITION_VERIFY_PATH_PREFIX}${encodeURIComponent(token)}`;
}

/**
 * Build the absolute verification URL (the pass QR payload) from an origin.
 *
 * This is the single source of truth for the payload shown on the participant
 * pass. Server and client both derive the encoded string from here so the QR
 * displayed on screen and any QR generated from the same token are identical.
 */
export function buildCompetitionVerifyUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${buildCompetitionVerifyPath(token)}`;
}

// ═══════════════════════════════════════════════════════════════
// Hosted verification-QR image (COMP-EMAIL-001)
// ═══════════════════════════════════════════════════════════════

/**
 * Build the canonical path of the PUBLIC hosted PNG for a participant's
 * verification QR. The image is rendered server-side
 * (`app/api/competitions/verify-qr/[token]/route.ts`) from the SAME opaque token
 * as `buildCompetitionVerifyPath`, so the emailed QR and the on-screen pass QR
 * encode an identical payload.
 *
 * Only the opaque token is embedded — never a profile id, participant id, email
 * or event id.
 */
export function buildCompetitionVerifyQrPath(token: string): string {
  return `/api/competitions/verify-qr/${encodeURIComponent(token)}`;
}

/**
 * Build the absolute hosted verification-QR image URL from an origin (e.g. the
 * request origin).
 *
 * This URL is what the confirmation email references with a plain
 * `<img src="https://…">`. It is used instead of a `data:` URI (which Gmail
 * strips from HTML bodies) and instead of a Content-ID (`cid:`) inline
 * attachment (which Brevo's transactional API does not support — it never sets a
 * Content-ID header). The PNG itself is produced from the exact pass payload.
 */
export function buildCompetitionVerifyQrImageUrl(
  origin: string,
  token: string,
): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${buildCompetitionVerifyQrPath(token)}`;
}

/**
 * Derive the hosted QR image URL from the EXACT pass `verifyUrl`.
 *
 * The path is swapped from `/competitions/verify/<token>` to
 * `/api/competitions/verify-qr/<token>` using the same origin, so the QR served
 * for the email encodes the identical payload shown on the participant pass.
 */
export function buildCompetitionVerifyQrImageUrlFromVerifyUrl(
  verifyUrl: string,
): string {
  const { origin, pathname } = new URL(verifyUrl);
  if (!pathname.startsWith(COMPETITION_VERIFY_PATH_PREFIX)) {
    throw new Error("A competition verification URL is required.");
  }
  const encodedToken = pathname.slice(COMPETITION_VERIFY_PATH_PREFIX.length);
  if (!encodedToken || encodedToken.includes("/")) {
    throw new Error("A verification URL with an opaque token is required.");
  }
  return buildCompetitionVerifyQrImageUrl(origin, decodeURIComponent(encodedToken));
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