import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/competition-participant-admin-server", () => ({
  removeCompetitionParticipant: vi.fn(),
  banCompetitionParticipant: vi.fn(),
}));

import { getServerSession } from "next-auth";
import {
  banCompetitionParticipant,
  removeCompetitionParticipant,
} from "@/lib/competition-participant-admin-server";
import {
  banParticipantHandler,
  removeParticipantHandler,
} from "@/lib/competition-participant-admin-api";

/**
 * T-REM-3 — route handlers.
 *
 * Verifies authentication, id/auth delegation and status mapping. The acting
 * profile MUST come from the session — never the request body.
 */

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARTICIPANT_1 = "p1111111-1111-4111-8111-111111111111";
const MANAGER = "99999999-9999-4999-8999-999999999999";

function session() {
  return {
    user: { id: MANAGER, email: "manager@test.com", name: "Manager" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

function request(body?: unknown) {
  return new Request(
    `http://localhost/api/competitions/${EVENT_A}/participants/${PARTICIPANT_1}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("T-REM-3: remove participant handler", () => {
  it("rejects an unauthenticated request with 401 and calls nothing", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await removeParticipantHandler(request(), EVENT_A, PARTICIPANT_1);

    expect(res.status).toBe(401);
    expect(removeCompetitionParticipant).not.toHaveBeenCalled();
  });

  it("removes for the authenticated manager and reports success", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never);
    vi.mocked(removeCompetitionParticipant).mockResolvedValue({
      ok: true,
      data: { participantId: PARTICIPANT_1, removedAt: "2026-02-01T00:00:00.000Z" },
    });

    const res = await removeParticipantHandler(request(), EVENT_A, PARTICIPANT_1);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.banned).toBe(false);
    // Identity comes from the session, the target from the route.
    expect(removeCompetitionParticipant).toHaveBeenCalledWith(
      EVENT_A,
      MANAGER,
      PARTICIPANT_1,
    );
  });

  it("maps a server 409 (lifecycle/provider) to 409", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never);
    vi.mocked(removeCompetitionParticipant).mockResolvedValue({
      ok: false,
      error: "This participant has already checked in and can no longer be removed.",
      status: 409,
    });

    const res = await removeParticipantHandler(request(), EVENT_A, PARTICIPANT_1);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/checked in/i);
  });

  it("maps a 404 (missing participant) straight through", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never);
    vi.mocked(removeCompetitionParticipant).mockResolvedValue({
      ok: false,
      error: "Participant not found for this competition.",
      status: 404,
    });

    const res = await removeParticipantHandler(request(), EVENT_A, PARTICIPANT_1);
    expect(res.status).toBe(404);
  });
});

describe("T-REM-3: ban participant handler", () => {
  it("rejects an unauthenticated request with 401 and calls nothing", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await banParticipantHandler(request(), EVENT_A, PARTICIPANT_1);

    expect(res.status).toBe(401);
    expect(banCompetitionParticipant).not.toHaveBeenCalled();
  });

  it("bans for the authenticated manager and never trusts a body profile id", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never);
    vi.mocked(banCompetitionParticipant).mockResolvedValue({
      ok: true,
      data: {
        participantId: PARTICIPANT_1,
        created: true,
        alreadyBanned: false,
        removed: true,
        removedAt: "2026-02-01T00:00:00.000Z",
        bannedAt: "2026-02-01T00:00:00.000Z",
      },
    });

    const res = await banParticipantHandler(
      request({ profileId: "someone-else", profile_id: "someone-else", reason: "cheating" }),
      EVENT_A,
      PARTICIPANT_1,
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.banned).toBe(true);
    expect(banCompetitionParticipant).toHaveBeenCalledWith(
      EVENT_A,
      MANAGER,
      PARTICIPANT_1,
      "cheating",
    );
  });

  it("maps an unsafe lifecycle state to 409", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never);
    vi.mocked(banCompetitionParticipant).mockResolvedValue({
      ok: false,
      error: "This participant has already been added to the external tournament and cannot be removed here.",
      status: 409,
    });

    const res = await banParticipantHandler(request(), EVENT_A, PARTICIPANT_1);
    expect(res.status).toBe(409);
  });

  it("maps a 400 (self / malformed) straight through", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never);
    vi.mocked(banCompetitionParticipant).mockResolvedValue({
      ok: false,
      error: "You cannot remove or ban yourself.",
      status: 400,
    });

    const res = await banParticipantHandler(request(), EVENT_A, PARTICIPANT_1);
    expect(res.status).toBe(400);
  });
});
