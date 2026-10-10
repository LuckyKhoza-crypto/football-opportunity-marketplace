import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/competition-server", () => ({ isEventManager: vi.fn() }));
vi.mock("@/lib/competition-join-server", () => ({
  createCompetitionJoinLink: vi.fn(),
  getCompetitionJoinLinks: vi.fn(),
  registerForCompetition: vi.fn(),
  revokeCompetitionJoinLink: vi.fn(),
  withdrawFromCompetition: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { withdrawFromCompetition } from "@/lib/competition-join-server";
import { withdrawFromCompetitionHandler } from "@/lib/competition-join-api";

/**
 * T-REM-2 — POST /api/competitions/[id]/withdraw handler.
 *
 * Verifies authentication, id validation, delegation to the server helper and
 * the HTTP status mapping. The handler must never trust a request body id.
 */

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_PLAYER = "11111111-1111-4111-8111-111111111111";

function session() {
  return {
    user: { id: PROFILE_PLAYER, email: "player@test.com", name: "Player" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

function request(body?: unknown) {
  return new Request(`http://localhost/api/competitions/${EVENT_A}/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("T-REM-2: withdraw handler", () => {
  it("rejects an unauthenticated request with 401 and calls nothing", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await withdrawFromCompetitionHandler(request(), EVENT_A);

    expect(res.status).toBe(401);
    expect(withdrawFromCompetition).not.toHaveBeenCalled();
  });

  it("withdraws for the authenticated player and reports success", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never);
    vi.mocked(withdrawFromCompetition).mockResolvedValue({
      ok: true,
      data: {
        participantId: "part-1",
        eventId: EVENT_A,
        removedAt: "2026-02-01T00:00:00.000Z",
      },
    });

    const res = await withdrawFromCompetitionHandler(request(), EVENT_A);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.eventId).toBe(EVENT_A);
    // Identity comes from the session — never the body.
    expect(withdrawFromCompetition).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_PLAYER,
    );
  });

  it("ignores a body-supplied profile id (cannot withdraw for someone else)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never);
    vi.mocked(withdrawFromCompetition).mockResolvedValue({
      ok: true,
      data: { participantId: "part-1", eventId: EVENT_A, removedAt: "now" },
    });

    await withdrawFromCompetitionHandler(
      request({ profileId: "someone-else", profile_id: "someone-else" }),
      EVENT_A,
    );

    expect(withdrawFromCompetition).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_PLAYER,
    );
  });

  it("maps a server 409 (checked in / attempts / provider) to 409", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never);
    vi.mocked(withdrawFromCompetition).mockResolvedValue({
      ok: false,
      error: "You have already checked in and can no longer unregister.",
      status: 409,
    });

    const res = await withdrawFromCompetitionHandler(request(), EVENT_A);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/checked in/i);
  });

  it("maps a missing registration (404) to 404", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never);
    vi.mocked(withdrawFromCompetition).mockResolvedValue({
      ok: false,
      error: "You are not registered for this competition.",
      status: 404,
    });

    const res = await withdrawFromCompetitionHandler(request(), EVENT_A);
    expect(res.status).toBe(404);
  });

  it("returns 400 when the competition id is missing", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never);

    const res = await withdrawFromCompetitionHandler(request(), "");

    expect(res.status).toBe(400);
    expect(withdrawFromCompetition).not.toHaveBeenCalled();
  });
});
