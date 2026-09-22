import { describe, it, expect } from "vitest";
import {
  generateJoinToken,
  hashJoinToken,
  getJoinLinkState,
  isJoinLinkUsable,
  isEventOpenForRegistration,
  getRegistrationClosedReason,
  getJoinPageState,
  buildCompetitionJoinPath,
  buildCompetitionJoinLoginUrl,
  buildCompetitionJoinUrl,
  generateVerificationCode,
  hashVerificationToken,
  formatVerificationCode,
} from "@/lib/competition-join";
import { isSafeCallbackUrl } from "@/lib/invite-callback";

/**
 * COMP-003 — Pure join-link helper tests.
 *
 * These cover token generation/hashing, derived link state, event eligibility,
 * join-page state, URL building, and the participant verification code.
 */

describe("COMP-003: join token generation", () => {
  it("generates URL-safe, high-entropy tokens", () => {
    const token = generateJoinToken();
    // base64url alphabet only.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes -> 43 base64url chars (no padding).
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("generates a different token each time", () => {
    const a = generateJoinToken();
    const b = generateJoinToken();
    expect(a).not.toBe(b);
  });

  it("does not embed predictable values (no sequential/id-like output)", () => {
    // A raw token must not equal its own hash, nor a short numeric string.
    const token = generateJoinToken();
    expect(token).not.toMatch(/^\d+$/);
    expect(token).not.toBe(hashJoinToken(token));
  });
});

describe("COMP-003: join token hashing", () => {
  it("is deterministic", () => {
    const token = "AbC123token";
    expect(hashJoinToken(token)).toBe(hashJoinToken(token));
  });

  it("produces a 64-char SHA-256 hex digest and never equals the raw token", () => {
    const token = generateJoinToken();
    const hash = hashJoinToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
  });

  it("different tokens produce different hashes", () => {
    expect(hashJoinToken("a")).not.toBe(hashJoinToken("b"));
  });
});

describe("COMP-003: join-link state", () => {
  it("is active when not revoked", () => {
    expect(getJoinLinkState({ revoked_at: null })).toBe("active");
    expect(isJoinLinkUsable({ revoked_at: null })).toBe(true);
  });

  it("is revoked when revoked_at is set", () => {
    expect(getJoinLinkState({ revoked_at: "2025-01-01T00:00:00Z" })).toBe(
      "revoked",
    );
    expect(isJoinLinkUsable({ revoked_at: "2025-01-01T00:00:00Z" })).toBe(false);
  });

  it("treats a missing link as revoked", () => {
    expect(getJoinLinkState(null)).toBe("revoked");
    expect(isJoinLinkUsable(undefined)).toBe(false);
  });
});

describe("COMP-003: event eligibility", () => {
  it("only active events accept registration", () => {
    expect(isEventOpenForRegistration("active")).toBe(true);
    expect(isEventOpenForRegistration("draft")).toBe(false);
    expect(isEventOpenForRegistration("drawing")).toBe(false);
    expect(isEventOpenForRegistration("completed")).toBe(false);
    expect(isEventOpenForRegistration("cancelled")).toBe(false);
  });

  it("returns a null reason only for active events", () => {
    expect(getRegistrationClosedReason("active")).toBeNull();
    expect(getRegistrationClosedReason("draft")).toBeTruthy();
    expect(getRegistrationClosedReason("drawing")).toBeTruthy();
    expect(getRegistrationClosedReason("completed")).toBeTruthy();
    expect(getRegistrationClosedReason("cancelled")).toBeTruthy();
  });
});

describe("COMP-003: join page state", () => {
  it("is not_found when the link does not resolve", () => {
    expect(getJoinPageState(null, false)).toBe("not_found");
    expect(getJoinPageState(null, true)).toBe("not_found");
  });

  it("is revoked for a revoked link", () => {
    expect(
      getJoinPageState({ state: "revoked", eventOpen: true }, true),
    ).toBe("revoked");
  });

  it("is closed when the event is not accepting registration", () => {
    expect(
      getJoinPageState({ state: "active", eventOpen: false }, true),
    ).toBe("closed");
  });

  it("distinguishes authenticated / unauthenticated for an open event", () => {
    expect(
      getJoinPageState({ state: "active", eventOpen: true }, false),
    ).toBe("open_unauthenticated");
    expect(
      getJoinPageState({ state: "active", eventOpen: true }, true),
    ).toBe("open_authenticated");
  });
});

describe("COMP-003: join URL builders", () => {
  it("builds the canonical join path with an encoded token", () => {
    expect(buildCompetitionJoinPath("a/b+c")).toBe(
      "/competitions/join/a%2Fb%2Bc",
    );
  });

  it("builds a login URL that preserves the join path via callbackUrl", () => {
    const url = buildCompetitionJoinLoginUrl("tok");
    expect(url).toBe(
      "/login?callbackUrl=%2Fcompetitions%2Fjoin%2Ftok",
    );
  });

  it("builds an absolute join URL from an origin (no duplicate slash)", () => {
    expect(buildCompetitionJoinUrl("https://example.com/", "tok")).toBe(
      "https://example.com/competitions/join/tok",
    );
  });

  it("produces a callbackUrl that the existing safe-callback guard accepts", () => {
    // The login page validates callbackUrl with the SAME helper used by team
    // invites. The decoded callback must yield a safe internal path.
    const loginUrl = buildCompetitionJoinLoginUrl("tok");
    const callbackValue = decodeURIComponent(
      loginUrl.replace("/login?callbackUrl=", ""),
    );
    expect(isSafeCallbackUrl(callbackValue)).toBe(true);
    expect(callbackValue.startsWith("/competitions/join/")).toBe(true);
  });

  it("cannot be used to inject an external redirect", () => {
    const loginUrl = buildCompetitionJoinLoginUrl("tok");
    // The callbackUrl is always a percent-encoded internal path; no scheme.
    expect(loginUrl).not.toContain("http");
    expect(loginUrl).toContain("callbackUrl=%2Fcompetitions%2Fjoin%2F");
  });

  it("embeds only the public token — never an id/email", () => {
    const url = buildCompetitionJoinUrl("https://example.com", "tok");
    expect(url).toContain("/competitions/join/tok");
    expect(url).not.toContain("@");
  });
});

describe("COMP-003: participant verification code", () => {
  it("generates an 8-char code from the unambiguous alphabet", () => {
    const code = generateVerificationCode();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it("does not derive the code from an email or profile id", () => {
    const code = generateVerificationCode();
    expect(code).not.toContain("@");
    // Random each call.
    expect(code).not.toBe(generateVerificationCode());
  });

  it("hashes verification tokens deterministically", () => {
    expect(hashVerificationToken("x")).toBe(hashVerificationToken("x"));
    expect(hashVerificationToken("x")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("formats a code for display", () => {
    expect(formatVerificationCode("ABCD2345")).toBe("ABCD-2345");
    // Unknown-length codes are returned unchanged.
    expect(formatVerificationCode("ABC")).toBe("ABC");
  });
});