import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/integrations/tournament", () => ({
  createEventTournament: vi.fn(),
  addEventParticipantsToTournament: vi.fn(),
  startEventTournament: vi.fn(),
  getEventTournamentSummary: vi.fn(),
  getEventTournamentBracket: vi.fn(),
  getEventTournamentFormatOptions: vi.fn(),
  reportEventMatchResult: vi.fn(),
  finalizeEventTournament: vi.fn(),
  isTournamentComplete: (tournament: { state?: string } | null | undefined) =>
    tournament?.state === "completed",
}));

import { getServerSession } from "next-auth";
import {
  addEventParticipantsToTournament,
  createEventTournament,
  finalizeEventTournament,
  getEventTournamentBracket,
  getEventTournamentFormatOptions,
  getEventTournamentSummary,
  reportEventMatchResult,
  startEventTournament,
} from "@/lib/integrations/tournament";
import {
  createTournamentHandler,
  finalizeTournamentHandler,
  getTournamentMatchesHandler,
  getTournamentSummaryHandler,
  reportMatchResultHandler,
  startTournamentHandler,
  syncTournamentParticipantsHandler,
} from "@/lib/tournament-api";
import { UNMAPPED_PARTICIPANT_NAME } from "@/types/competition-tournament";

/**
 * TOURN-002 — tournament route handlers.
 * TOURN-003 — match result reporting and finalization handlers.
 *
 * The handlers are the API surface: they authenticate, delegate to ONE existing
 * TOURN-001/003 service function, map its discriminated result onto an HTTP
 * status, and return a provider-neutral payload. The service itself is mocked
 * here (lib/integrations/tournament/service.test.ts covers its behaviour), so
 * these tests assert the HTTP contract and — importantly — that no provider
 * identifier or provider term can reach a client.
 */

const PROFILE_1 = "11111111-1111-4111-8111-111111111111";
const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Provider identifiers/terms that must never appear in a client payload. */
const PROVIDER_TOURNAMENT_ID = "99110022";
const PROVIDER_PARTICIPANT_ID_1 = "550011";
const PROVIDER_PARTICIPANT_ID_2 = "550022";
const PROVIDER_PARTICIPANT_ID_3 = "550033";

const PARTICIPANT_A = "pppppppp-pppp-4ppp-8ppp-ppppppppppp1";
const PARTICIPANT_B = "pppppppp-pppp-4ppp-8ppp-ppppppppppp2";

function session(id: string) {
  return { user: { id, email: id + "@test.com" }, expires: "later" };
}

function providerTournament(overrides: Record<string, unknown> = {}) {
  return {
    providerTournamentId: PROVIDER_TOURNAMENT_ID,
    name: "Sunday Cup",
    format: "single_elimination" as const,
    state: "created" as const,
    externalUrl: "https://provider.invalid/our-bracket",
    completedAt: null,
    ...overrides,
  };
}

function providerLink() {
  return {
    provider: "challonge",
    providerTournamentId: PROVIDER_TOURNAMENT_ID,
  };
}

function summaryFixture(overrides: Record<string, unknown> = {}) {
  return {
    link: providerLink(),
    tournament: providerTournament(),
    config: { format: "single_elimination" as const },
    isComplete: false,
    openMatchCount: 0,
    winnerProviderParticipantId: null,
    winnerParticipantId: null,
    ...overrides,
  };
}

/** The capability list the not-linked summary reports. */
function formatOptionsFixture() {
  return [
    { format: "single_elimination" as const, supported: true },
    { format: "double_elimination" as const, supported: false },
    { format: "round_robin" as const, supported: false },
    { format: "swiss" as const, supported: false },
    { format: "group_stage_knockout" as const, supported: false },
  ];
}

function createResultFixture(overrides: Record<string, unknown> = {}) {
  return {
    link: providerLink(),
    tournament: providerTournament(),
    config: { format: "single_elimination" as const },
    ...overrides,
  };
}

function bracketFixture(overrides: Record<string, unknown> = {}) {
  return {
    link: providerLink(),
    tournament: providerTournament({ state: "started" as const }),
    matches: [
      {
        matchId: "match-991",
        round: 1,
        participant1Id: PROVIDER_PARTICIPANT_ID_1,
        participant2Id: PROVIDER_PARTICIPANT_ID_2,
        state: "completed" as const,
        score: { participant1Score: 3, participant2Score: 1 },
        winnerParticipantId: PROVIDER_PARTICIPANT_ID_1,
      },
      {
        matchId: "match-992",
        round: 2,
        participant1Id: PROVIDER_PARTICIPANT_ID_1,
        participant2Id: null,
        state: "pending" as const,
        score: null,
        winnerParticipantId: null,
      },
      {
        matchId: "match-993",
        round: 2,
        participant1Id: PROVIDER_PARTICIPANT_ID_3,
        participant2Id: null,
        state: "pending" as const,
        score: null,
        winnerParticipantId: null,
      },
    ],
    participants: [
      {
        providerParticipantId: PROVIDER_PARTICIPANT_ID_1,
        participantId: PARTICIPANT_A,
        displayName: "Ada Lovelace",
        status: "qualified" as const,
      },
      {
        providerParticipantId: PROVIDER_PARTICIPANT_ID_2,
        participantId: PARTICIPANT_B,
        displayName: "Grace Hopper",
        status: "qualified" as const,
      },
    ],
    ...overrides,
  };
}

/** A client payload may not contain a provider id, name or URL. */
function expectNoProviderDetail(raw: string) {
  expect(raw).not.toContain(PROVIDER_TOURNAMENT_ID);
  expect(raw).not.toContain(PROVIDER_PARTICIPANT_ID_1);
  expect(raw).not.toContain(PROVIDER_PARTICIPANT_ID_2);
  expect(raw).not.toContain(PROVIDER_PARTICIPANT_ID_3);
  expect(raw).not.toContain("match-99");
  expect(raw).not.toMatch(/challonge|externalUrl|providerTournamentId|api_key/i);
}

/** TOURN-003 — FOM's own reference for the first match of `bracketFixture`. */
const MATCH_REF = `r1:${PARTICIPANT_A}:${PARTICIPANT_B}`;

/** What the service returns after a result was accepted by the provider. */
function reportedMatchFixture(overrides: Record<string, unknown> = {}) {
  return {
    link: providerLink(),
    match: {
      matchId: "match-991",
      round: 1,
      participant1Id: PROVIDER_PARTICIPANT_ID_1,
      participant2Id: PROVIDER_PARTICIPANT_ID_2,
      state: "completed" as const,
      score: { participant1Score: 2, participant2Score: 1 },
      winnerParticipantId: PROVIDER_PARTICIPANT_ID_1,
      ...overrides,
    },
    participants: [
      {
        providerParticipantId: PROVIDER_PARTICIPANT_ID_1,
        participantId: PARTICIPANT_A,
        displayName: "Ada Lovelace",
        status: "qualified" as const,
      },
      {
        providerParticipantId: PROVIDER_PARTICIPANT_ID_2,
        participantId: PARTICIPANT_B,
        displayName: "Grace Hopper",
        status: "qualified" as const,
      },
    ],
  };
}

/** What the service returns after finalizing a tournament. */
function finalizationFixture(overrides: Record<string, unknown> = {}) {
  return {
    link: providerLink(),
    tournament: providerTournament({
      state: "completed" as const,
      completedAt: "2026-01-01T10:00:00Z",
    }),
    config: { format: "single_elimination" as const },
    winnerProviderParticipantId: PROVIDER_PARTICIPANT_ID_1,
    winnerParticipantId: PARTICIPANT_A,
    finalized: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The normal case: the capability list resolves to the formats FOM models.
  vi.mocked(getEventTournamentFormatOptions).mockResolvedValue({
    ok: true,
    data: formatOptionsFixture(),
  });
});

describe("TOURN-002 handler: GET /api/competitions/[id]/tournament (summary)", () => {
  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await getTournamentSummaryHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`),
      EVENT_A,
    );

    expect(res.status).toBe(401);
    expect(getEventTournamentSummary).not.toHaveBeenCalled();
  });

  it("returns a neutral summary for an authorized manager or ambassador", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(getEventTournamentSummary).mockResolvedValue({
      ok: true,
      data: summaryFixture({
        tournament: providerTournament({ state: "started" as const }),
        openMatchCount: 2,
      }),
    });

    const res = await getTournamentSummaryHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`),
      EVENT_A,
    );
    const raw = JSON.stringify(await res.json());
    const data = JSON.parse(raw);

    expect(res.status).toBe(200);
    expect(vi.mocked(getEventTournamentSummary)).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
    );
    expect(data.tournament.name).toBe("Sunday Cup");
    expect(data.tournament.state).toBe("started");
    expect(data.tournament.format).toBe("single_elimination");
    expect(data.tournament.isComplete).toBe(false);
    expect(data.tournament.openMatchCount).toBe(2);
    expect(data.tournament.winnerParticipantId).toBeNull();
    expectNoProviderDetail(raw);
  });

  it("reports the format the competition's tournament was created with", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(getEventTournamentSummary).mockResolvedValue({
      ok: true,
      data: summaryFixture({ config: { format: "single_elimination" } }),
    });

    const res = await getTournamentSummaryHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tournament.format).toBe("single_elimination");
  });

  it("reports 'not linked' as a 409 state, not an error", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(getEventTournamentSummary).mockResolvedValue({
      ok: false,
      error: "This competition is not linked to an external tournament yet",
      status: 409,
    });

    const res = await getTournamentSummaryHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.code).toBe("not_linked");
    expect(data.error).toMatch(/not linked/i);
  });

  it("reports the creatable formats on the not-linked state", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(getEventTournamentSummary).mockResolvedValue({
      ok: false,
      error: "This competition is not linked to an external tournament yet",
      status: 409,
    });
    vi.mocked(getEventTournamentFormatOptions).mockResolvedValue({
      ok: true,
      data: formatOptionsFixture(),
    });

    const res = await getTournamentSummaryHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`),
      EVENT_A,
    );
    const raw = JSON.stringify(await res.json());
    const data = JSON.parse(raw);

    expect(res.status).toBe(409);
    expect(data.code).toBe("not_linked");
    expect(data.formats).toEqual(formatOptionsFixture());
    // Only the supported format is offered as creatable.
    expect(
      data.formats.filter((option: { supported: boolean }) => option.supported),
    ).toEqual([{ format: "single_elimination", supported: true }]);
    expect(vi.mocked(getEventTournamentFormatOptions)).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
    );
    expectNoProviderDetail(raw);
  });

  it("still reports not-linked when the format capabilities cannot be determined", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(getEventTournamentSummary).mockResolvedValue({
      ok: false,
      error: "This competition is not linked to an external tournament yet",
      status: 409,
    });
    vi.mocked(getEventTournamentFormatOptions).mockResolvedValue({
      ok: false,
      error: "Not authorized to manage this competition's tournament",
      status: 403,
    });

    const res = await getTournamentSummaryHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.formats).toEqual([]);
  });

  it("maps unauthorized (403), missing (404) and provider (502) failures", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    vi.mocked(getEventTournamentSummary).mockResolvedValue({
      ok: false,
      error: "Not authorized to manage this competition's tournament",
      status: 403,
    });
    const denied = await getTournamentSummaryHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`),
      EVENT_A,
    );

    vi.mocked(getEventTournamentSummary).mockResolvedValue({
      ok: false,
      error: "Competition not found",
      status: 404,
    });
    const missing = await getTournamentSummaryHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`),
      EVENT_A,
    );

    vi.mocked(getEventTournamentSummary).mockResolvedValue({
      ok: false,
      error: "The tournament provider request failed",
      status: 502,
    });
    const providerFailure = await getTournamentSummaryHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`),
      EVENT_A,
    );

    expect(denied.status).toBe(403);
    expect(missing.status).toBe(404);
    expect(providerFailure.status).toBe(502);
  });
});

describe("TOURN-002 handler: POST /api/competitions/[id]/tournament (create)", () => {
  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await createTournamentHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
        method: "POST",
      }),
      EVENT_A,
    );

    expect(res.status).toBe(401);
    expect(createEventTournament).not.toHaveBeenCalled();
  });

  it("maps an unauthorized manager (403) from the service", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(createEventTournament).mockResolvedValue({
      ok: false,
      error: "Not authorized to manage this competition's tournament",
      status: 403,
    });

    const res = await createTournamentHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
        method: "POST",
      }),
      EVENT_A,
    );

    expect(res.status).toBe(403);
    expect(vi.mocked(createEventTournament)).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
      { config: { format: "single_elimination" } },
    );
  });

  it("creates the tournament through the service and returns a neutral 201", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(createEventTournament).mockResolvedValue({
      ok: true,
      data: createResultFixture(),
    });

    const res = await createTournamentHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
        method: "POST",
      }),
      EVENT_A,
    );
    const raw = JSON.stringify(await res.json());

    expect(res.status).toBe(201);
    // A bodyless request keeps the historical default configuration.
    expect(vi.mocked(createEventTournament)).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
      { config: { format: "single_elimination" } },
    );
    expectNoProviderDetail(raw);
    expect(raw).toContain("Sunday Cup");
    expect(raw).toContain("single_elimination");
  });

  it("accepts the format the organiser chose", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(createEventTournament).mockResolvedValue({
      ok: true,
      data: createResultFixture({ config: { format: "round_robin" } }),
    });

    const res = await createTournamentHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "round_robin" }),
      }),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(vi.mocked(createEventTournament)).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
      { config: { format: "round_robin" } },
    );
    expect(data.tournament.format).toBe("round_robin");
  });

  it("rejects a format FOM does not model without calling the service", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    for (const format of ["penguin_racing", 42, "", "SINGLE_ELIMINATION"]) {
      const res = await createTournamentHandler(
        new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format }),
        }),
        EVENT_A,
      );
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/unsupported tournament format/i);
    }

    // Nothing was created and nothing was substituted for the bad value.
    expect(vi.mocked(createEventTournament)).not.toHaveBeenCalled();
  });

  it("treats an explicitly absent format as the default configuration", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(createEventTournament).mockResolvedValue({
      ok: true,
      data: createResultFixture(),
    });

    await createTournamentHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: null }),
      }),
      EVENT_A,
    );

    expect(vi.mocked(createEventTournament)).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
      { config: { format: "single_elimination" } },
    );
  });

  it("treats a malformed or non-object body as no configuration at all", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(createEventTournament).mockResolvedValue({
      ok: true,
      data: createResultFixture(),
    });

    for (const body of ["{not json", JSON.stringify("single_elimination")]) {
      await createTournamentHandler(
        new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
        EVENT_A,
      );
    }

    expect(vi.mocked(createEventTournament)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createEventTournament)).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
      { config: { format: "single_elimination" } },
    );
  });

  it("ignores a client-supplied provider/slug/name in the body", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(createEventTournament).mockResolvedValue({
      ok: true,
      data: createResultFixture(),
    });

    await createTournamentHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "challonge",
          providerId: "challonge",
          slug: "attacker-chosen-slug",
          name: "Attacker Cup",
          format: "single_elimination",
        }),
      }),
      EVENT_A,
    );

    // Only the event id, the session-derived profile id and the validated
    // configuration reach the service.
    expect(vi.mocked(createEventTournament)).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
      { config: { format: "single_elimination" } },
    );
  });

  it("maps an already-linked competition (409)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(createEventTournament).mockResolvedValue({
      ok: false,
      error: "This competition already has an external tournament",
      status: 409,
    });

    const res = await createTournamentHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
        method: "POST",
      }),
      EVENT_A,
    );

    expect(res.status).toBe(409);
  });

  it("maps a missing competition (404) and an invalid id (400)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    vi.mocked(createEventTournament).mockResolvedValue({
      ok: false,
      error: "Competition not found",
      status: 404,
    });
    const missing = await createTournamentHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
        method: "POST",
      }),
      EVENT_A,
    );

    vi.mocked(createEventTournament).mockResolvedValue({
      ok: false,
      error: "A competition is required",
      status: 400,
    });
    const invalid = await createTournamentHandler(
      new Request("http://localhost/api/competitions//tournament", {
        method: "POST",
      }),
      "",
    );

    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(400);
  });

  it("maps a provider configuration failure (503) and returns 500 if the service throws", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(createEventTournament).mockResolvedValue({
      ok: false,
      error:
        "The tournament provider is not configured. Missing required environment variable(s): CHALLONGE_API_KEY.",
      status: 503,
    });

    const unavailable = await createTournamentHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
        method: "POST",
      }),
      EVENT_A,
    );

    vi.mocked(createEventTournament).mockRejectedValue(new Error("boom"));
    const thrown = await createTournamentHandler(
      new Request(`http://localhost/api/competitions/${EVENT_A}/tournament`, {
        method: "POST",
      }),
      EVENT_A,
    );

    expect(unavailable.status).toBe(503);
    expect(thrown.status).toBe(500);
  });
});

describe("TOURN-002 handler: POST /api/competitions/[id]/tournament/participants (sync)", () => {
  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await syncTournamentParticipantsHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/participants`,
        { method: "POST" },
      ),
      EVENT_A,
    );

    expect(res.status).toBe(401);
    expect(addEventParticipantsToTournament).not.toHaveBeenCalled();
  });

  it("invokes the service and reports synced/already-mapped counts only", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(addEventParticipantsToTournament).mockResolvedValue({
      ok: true,
      data: {
        link: providerLink(),
        added: [
          {
            ref: PARTICIPANT_A,
            providerParticipantId: PROVIDER_PARTICIPANT_ID_1,
          },
        ],
        skipped: 2,
      },
    });

    const res = await syncTournamentParticipantsHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/participants`,
        { method: "POST" },
      ),
      EVENT_A,
    );
    const raw = JSON.stringify(await res.json());
    const data = JSON.parse(raw);

    expect(res.status).toBe(200);
    expect(vi.mocked(addEventParticipantsToTournament)).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
    );
    expect(data.synced).toBe(1);
    expect(data.alreadyMapped).toBe(2);
    expect(data.total).toBe(3);
    expectNoProviderDetail(raw);
  });

  it("reports a fully-synced competition without duplicating participants", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(addEventParticipantsToTournament).mockResolvedValue({
      ok: true,
      data: { link: providerLink(), added: [], skipped: 4 },
    });

    const res = await syncTournamentParticipantsHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/participants`,
        { method: "POST" },
      ),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.synced).toBe(0);
    expect(data.alreadyMapped).toBe(4);
  });

  it("surfaces an unauthorized (403) sync and a not-linked (409) competition", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    vi.mocked(addEventParticipantsToTournament).mockResolvedValue({
      ok: false,
      error: "Not authorized to manage this competition's tournament",
      status: 403,
    });
    const denied = await syncTournamentParticipantsHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/participants`,
        { method: "POST" },
      ),
      EVENT_A,
    );

    vi.mocked(addEventParticipantsToTournament).mockResolvedValue({
      ok: false,
      error: "This competition is not linked to an external tournament yet",
      status: 409,
    });
    const notLinked = await syncTournamentParticipantsHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/participants`,
        { method: "POST" },
      ),
      EVENT_A,
    );

    expect(denied.status).toBe(403);
    expect(notLinked.status).toBe(409);
  });

  it("surfaces a partial mapping failure (500) instead of pretending success", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(addEventParticipantsToTournament).mockResolvedValue({
      ok: false,
      error:
        "Participants were added to the external tournament but could not be mapped in FOM. Reconcile them before retrying.",
      status: 500,
    });

    const res = await syncTournamentParticipantsHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/participants`,
        { method: "POST" },
      ),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/reconcile/i);
    expect(data.synced).toBeUndefined();
  });
});



describe("TOURN-002 handler: POST /api/competitions/[id]/tournament/start", () => {
  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await startTournamentHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/start`,
        { method: "POST" },
      ),
      EVENT_A,
    );

    expect(res.status).toBe(401);
    expect(startEventTournament).not.toHaveBeenCalled();
  });

  it("starts through the service and returns the started status", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(startEventTournament).mockResolvedValue({
      ok: true,
      data: {
        link: providerLink(),
        tournament: providerTournament({ state: "started" as const }),
        config: { format: "single_elimination" },
        started: true,
      },
    });

    const res = await startTournamentHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/start`,
        { method: "POST" },
      ),
      EVENT_A,
    );
    const raw = JSON.stringify(await res.json());
    const data = JSON.parse(raw);

    expect(res.status).toBe(200);
    expect(vi.mocked(startEventTournament)).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
    );
    expect(data.started).toBe(true);
    expect(data.tournament.state).toBe("started");
    expect(data.tournament.format).toBe("single_elimination");
    expectNoProviderDetail(raw);
  });

  it("reports an idempotent start for an already-started tournament", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(startEventTournament).mockResolvedValue({
      ok: true,
      data: {
        link: providerLink(),
        tournament: providerTournament({ state: "started" as const }),
        config: { format: "single_elimination" },
        started: false,
      },
    });

    const res = await startTournamentHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/start`,
        { method: "POST" },
      ),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.started).toBe(false);
  });

  it("maps a refused start (409 already completed) and an unauthorized (403) start", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    vi.mocked(startEventTournament).mockResolvedValue({
      ok: false,
      error: "The external tournament is already completed",
      status: 409,
    });
    const completed = await startTournamentHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/start`,
        { method: "POST" },
      ),
      EVENT_A,
    );

    vi.mocked(startEventTournament).mockResolvedValue({
      ok: false,
      error: "Not authorized to manage this competition's tournament",
      status: 403,
    });
    const denied = await startTournamentHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/start`,
        { method: "POST" },
      ),
      EVENT_A,
    );

    expect(completed.status).toBe(409);
    expect(denied.status).toBe(403);
  });

  it("maps a tournament that no longer exists on the provider (404)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(startEventTournament).mockResolvedValue({
      ok: false,
      error: "The linked external tournament no longer exists",
      status: 404,
    });

    const res = await startTournamentHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/start`,
        { method: "POST" },
      ),
      EVENT_A,
    );

    expect(res.status).toBe(404);
  });
});

describe("TOURN-002 handler: GET /api/competitions/[id]/tournament/matches", () => {
  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await getTournamentMatchesHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/matches`,
      ),
      EVENT_A,
    );

    expect(res.status).toBe(401);
    expect(getEventTournamentBracket).not.toHaveBeenCalled();
  });

  it("returns the read-only bracket resolved to FOM participants", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(getEventTournamentBracket).mockResolvedValue({
      ok: true,
      data: bracketFixture(),
    });

    const res = await getTournamentMatchesHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/matches`,
      ),
      EVENT_A,
    );
    const raw = JSON.stringify(await res.json());
    const data = JSON.parse(raw);

    expect(res.status).toBe(200);
    expect(vi.mocked(getEventTournamentBracket)).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
    );

    // The participant mapping is what the UI needs — never provider ids.
    expect(data.participants).toHaveLength(2);
    expect(data.participants[0]).toEqual({
      participantId: PARTICIPANT_A,
      name: "Ada Lovelace",
    });

    expect(data.tournamentState).toBe("started");

    // Match 1: completed, scored, winner resolved.
    expect(data.matches[0].round).toBe(1);
    expect(data.matches[0].state).toBe("completed");
    expect(data.matches[0].participant1.name).toBe("Ada Lovelace");
    expect(data.matches[0].participant2.name).toBe("Grace Hopper");
    expect(data.matches[0].score).toEqual({
      participant1Score: 3,
      participant2Score: 1,
    });
    expect(data.matches[0].winner).toEqual({
      participantId: PARTICIPANT_A,
      name: "Ada Lovelace",
    });

    // Match 2: an undecided side is null (rendered as "TBD" by the UI).
    expect(data.matches[1].participant2).toEqual({
      participantId: null,
      name: null,
    });

    // Match 3: present on the provider but unmapped to FOM — placeholder, no id.
    expect(data.matches[2].participant1).toEqual({
      participantId: null,
      name: UNMAPPED_PARTICIPANT_NAME,
    });

    // TOURN-003: FOM's own match reference addresses a result. It carries FOM
    // participant ids only, and is absent whenever a result cannot be reported
    // (an undecided side, or a side that is not mapped to a participant).
    expect(data.matches[0].matchRef).toBe(MATCH_REF);
    expect(data.matches[1].matchRef).toBeNull();
    expect(data.matches[2].matchRef).toBeNull();

    expectNoProviderDetail(raw);
  });

  it("keeps every provider-reported round (no assumed bracket shape)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(getEventTournamentBracket).mockResolvedValue({
      ok: true,
      data: bracketFixture(),
    });

    const res = await getTournamentMatchesHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/matches`,
      ),
      EVENT_A,
    );
    const data = await res.json();

    expect(data.matches.map((match: { round: number }) => match.round)).toEqual([
      1, 2, 2,
    ]);
  });

  it("reports 'not linked' as a 409 state with no matches", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(getEventTournamentBracket).mockResolvedValue({
      ok: false,
      error: "This competition is not linked to an external tournament yet",
      status: 409,
    });

    const res = await getTournamentMatchesHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/matches`,
      ),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.code).toBe("not_linked");
    expect(data.matches).toBeUndefined();
  });

  it("maps unauthorized (403), missing competition (404) and provider (502) failures", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    vi.mocked(getEventTournamentBracket).mockResolvedValue({
      ok: false,
      error: "Not authorized to manage this competition's tournament",
      status: 403,
    });
    const denied = await getTournamentMatchesHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/matches`,
      ),
      EVENT_A,
    );

    vi.mocked(getEventTournamentBracket).mockResolvedValue({
      ok: false,
      error: "Competition not found",
      status: 404,
    });
    const missing = await getTournamentMatchesHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/matches`,
      ),
      EVENT_A,
    );

    vi.mocked(getEventTournamentBracket).mockResolvedValue({
      ok: false,
      error: "The tournament provider request failed",
      status: 502,
    });
    const providerFailure = await getTournamentMatchesHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/matches`,
      ),
      EVENT_A,
    );

    expect(denied.status).toBe(403);
    expect(missing.status).toBe(404);
    expect(providerFailure.status).toBe(502);
  });
});



describe("TOURN-003 handler: POST /api/competitions/[id]/tournament/matches/[matchId]/result", () => {
  function reportResult(body: unknown, matchRef = MATCH_REF) {
    return reportMatchResultHandler(
      new Request(
        `http://localhost/api/competitions/${EVENT_A}/tournament/matches/${encodeURIComponent(
          matchRef,
        )}/result`,
        {
          method: "POST",
          ...(body === undefined
            ? {}
            : { body: typeof body === "string" ? body : JSON.stringify(body) }),
        },
      ),
      EVENT_A,
      matchRef,
    );
  }

  const VALID_BODY = {
    winnerParticipantId: PARTICIPANT_A,
    participant1Score: 2,
    participant2Score: 1,
  };

  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await reportResult(VALID_BODY);

    expect(res.status).toBe(401);
    expect(reportEventMatchResult).not.toHaveBeenCalled();
  });

  it("reports the result with FOM-neutral input and returns the neutral match", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(reportEventMatchResult).mockResolvedValue({
      ok: true,
      data: reportedMatchFixture(),
    });

    const res = await reportResult(VALID_BODY);
    const raw = JSON.stringify(await res.json());
    const data = JSON.parse(raw);

    expect(res.status).toBe(200);
    // The service is handed the session's profile, the FOM match reference and a
    // FOM participant id — never a provider id.
    expect(vi.mocked(reportEventMatchResult).mock.calls[0][0]).toBe(EVENT_A);
    expect(vi.mocked(reportEventMatchResult).mock.calls[0][1]).toBe(PROFILE_1);
    expect(vi.mocked(reportEventMatchResult).mock.calls[0][2]).toEqual({
      matchRef: MATCH_REF,
      winnerParticipantId: PARTICIPANT_A,
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(data.match.state).toBe("completed");
    expect(data.match.round).toBe(1);
    expect(data.match.matchRef).toBe(MATCH_REF);
    expect(data.match.participant1).toEqual({
      participantId: PARTICIPANT_A,
      name: "Ada Lovelace",
    });
    expect(data.match.participant2).toEqual({
      participantId: PARTICIPANT_B,
      name: "Grace Hopper",
    });
    expect(data.match.winner).toEqual({
      participantId: PARTICIPANT_A,
      name: "Ada Lovelace",
    });
    expect(data.match.score).toEqual({
      participant1Score: 2,
      participant2Score: 1,
    });

    expectNoProviderDetail(raw);
  });

  it("rejects a malformed body without calling the service", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    const notJson = await reportResult("not json at all");
    const notAnObject = await reportResult("\"just a string\"");
    const empty = await reportResult({});

    expect(notJson.status).toBe(400);
    expect(notAnObject.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(reportEventMatchResult).not.toHaveBeenCalled();
  });

  it("rejects an invalid match reference without calling the service", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    const providerId = await reportResult(VALID_BODY, PROVIDER_TOURNAMENT_ID);
    const bareId = await reportResult(VALID_BODY, "1");
    const blank = await reportResult(VALID_BODY, "   ");

    expect(providerId.status).toBe(400);
    expect(bareId.status).toBe(400);
    expect(blank.status).toBe(400);
    expect(reportEventMatchResult).not.toHaveBeenCalled();
  });

  it("requires the winning participant", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    const missing = await reportResult({
      participant1Score: 2,
      participant2Score: 1,
    });
    const blank = await reportResult({
      winnerParticipantId: "   ",
      participant1Score: 2,
      participant2Score: 1,
    });
    const wrongType = await reportResult({
      winnerParticipantId: 42,
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(missing.status).toBe(400);
    expect(blank.status).toBe(400);
    expect(wrongType.status).toBe(400);
    expect(reportEventMatchResult).not.toHaveBeenCalled();
  });

  it("rejects invalid scores and a draw", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    const invalidScores = [
      { ...VALID_BODY, participant1Score: 1.5 },
      { ...VALID_BODY, participant2Score: -1 },
      { ...VALID_BODY, participant1Score: "2" },
      { ...VALID_BODY, participant2Score: null },
      // A missing score is not a score.
      { winnerParticipantId: PARTICIPANT_A, participant2Score: 1 },
    ];

    for (const body of invalidScores) {
      const res = await reportResult(body);
      expect(res.status).toBe(400);
    }

    // FOM does not support draws, so a level score is refused here too.
    const draw = await reportResult({
      winnerParticipantId: PARTICIPANT_A,
      participant1Score: 1,
      participant2Score: 1,
    });
    expect(draw.status).toBe(400);

    expect(reportEventMatchResult).not.toHaveBeenCalled();
  });

  it("ignores provider-specific fields a client might send", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(reportEventMatchResult).mockResolvedValue({
      ok: true,
      data: reportedMatchFixture(),
    });

    const res = await reportResult({
      ...VALID_BODY,
      // None of these may influence the call, let alone reach the provider.
      providerParticipantId: PROVIDER_PARTICIPANT_ID_2,
      winner_id: PROVIDER_PARTICIPANT_ID_2,
      scores_csv: "9-0",
      challongeMatchId: "match-991",
      matchId: "match-991",
      providerTournamentId: PROVIDER_TOURNAMENT_ID,
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(reportEventMatchResult).mock.calls[0][2]).toEqual({
      matchRef: MATCH_REF,
      winnerParticipantId: PARTICIPANT_A,
      participant1Score: 2,
      participant2Score: 1,
    });

    const raw = JSON.stringify(await res.json());
    expectNoProviderDetail(raw);
  });

  it("maps the service's guards and a provider failure honestly", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(reportEventMatchResult).mockResolvedValue({
      ok: false,
      error: "This match is not ready for a result yet",
      status: 409,
    });

    const notReady = await reportResult(VALID_BODY);
    const notReadyBody = await notReady.json();

    vi.mocked(reportEventMatchResult).mockResolvedValue({
      ok: false,
      error: "The selected winner is not a participant in this match",
      status: 400,
    });
    const badWinner = await reportResult(VALID_BODY);

    vi.mocked(reportEventMatchResult).mockResolvedValue({
      ok: false,
      error: "This match is not part of this tournament",
      status: 404,
    });
    const missing = await reportResult(VALID_BODY);

    vi.mocked(reportEventMatchResult).mockResolvedValue({
      ok: false,
      error: "The tournament provider request failed",
      status: 502,
    });
    const providerFailure = await reportResult(VALID_BODY);

    vi.mocked(reportEventMatchResult).mockResolvedValue({
      ok: false,
      error: "Not authorized to manage this competition's tournament",
      status: 403,
    });
    const denied = await reportResult(VALID_BODY);

    expect(notReady.status).toBe(409);
    expect(notReadyBody.error).toBe("This match is not ready for a result yet");
    expect(badWinner.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(providerFailure.status).toBe(502);
    expect(denied.status).toBe(403);
  });

  it("returns 500 when the service throws", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(reportEventMatchResult).mockRejectedValue(new Error("boom"));

    const res = await reportResult(VALID_BODY);

    expect(res.status).toBe(500);
  });
});

/** TOURN-003 — explicit finalization (the provider's own finalize transition). */
describe("TOURN-003 handler: POST /api/competitions/[id]/tournament/finalize", () => {
  const FINALIZE_URL = `http://localhost/api/competitions/${EVENT_A}/tournament/finalize`;

  function finalize() {
    // The body is deliberately ignored: the server decides which tournament.
    return finalizeTournamentHandler(
      new Request(FINALIZE_URL, {
        method: "POST",
        body: JSON.stringify({ tournamentId: PROVIDER_TOURNAMENT_ID }),
      }),
      EVENT_A,
    );
  }

  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await finalize();

    expect(res.status).toBe(401);
    expect(finalizeEventTournament).not.toHaveBeenCalled();
  });

  it("finalizes through the service and returns the neutral champion", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(finalizeEventTournament).mockResolvedValue({
      ok: true,
      data: finalizationFixture(),
    });

    const res = await finalize();
    const raw = JSON.stringify(await res.json());
    const data = JSON.parse(raw);

    expect(res.status).toBe(200);
    // Authorized with the session's own profile id.
    expect(vi.mocked(finalizeEventTournament).mock.calls[0]).toEqual([
      EVENT_A,
      PROFILE_1,
    ]);

    expect(data.finalized).toBe(true);
    // The champion is a FOM participant id, and the status is FOM's own.
    expect(data.winnerParticipantId).toBe(PARTICIPANT_A);
    expect(data.tournament).toEqual({
      name: "Sunday Cup",
      format: "single_elimination",
      state: "completed",
      isComplete: true,
      completedAt: "2026-01-01T10:00:00Z",
    });

    expectNoProviderDetail(raw);
  });

  it("reports an idempotent finalization of an already-complete tournament", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(finalizeEventTournament).mockResolvedValue({
      ok: true,
      data: finalizationFixture({ finalized: false }),
    });

    const res = await finalize();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.finalized).toBe(false);
    expect(data.winnerParticipantId).toBe(PARTICIPANT_A);
  });

  it("reports a tournament whose champion is not mapped to a participant", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(finalizeEventTournament).mockResolvedValue({
      ok: true,
      data: finalizationFixture({
        winnerProviderParticipantId: PROVIDER_PARTICIPANT_ID_3,
        winnerParticipantId: null,
      }),
    });

    const res = await finalize();
    const raw = JSON.stringify(await res.json());
    const data = JSON.parse(raw);

    expect(res.status).toBe(200);
    expect(data.winnerParticipantId).toBeNull();
    expectNoProviderDetail(raw);
  });

  it("surfaces a refused finalization and a provider failure honestly", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    vi.mocked(finalizeEventTournament).mockResolvedValue({
      ok: false,
      error:
        "The tournament provider refused to finalize the tournament (HTTP 400). The bracket may still have unreported matches.",
      status: 400,
    });
    const refused = await finalize();
    const refusedBody = await refused.json();

    vi.mocked(finalizeEventTournament).mockResolvedValue({
      ok: false,
      error: "The external tournament has not started yet",
      status: 409,
    });
    const notStarted = await finalize();

    vi.mocked(finalizeEventTournament).mockResolvedValue({
      ok: false,
      error: "Not authorized to manage this competition's tournament",
      status: 403,
    });
    const denied = await finalize();

    vi.mocked(finalizeEventTournament).mockResolvedValue({
      ok: false,
      error: "The tournament provider request failed",
      status: 502,
    });
    const providerFailure = await finalize();

    expect(refused.status).toBe(400);
    expect(refusedBody.error).toContain("refused to finalize");
    expect(notStarted.status).toBe(409);
    expect(denied.status).toBe(403);
    expect(providerFailure.status).toBe(502);
  });

  it("returns 500 when the service throws", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(finalizeEventTournament).mockRejectedValue(new Error("boom"));

    const res = await finalize();

    expect(res.status).toBe(500);
  });
});

