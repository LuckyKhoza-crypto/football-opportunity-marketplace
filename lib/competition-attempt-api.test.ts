import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { getServerSession } from "next-auth";
import {
  listCompetitionParticipantsWithState,
  verifyCompetitionParticipantByCode,
  recordCompetitionAttempt,
  getParticipantAttempts,
} from "@/lib/competition-attempt-server";
import {
  listParticipantsHandler,
  verifyParticipantHandler,
  recordAttemptHandler,
  listAttemptsHandler,
} from "@/lib/competition-attempt-api";

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
});