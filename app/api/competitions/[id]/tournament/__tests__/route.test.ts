import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("server-only", () => ({}));

// The route files must contain no logic of their own: they only await the
// dynamic segment and delegate to the (already tested) handler module.
vi.mock("@/lib/tournament-api", () => ({
  createTournamentHandler: vi.fn(),
  getTournamentSummaryHandler: vi.fn(),
  syncTournamentParticipantsHandler: vi.fn(),
  startTournamentHandler: vi.fn(),
  getTournamentMatchesHandler: vi.fn(),
  reportMatchResultHandler: vi.fn(),
  finalizeTournamentHandler: vi.fn(),
}));

import {
  createTournamentHandler,
  finalizeTournamentHandler,
  getTournamentMatchesHandler,
  getTournamentSummaryHandler,
  reportMatchResultHandler,
  startTournamentHandler,
  syncTournamentParticipantsHandler,
} from "@/lib/tournament-api";
import { GET as getTournamentRoute, POST as postTournamentRoute } from "../route";
import { POST as postParticipantsRoute } from "../participants/route";
import { POST as postStartRoute } from "../start/route";
import { GET as getMatchesRoute } from "../matches/route";
import { POST as postResultRoute } from "../matches/[matchId]/result/route";
import { POST as postFinalizeRoute } from "../finalize/route";

/**
 * TOURN-002 — App Router route wiring.
 * TOURN-003 — the result and finalization routes.
 *
 * These tests exist to keep app/api/competitions/[id]/tournament/** thin: each
 * file must expose only the intended methods and forward the awaited `[id]`
 * (and `[matchId]`) segment to the matching handler in lib/tournament-api.ts.
 */

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MATCH_REF = "r1:pppppppp-pppp-4ppp-8ppp-ppppppppppp1:pppppppp-pppp-4ppp-8ppp-ppppppppppp2";
const BASE = `http://localhost/api/competitions/${EVENT_A}/tournament`;

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function matchContext(id: string, matchId: string) {
  return { params: Promise.resolve({ id, matchId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TOURN-002 routes: /api/competitions/[id]/tournament", () => {
  it("GET delegates to the summary handler with the resolved event id", async () => {
    vi.mocked(getTournamentSummaryHandler).mockResolvedValue(
      NextResponse.json({ tournament: null }),
    );

    const res = await getTournamentRoute(new Request(BASE), context(EVENT_A));

    expect(res.status).toBe(200);
    expect(vi.mocked(getTournamentSummaryHandler)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getTournamentSummaryHandler).mock.calls[0][1]).toBe(EVENT_A);
  });

  it("POST delegates to the create handler with the resolved event id", async () => {
    vi.mocked(createTournamentHandler).mockResolvedValue(
      NextResponse.json({ tournament: null }, { status: 201 }),
    );

    const res = await postTournamentRoute(
      new Request(BASE, { method: "POST" }),
      context(EVENT_A),
    );

    expect(res.status).toBe(201);
    expect(vi.mocked(createTournamentHandler).mock.calls[0][1]).toBe(EVENT_A);
  });
});

describe("TOURN-002 routes: tournament sub-resources", () => {
  it("POST /participants delegates to the sync handler", async () => {
    vi.mocked(syncTournamentParticipantsHandler).mockResolvedValue(
      NextResponse.json({ synced: 0, alreadyMapped: 0, total: 0 }),
    );

    const res = await postParticipantsRoute(
      new Request(`${BASE}/participants`, { method: "POST" }),
      context(EVENT_A),
    );

    expect(res.status).toBe(200);
    expect(
      vi.mocked(syncTournamentParticipantsHandler).mock.calls[0][1],
    ).toBe(EVENT_A);
  });

  it("POST /start delegates to the start handler", async () => {
    vi.mocked(startTournamentHandler).mockResolvedValue(
      NextResponse.json({ started: false, tournament: null }),
    );

    const res = await postStartRoute(
      new Request(`${BASE}/start`, { method: "POST" }),
      context(EVENT_A),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(startTournamentHandler).mock.calls[0][1]).toBe(EVENT_A);
  });

  it("GET /matches delegates to the matches handler", async () => {
    vi.mocked(getTournamentMatchesHandler).mockResolvedValue(
      NextResponse.json({
        tournamentState: "started",
        participants: [],
        matches: [],
      }),
    );

    const res = await getMatchesRoute(
      new Request(`${BASE}/matches`),
      context(EVENT_A),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(getTournamentMatchesHandler).mock.calls[0][1]).toBe(EVENT_A);
  });
});

describe("TOURN-003 routes: result reporting and finalization", () => {
  it("POST /matches/[matchId]/result delegates with both segments resolved", async () => {
    vi.mocked(reportMatchResultHandler).mockResolvedValue(
      NextResponse.json({ match: null }),
    );

    const res = await postResultRoute(
      new Request(
        `${BASE}/matches/${encodeURIComponent(MATCH_REF)}/result`,
        { method: "POST" },
      ),
      matchContext(EVENT_A, MATCH_REF),
    );

    expect(res.status).toBe(200);

    const call = vi.mocked(reportMatchResultHandler).mock.calls[0];
    expect(call[1]).toBe(EVENT_A);
    expect(call[2]).toBe(MATCH_REF);
  });

  it("POST /finalize delegates to the finalize handler", async () => {
    vi.mocked(finalizeTournamentHandler).mockResolvedValue(
      NextResponse.json({ finalized: true, winnerParticipantId: null, tournament: null }),
    );

    const res = await postFinalizeRoute(
      new Request(`${BASE}/finalize`, { method: "POST" }),
      context(EVENT_A),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(finalizeTournamentHandler).mock.calls[0][1]).toBe(EVENT_A);
  });
});
