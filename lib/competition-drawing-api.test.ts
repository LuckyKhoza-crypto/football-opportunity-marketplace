import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/competition-drawing-server", () => ({
  startCompetitionDrawing: vi.fn(),
  getCompetitionDrawing: vi.fn(),
}));

import { getServerSession } from "next-auth";
import {
  startCompetitionDrawing,
  getCompetitionDrawing,
} from "@/lib/competition-drawing-server";
import {
  getDrawingHandler,
  startDrawingHandler,
} from "@/lib/competition-drawing-api";

const PROFILE_1 = "11111111-1111-4111-8111-111111111111";
const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function session(id: string) {
  return { user: { id, email: id + "@test.com" }, expires: "later" };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("COMP-006 handler: POST /api/competitions/[id]/draw", () => {
  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const res = await startDrawingHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/draw`, {
        method: "POST",
      }),
      EVENT_A,
    );
    expect(res.status).toBe(401);
    expect(startCompetitionDrawing).not.toHaveBeenCalled();
  });

  it("starts the drawing and returns 201 with the result", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(startCompetitionDrawing).mockResolvedValue({
      ok: true,
      data: {
        winnerName: "Ada Lovelace",
        qualifiedParticipantCount: 5,
        drawnAt: "2026-09-21T15:42:00Z",
      },
    });

    const res = await startDrawingHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/draw`, {
        method: "POST",
      }),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.drawing.winnerName).toBe("Ada Lovelace");
    expect(startCompetitionDrawing).toHaveBeenCalledWith(EVENT_A, PROFILE_1);
  });

  it("ignores any client-supplied winner/count in the POST body", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(startCompetitionDrawing).mockResolvedValue({
      ok: true,
      data: {
        winnerName: "Server Choice",
        qualifiedParticipantCount: 3,
        drawnAt: "2026-09-21T15:42:00Z",
      },
    });

    const res = await startDrawingHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/draw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          winner_participant_id: "attacker-chosen",
          qualified_participant_count: 999,
        }),
      }),
      EVENT_A,
    );

    expect(res.status).toBe(201);
    // Only the authenticated event id + profile id reach the server helper.
    expect(startCompetitionDrawing).toHaveBeenCalledWith(EVENT_A, PROFILE_1);
    const data = await res.json();
    expect(data.drawing.qualifiedParticipantCount).toBe(3);
  });

  it("maps an unrelated user (403) from the helper", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(startCompetitionDrawing).mockResolvedValue({
      ok: false,
      error: "Not authorized to start the drawing for this competition",
      status: 403,
    });

    const res = await startDrawingHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/draw`, {
        method: "POST",
      }),
      EVENT_A,
    );
    expect(res.status).toBe(403);
  });

  it("maps a duplicate drawing (409) from the helper", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(startCompetitionDrawing).mockResolvedValue({
      ok: false,
      error: "A drawing has already been completed for this competition.",
      status: 409,
    });

    const res = await startDrawingHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/draw`, {
        method: "POST",
      }),
      EVENT_A,
    );
    expect(res.status).toBe(409);
  });

  it("maps no-qualified-participants (409) from the helper", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(startCompetitionDrawing).mockResolvedValue({
      ok: false,
      error: "No qualified participants are eligible for the drawing.",
      status: 409,
    });

    const res = await startDrawingHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/draw`, {
        method: "POST",
      }),
      EVENT_A,
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/no qualified participants/i);
  });

  it("returns 500 when the helper throws", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(startCompetitionDrawing).mockRejectedValue(new Error("boom"));

    const res = await startDrawingHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/draw`, {
        method: "POST",
      }),
      EVENT_A,
    );
    expect(res.status).toBe(500);
  });
});

describe("COMP-006 handler: GET /api/competitions/[id]/draw", () => {
  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const res = await getDrawingHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/draw`),
      EVENT_A,
    );
    expect(res.status).toBe(401);
  });

  it("returns the drawing for an authorized manager/ambassador", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(getCompetitionDrawing).mockResolvedValue({
      winnerName: "Ada",
      qualifiedParticipantCount: 4,
      drawnAt: "2026-09-21T15:42:00Z",
    });

    const res = await getDrawingHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/draw`),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.drawing.winnerName).toBe("Ada");
    expect(getCompetitionDrawing).toHaveBeenCalledWith(EVENT_A, PROFILE_1);
  });

  it("returns an opaque 404 when the drawing is missing or access is denied", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    // The server helper returns null for an unrelated user OR no drawing.
    vi.mocked(getCompetitionDrawing).mockResolvedValue(null);

    const res = await getDrawingHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/draw`),
      EVENT_A,
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    // No private drawing information is leaked.
    expect(data.drawing).toBeUndefined();
  });
});