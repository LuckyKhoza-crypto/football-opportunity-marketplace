import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/competition-attempt-server", () => ({
  listCompetitionParticipantsWithState: vi.fn(),
  verifyCompetitionParticipantByCode: vi.fn(),
  verifyCompetitionParticipantByToken: vi.fn(),
  recordCompetitionAttempt: vi.fn(),
  getParticipantAttempts: vi.fn(),
  mintParticipantVerificationToken: vi.fn(),
}));

vi.mock("@/lib/competition-registration-notify", () => ({
  scheduleCompetitionRegistrationConfirmation: vi.fn(),
}));

import { getServerSession } from "next-auth";
import {
  listCompetitionParticipantsWithState,
  verifyCompetitionParticipantByCode,
  recordCompetitionAttempt,
  getParticipantAttempts,
  mintParticipantVerificationToken,
} from "@/lib/competition-attempt-server";
import { scheduleCompetitionRegistrationConfirmation } from "@/lib/competition-registration-notify";
import {
  listParticipantsHandler,
  verifyParticipantHandler,
  recordAttemptHandler,
  listAttemptsHandler,
  mintPassTokenHandler,
} from "@/lib/competition-attempt-api";
import { resolvePublicAppOrigin } from "@/lib/competition-public-origin";

/**
 * COMP-005 — API-level authorization wiring for the event-day operations
 * endpoints. These verify the route handlers resolve identity from the
 * authenticated session (never the body) and surface the server helper's
 * creator-or-ambassador decisions as HTTP statuses.
 */

const PROFILE_AMBASSADOR = "22222222-2222-4222-8222-222222222222";
const PROFILE_UNRELATED = "33333333-3333-4333-8333-333333333333";
const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARTICIPANT_1 = "p1111111-1111-4111-8111-111111111111";

function session(id: string) {
  return { user: { id, email: id + "@test.com" }, expires: "later" };
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("COMP-005 handler: GET /participants", () => {
  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await listParticipantsHandler(
      new Request("http://localhost/api/competitions/x/participants"),
      EVENT_A,
    );
    expect(res.status).toBe(401);
  });

  it("returns the participant list for an assigned ambassador", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      session(PROFILE_AMBASSADOR) as never,
    );
    vi.mocked(listCompetitionParticipantsWithState).mockResolvedValue([
      { id: PARTICIPANT_1 } as never,
    ]);

    const res = await listParticipantsHandler(
      new Request("http://localhost/api/competitions/x/participants"),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    // Identity is taken from the session, not the request.
    expect(listCompetitionParticipantsWithState).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_AMBASSADOR,
    );
    expect(data.participants).toHaveLength(1);
  });
});

describe("COMP-005 handler: POST /verify", () => {
  it("returns 403 when the helper refuses an unrelated user", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      session(PROFILE_UNRELATED) as never,
    );
    vi.mocked(verifyCompetitionParticipantByCode).mockResolvedValue({
      ok: false,
      error: "Not authorized to verify participants for this event",
      status: 403,
    });

    const res = await verifyParticipantHandler(
      jsonRequest("http://localhost/api/competitions/x/verify", {
        code: "ABCD2345",
      }),
      EVENT_A,
    );
    expect(res.status).toBe(403);
  });

  it("verifies a participant for an assigned ambassador", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      session(PROFILE_AMBASSADOR) as never,
    );
    vi.mocked(verifyCompetitionParticipantByCode).mockResolvedValue({
      ok: true,
      data: {
        participantId: PARTICIPANT_1,
        eventId: EVENT_A,
        status: "challenge_pending",
      } as never,
    });

    const res = await verifyParticipantHandler(
      jsonRequest("http://localhost/api/competitions/x/verify", {
        code: "abcd-2345",
      }),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(verifyCompetitionParticipantByCode).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_AMBASSADOR,
      "abcd-2345",
    );
    expect(data.participant.participantId).toBe(PARTICIPANT_1);
  });
});

describe("COMP-005 handler: POST /attempts", () => {
  it("records an attempt for an assigned ambassador (body carries only result_value)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      session(PROFILE_AMBASSADOR) as never,
    );
    vi.mocked(recordCompetitionAttempt).mockResolvedValue({
      ok: true,
      data: {
        attempt: { attempt_number: 1, passed: false },
        state: { attemptsUsed: 1, attemptsRemaining: 2 },
      } as never,
    });

    const res = await recordAttemptHandler(
      jsonRequest("http://localhost/api/competitions/x/participants/p1/attempts", {
        result_value: 12,
        // A hostile client attempt to inject server-owned fields is ignored.
        passed: true,
        attempt_number: 99,
      }),
      EVENT_A,
      PARTICIPANT_1,
    );

    expect(res.status).toBe(201);
    expect(recordCompetitionAttempt).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_AMBASSADOR,
      PARTICIPANT_1,
      12,
    );
  });

  it("returns the helper's 403 for an unrelated user", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      session(PROFILE_UNRELATED) as never,
    );
    vi.mocked(recordCompetitionAttempt).mockResolvedValue({
      ok: false,
      error: "Not authorized to record attempts for this event",
      status: 403,
    });

    const res = await recordAttemptHandler(
      jsonRequest("http://localhost/api/competitions/x/participants/p1/attempts", {
        result_value: 12,
      }),
      EVENT_A,
      PARTICIPANT_1,
    );
    expect(res.status).toBe(403);
  });
});

describe("COMP-005 handler: GET /participants/[id]/attempts", () => {
  it("returns attempts for a participant the operator can manage", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      session(PROFILE_AMBASSADOR) as never,
    );
    vi.mocked(listCompetitionParticipantsWithState).mockResolvedValue([
      { id: PARTICIPANT_1 } as never,
    ]);
    vi.mocked(getParticipantAttempts).mockResolvedValue([
      { attempt_number: 1, passed: false } as never,
    ]);

    const res = await listAttemptsHandler(
      new Request(
        "http://localhost/api/competitions/x/participants/p1/attempts",
      ),
      EVENT_A,
      PARTICIPANT_1,
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.attempts).toHaveLength(1);
  });

  it("returns 404 for a participant outside the operator's event", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      session(PROFILE_UNRELATED) as never,
    );
    // The list helper returns [] for a non-operator, so the participant is
    // never visible.
    vi.mocked(listCompetitionParticipantsWithState).mockResolvedValue([]);

    const res = await listAttemptsHandler(
      new Request(
        "http://localhost/api/competitions/x/participants/p1/attempts",
      ),
      EVENT_A,
      PARTICIPANT_1,
    );
    expect(res.status).toBe(404);
    expect(getParticipantAttempts).not.toHaveBeenCalled();
  });

describe("COMP-EMAIL-001 handler: POST /pass-token", () => {
  const PASS_URL = `http://localhost/api/competitions/${EVENT_A}/pass-token`;

  it("uses the configured PUBLIC origin for the pass + emailed QR (not a non-public request origin)", async () => {
    const prevApp = process.env.NEXT_PUBLIC_APP_URL;
    const prevNext = process.env.NEXTAUTH_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://www.fom-sports.com";
    delete process.env.NEXTAUTH_URL;
    try {
      vi.mocked(getServerSession).mockResolvedValue(
        session(PROFILE_AMBASSADOR) as never,
      );
      vi.mocked(mintParticipantVerificationToken).mockResolvedValue({
        ok: true,
        data: { token: "opaquetoken123" },
      });

      const res = await mintPassTokenHandler(
        new Request(PASS_URL, { method: "POST" }),
        EVENT_A,
      );
      const data = await res.json();

      // The request came in on a non-public host, but the QR payload (on-screen
      // AND emailed) is built from the canonical public origin so Gmail's image
      // proxy can fetch the hosted QR anonymously.
      const expected =
        "https://www.fom-sports.com/competitions/verify/opaquetoken123";
      expect(data.verifyUrl).toBe(expected);
      expect(scheduleCompetitionRegistrationConfirmation).toHaveBeenCalledWith({
        eventId: EVENT_A,
        profileId: PROFILE_AMBASSADOR,
        verifyUrl: expected,
      });
      // Still exactly ONE mint.
      expect(mintParticipantVerificationToken).toHaveBeenCalledTimes(1);
    } finally {
      if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prevApp;
      if (prevNext === undefined) delete process.env.NEXTAUTH_URL;
      else process.env.NEXTAUTH_URL = prevNext;
    }
  });

  it("returns the exact verifyUrl and schedules the confirmation with the SAME payload", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      session(PROFILE_AMBASSADOR) as never,
    );
    vi.mocked(mintParticipantVerificationToken).mockResolvedValue({
      ok: true,
      data: { token: "opaquetoken123" },
    });

    const res = await mintPassTokenHandler(
      new Request(PASS_URL, { method: "POST" }),
      EVENT_A,
    );
    const data = await res.json();

    const expectedVerifyUrl =
      "http://localhost/competitions/verify/opaquetoken123";

    expect(res.status).toBe(200);
    expect(data.token).toBe("opaquetoken123");
    expect(data.verifyUrl).toBe(expectedVerifyUrl);

    // REGRESSION: the URL returned for the on-screen QR is byte-for-byte the
    // same URL handed to the email path (so both QRs encode identical payloads).
    expect(scheduleCompetitionRegistrationConfirmation).toHaveBeenCalledTimes(1);
    expect(scheduleCompetitionRegistrationConfirmation).toHaveBeenCalledWith({
      eventId: EVENT_A,
      profileId: PROFILE_AMBASSADOR,
      verifyUrl: expectedVerifyUrl,
    });

    // Exactly ONE token mint — the email path must never mint a second token.
    expect(mintParticipantVerificationToken).toHaveBeenCalledTimes(1);
  });

  it("requires authentication (no mint, no email)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await mintPassTokenHandler(
      new Request(PASS_URL, { method: "POST" }),
      EVENT_A,
    );

    expect(res.status).toBe(401);
    expect(mintParticipantVerificationToken).not.toHaveBeenCalled();
    expect(scheduleCompetitionRegistrationConfirmation).not.toHaveBeenCalled();
  });

  it("does not schedule an email when the mint fails", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      session(PROFILE_AMBASSADOR) as never,
    );
    vi.mocked(mintParticipantVerificationToken).mockResolvedValue({
      ok: false,
      error: "Participant not found",
      status: 404,
    });

    const res = await mintPassTokenHandler(
      new Request(PASS_URL, { method: "POST" }),
      EVENT_A,
    );

    expect(res.status).toBe(404);
    expect(scheduleCompetitionRegistrationConfirmation).not.toHaveBeenCalled();
  });

  it("keeps the pass response successful even if scheduling throws", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      session(PROFILE_AMBASSADOR) as never,
    );
    vi.mocked(mintParticipantVerificationToken).mockResolvedValue({
      ok: true,
      data: { token: "opaquetoken123" },
    });
    vi.mocked(scheduleCompetitionRegistrationConfirmation).mockImplementationOnce(
      () => {
        throw new Error("email layer unavailable");
      },
    );

    const res = await mintPassTokenHandler(
      new Request(PASS_URL, { method: "POST" }),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.verifyUrl).toBe(
      "http://localhost/competitions/verify/opaquetoken123",
    );
  });
});
describe("COMP-EMAIL-001: public app origin resolution", () => {
  const REQUEST = "http://localhost:3000";
  const prevApp = process.env.NEXT_PUBLIC_APP_URL;
  const prevNext = process.env.NEXTAUTH_URL;

  afterEach(() => {
    if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevApp;
    if (prevNext === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = prevNext;
  });

  it("prefers NEXT_PUBLIC_APP_URL over NEXTAUTH_URL and the request origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.fom-sports.com";
    process.env.NEXTAUTH_URL = "https://fom-sports.com";
    expect(resolvePublicAppOrigin(REQUEST)).toBe("https://www.fom-sports.com");
  });

  it("falls back to NEXTAUTH_URL when NEXT_PUBLIC_APP_URL is unset", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXTAUTH_URL = "https://www.fom-sports.com";
    expect(resolvePublicAppOrigin(REQUEST)).toBe("https://www.fom-sports.com");
  });

  it("falls back to the request origin when nothing is configured", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXTAUTH_URL;
    expect(resolvePublicAppOrigin(REQUEST)).toBe(REQUEST);
  });

  it("normalises the configured URL to protocol + host (drops path/trailing slash)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.fom-sports.com/";
    expect(resolvePublicAppOrigin(REQUEST)).toBe("https://www.fom-sports.com");
  });

  it("falls back to the request origin for a malformed configured value", () => {
    process.env.NEXT_PUBLIC_APP_URL = "not a url";
    expect(resolvePublicAppOrigin(REQUEST)).toBe(REQUEST);
  });
});


});