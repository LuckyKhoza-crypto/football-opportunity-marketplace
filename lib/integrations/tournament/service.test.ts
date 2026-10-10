import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("@/lib/competition-server", () => ({
  canManageEvent: vi.fn(),
}));

vi.mock("@/lib/integrations/tournament/registry", () => ({
  resolveTournamentProvider: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { canManageEvent } from "@/lib/competition-server";
import { resolveTournamentProvider } from "@/lib/integrations/tournament/registry";
import {
  TournamentProviderConfigError,
  TournamentProviderError,
} from "@/lib/integrations/tournament/errors";
import {
  addEventParticipantsToTournament,
  createEventTournament,
  finalizeEventTournament,
  getEventTournamentBracket,
  getEventTournamentFormatOptions,
  getEventTournamentSummary,
  reportEventMatchResult,
  startEventTournament,
} from "@/lib/integrations/tournament/service";
import { TOURNAMENT_FORMATS } from "@/lib/integrations/tournament/contract";
import type {
  Tournament,
  TournamentFormat,
  TournamentMatch,
  TournamentProvider,
} from "@/lib/integrations/tournament/types";

/**
 * TOURN-001 — FOM tournament service.
 *
 * The service is the seam between FOM and any provider, so these tests mock the
 * provider through the REGISTRY (never a Challonge import) and the database
 * through supabaseAdmin:
 *
 *   • authorization always uses the existing `canManageEvent` rule,
 *   • only identifiers/mappings are stored in Supabase,
 *   • a provider/DB failure is never reported as a successful operation.
 */

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_MANAGER = "11111111-1111-4111-8111-111111111111";
const SLUG = `fom_evt_${EVENT_A.replace(/[^a-z0-9]/g, "")}`;
const TOURNAMENT_ID = "555";

type MockFn = ReturnType<typeof vi.fn>;

interface Builder {
  select: MockFn;
  eq: MockFn;
  is: MockFn;
  order: MockFn;
  maybeSingle: MockFn;
  single: MockFn;
  insert: MockFn;
  update: MockFn;
  delete: MockFn;
  then: (resolve: (value: unknown) => unknown) => unknown;
}

/**
 * Flexible, thenable Supabase query-builder mock (same approach as
 * lib/competition-management-server.test.ts): passthrough methods return the
 * builder so arbitrary chains work, and awaiting the builder resolves the
 * queued result — which covers `.select().eq().maybeSingle()` reads and
 * `.update().eq().is().select()` conditional writes alike.
 */
function makeBuilder(result: { data: unknown; error: unknown }): Builder {
  const builder = {} as Builder;
  const passthrough = () => builder;
  builder.select = vi.fn(passthrough);
  builder.eq = vi.fn(passthrough);
  builder.is = vi.fn(passthrough);
  builder.insert = vi.fn(passthrough);
  builder.update = vi.fn(passthrough);
  builder.delete = vi.fn(passthrough);
  builder.order = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve) => resolve(result);
  return builder;
}

let fromQueue: Builder[] = [];

function mockFromOnce(result: { data: unknown; error: unknown }): Builder {
  const builder = makeBuilder(result);
  fromQueue.push(builder);
  return builder;
}

/** A provider stub implementing the whole FOM contract. */
function fakeProvider(overrides: Partial<TournamentProvider> = {}) {
  const base: TournamentProvider = {
    id: "challonge",
    // Matches the real adapter: single elimination is the only creatable format.
    supportsFormat: vi.fn(
      (format: TournamentFormat) => format === "single_elimination",
    ),
    createTournament: vi.fn(),
    getTournament: vi.fn(),
    addParticipants: vi.fn(),
    getParticipants: vi.fn(),
    startTournament: vi.fn(),
    getMatches: vi.fn(),
    reportMatchResult: vi.fn(),
    finalizeTournament: vi.fn(),
    getWinner: vi.fn(),
  };
  return Object.assign(base, overrides) as TournamentProvider & {
    supportsFormat: MockFn;
    createTournament: MockFn;
    getTournament: MockFn;
    addParticipants: MockFn;
    startTournament: MockFn;
    getMatches: MockFn;
    reportMatchResult: MockFn;
    finalizeTournament: MockFn;
    getWinner: MockFn;
  };
}

function tournament(
  state: Tournament["state"],
  overrides: Partial<Tournament> = {},
): Tournament {
  return {
    providerTournamentId: TOURNAMENT_ID,
    name: "FOM Finals Night",
    format: "single_elimination",
    state,
    externalUrl: null,
    completedAt: state === "completed" ? "2026-01-01T10:00:00Z" : null,
    ...overrides,
  };
}

function linkedEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_A,
    name: "FOM Finals Night",
    provider: "challonge",
    provider_tournament_id: TOURNAMENT_ID,
    tournament_format: "single_elimination",
    ...overrides,
  };
}

function unlinkedEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_A,
    name: "FOM Finals Night",
    provider: null,
    provider_tournament_id: null,
    tournament_format: null,
    ...overrides,
  };
}

beforeEach(() => {
  fromQueue = [];
  vi.clearAllMocks();
  vi.mocked(supabaseAdmin.from).mockImplementation(
    () =>
      (fromQueue.shift() ?? makeBuilder({ data: null, error: null })) as never,
  );
  vi.mocked(canManageEvent).mockResolvedValue(true);
});

describe("TOURN-001: createEventTournament — authorization and guards", () => {
  it("rejects an unauthorized caller before touching the provider or the database", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(false);

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(403);
    expect(canManageEvent).toHaveBeenCalledWith(EVENT_A, PROFILE_MANAGER);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(resolveTournamentProvider).not.toHaveBeenCalled();
  });

  it("requires both a competition and a caller", async () => {
    const result = await createEventTournament("", "");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
    expect(canManageEvent).not.toHaveBeenCalled();
  });

  it("reports a missing competition as 404", async () => {
    mockFromOnce({ data: null, error: null });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(404);
    expect(resolveTournamentProvider).not.toHaveBeenCalled();
  });

  it("refuses a competition that already has an external tournament", async () => {
    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
    // No provider call, so no second tournament can be created.
    expect(resolveTournamentProvider).not.toHaveBeenCalled();
  });

  it("rejects a format FOM does not model before resolving a provider", async () => {
    mockFromOnce({ data: unlinkedEventRow(), error: null });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER, {
      config: { format: "penguin_racing" as TournamentFormat },
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
    expect(result.ok === false && result.error).toContain("penguin_racing");
    // No provider was resolved, so no tournament could be created.
    expect(resolveTournamentProvider).not.toHaveBeenCalled();
  });

  it("rejects a format the provider cannot create, without creating anything", async () => {
    const provider = fakeProvider();
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: unlinkedEventRow(), error: null });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER, {
      config: { format: "round_robin" },
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
    expect(result.ok === false && result.error).toContain("round_robin");
    // The capability check happens first, and the format is NEVER replaced by a
    // supported one.
    expect(provider.supportsFormat).toHaveBeenCalledWith("round_robin");
    expect(provider.createTournament).not.toHaveBeenCalled();
    // Only the event read happened: nothing was linked.
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });
});

describe("TOURN-001: createEventTournament — creation and mapping", () => {
  it("creates the tournament from the competition and persists the mapping", async () => {
    const created = tournament("created");
    const provider = fakeProvider({
      createTournament: vi.fn().mockResolvedValue(created),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: unlinkedEventRow(), error: null });
    const updateBuilder = mockFromOnce({
      data: [{ id: EVENT_A }],
      error: null,
    });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER);

    // The slug is derived from the competition, so a retry cannot duplicate it.
    expect(provider.createTournament).toHaveBeenCalledWith({
      name: "FOM Finals Night",
      slug: SLUG,
      config: { format: "single_elimination" },
    });
    // Only identifiers are written to Supabase — no bracket/match state. The
    // chosen format IS recorded, together with the mapping, in one update.
    expect(updateBuilder.update).toHaveBeenCalledWith({
      provider: "challonge",
      provider_tournament_id: TOURNAMENT_ID,
      tournament_format: "single_elimination",
    });
    expect(updateBuilder.eq).toHaveBeenCalledWith("id", EVENT_A);
    expect(updateBuilder.is).toHaveBeenCalledWith(
      "provider_tournament_id",
      null,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        link: { provider: "challonge", providerTournamentId: TOURNAMENT_ID },
        tournament: created,
        config: { format: "single_elimination" },
      },
    });
  });

  it("uses the configuration the caller chose and persists it", async () => {
    const created = tournament("created");
    const provider = fakeProvider({
      supportsFormat: vi.fn(
        (format: TournamentFormat) => format === "round_robin",
      ),
      createTournament: vi.fn().mockResolvedValue(created),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: unlinkedEventRow(), error: null });
    const updateBuilder = mockFromOnce({ data: [{ id: EVENT_A }], error: null });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER, {
      config: { format: "round_robin" },
    });

    // Which formats are allowed is the PROVIDER's decision, not a hard-coded
    // service list: a provider that supports the format is honoured.
    expect(provider.createTournament).toHaveBeenCalledWith({
      name: "FOM Finals Night",
      slug: SLUG,
      config: { format: "round_robin" },
    });
    expect(updateBuilder.update).toHaveBeenCalledWith({
      provider: "challonge",
      provider_tournament_id: TOURNAMENT_ID,
      tournament_format: "round_robin",
    });
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.config).toEqual({
      format: "round_robin",
    });
  });

  it("adopts a tournament created by an earlier crashed attempt instead of duplicating it", async () => {
    const provider = fakeProvider({
      createTournament: vi
        .fn()
        .mockRejectedValue(
          new TournamentProviderError(
            "provider_invalid_request",
            'HTTP 422 on POST /tournaments.json: ["url has already been taken"]',
            { status: 422 },
          ),
        ),
      getTournament: vi.fn().mockResolvedValue(tournament("created")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: unlinkedEventRow(), error: null });
    // The conditional write matches nothing (already linked by the first try) …
    mockFromOnce({ data: [], error: null });
    // … and the re-read points at the very same external tournament.
    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(provider.getTournament).toHaveBeenCalledWith(SLUG);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.link.providerTournamentId).toBe(
      TOURNAMENT_ID,
    );
  });

  it("accepts a concurrent request that linked the very same tournament", async () => {
    const provider = fakeProvider({
      createTournament: vi.fn().mockResolvedValue(tournament("created")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: unlinkedEventRow(), error: null });
    // Another request won the race and wrote the same tournament id.
    mockFromOnce({ data: [], error: null });
    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(true);
  });

  it("refuses when the competition is linked to a DIFFERENT tournament", async () => {
    const provider = fakeProvider({
      createTournament: vi.fn().mockResolvedValue(tournament("created")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: unlinkedEventRow(), error: null });
    mockFromOnce({ data: [], error: null });
    mockFromOnce({
      data: linkedEventRow({ provider_tournament_id: "999" }),
      error: null,
    });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
  });

  it("reports a provider failure honestly and writes no mapping", async () => {
    const provider = fakeProvider({
      createTournament: vi
        .fn()
        .mockRejectedValue(
          new TournamentProviderError("provider_unavailable", "Provider down", {
            status: 503,
          }),
        ),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: unlinkedEventRow(), error: null });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(502);
    // Only the event read happened; nothing was linked.
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });

  it("reports missing provider configuration as 503", async () => {
    const provider = fakeProvider({
      createTournament: vi
        .fn()
        .mockRejectedValue(
          new TournamentProviderConfigError(["CHALLONGE_API_KEY"]),
        ),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: unlinkedEventRow(), error: null });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(503);
    expect(result.ok === false && result.error).toContain("CHALLONGE_API_KEY");
  });

  it("reports a failed mapping write instead of pretending the link exists", async () => {
    const provider = fakeProvider({
      createTournament: vi.fn().mockResolvedValue(tournament("created")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: unlinkedEventRow(), error: null });
    mockFromOnce({ data: null, error: { message: "db down" } });

    const result = await createEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(500);
  });
});

describe("TOURN-001: addEventParticipantsToTournament", () => {
  function participantRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "p1",
      status: "registered",
      provider_participant_id: null,
      profile: { full_name: "Alex Mokoena" },
      ...overrides,
    };
  }

  it("pushes the unmapped FOM participants and stores their provider ids", async () => {
    const provider = fakeProvider({
      addParticipants: vi.fn().mockResolvedValue([
        { ref: "p1", providerParticipantId: "11" },
        { ref: "p2", providerParticipantId: "12" },
      ]),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce({
      data: [participantRow(), participantRow({ id: "p2", profile: null })],
      error: null,
    });
    const mappingOne = mockFromOnce({ data: [{ id: "p1" }], error: null });
    const mappingTwo = mockFromOnce({ data: [{ id: "p2" }], error: null });

    const result = await addEventParticipantsToTournament(
      EVENT_A,
      PROFILE_MANAGER,
    );

    // Identity comes from the FOM participant; the name falls back safely.
    expect(provider.addParticipants).toHaveBeenCalledWith(TOURNAMENT_ID, [
      { ref: "p1", displayName: "Alex Mokoena" },
      { ref: "p2", displayName: "Player 2" },
    ]);
    expect(mappingOne.update).toHaveBeenCalledWith({
      provider_participant_id: "11",
    });
    expect(mappingOne.eq).toHaveBeenCalledWith("id", "p1");
    // T-REM-4: the mapping write only lands on an ACTIVE participant row.
    expect(mappingOne.is).toHaveBeenCalledWith("removed_at", null);
    expect(mappingTwo.update).toHaveBeenCalledWith({
      provider_participant_id: "12",
    });

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.added).toHaveLength(2);
    expect(result.ok === true && result.data.skipped).toBe(0);
  });

  it("T-REM-4: syncs only active participants (removed excluded at the query)", async () => {
    const provider = fakeProvider({
      addParticipants: vi
        .fn()
        .mockResolvedValue([{ ref: "p1", providerParticipantId: "11" }]),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    // The DB applies `removed_at IS NULL`, so only the active row is returned
    // and the soft-removed participant is never handed to the provider.
    const participantsBuilder = mockFromOnce({
      data: [participantRow()],
      error: null,
    });
    mockFromOnce({ data: [{ id: "p1" }], error: null }); // mapping write

    const result = await addEventParticipantsToTournament(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(participantsBuilder.is).toHaveBeenCalledWith("removed_at", null);
    expect(provider.addParticipants).toHaveBeenCalledWith(TOURNAMENT_ID, [
      { ref: "p1", displayName: "Alex Mokoena" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("T-REM-4: a concurrent removal prevents the mapping and reports reconciliation", async () => {
    const provider = fakeProvider({
      addParticipants: vi
        .fn()
        .mockResolvedValue([{ ref: "p1", providerParticipantId: "11" }]),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce({ data: [participantRow()], error: null });
    // The participant was removed after the provider call, so the conditional
    // (`removed_at IS NULL`) mapping write matches 0 rows.
    const mappingBuilder = mockFromOnce({ data: [], error: null });

    const result = await addEventParticipantsToTournament(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(mappingBuilder.is).toHaveBeenCalledWith("removed_at", null);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(500);
    expect(result.ok === false && result.error).toMatch(/reconcile/i);
  });

  it("skips participants that are already mapped and never calls the provider", async () => {
    const provider = fakeProvider();
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce({
      data: [participantRow({ provider_participant_id: "11" })],
      error: null,
    });

    const result = await addEventParticipantsToTournament(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(provider.addParticipants).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.added).toEqual([]);
    expect(result.ok === true && result.data.skipped).toBe(1);
  });

  it("fails when the provider confirms participants that cannot be mapped", async () => {
    const provider = fakeProvider({
      addParticipants: vi
        .fn()
        .mockResolvedValue([{ ref: "p1", providerParticipantId: "11" }]),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce({ data: [participantRow()], error: null });
    mockFromOnce({ data: null, error: { message: "db down" } });

    const result = await addEventParticipantsToTournament(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(500);
    expect(result.ok === false && result.error).toMatch(/reconcile/i);
  });

  it("reports a provider failure and stores nothing", async () => {
    const provider = fakeProvider({
      addParticipants: vi
        .fn()
        .mockRejectedValue(
          new TournamentProviderError("provider_unavailable", "down"),
        ),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce({ data: [participantRow()], error: null });

    const result = await addEventParticipantsToTournament(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(502);
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
  });

  it("refuses to sync when the competition has no external tournament", async () => {
    mockFromOnce({ data: unlinkedEventRow(), error: null });

    const result = await addEventParticipantsToTournament(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
  });
});

describe("TOURN-001: startEventTournament", () => {
  it("starts a tournament that has not started yet", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("created")),
      startTournament: vi.fn().mockResolvedValue(tournament("started")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await startEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(provider.getTournament).toHaveBeenCalledWith(TOURNAMENT_ID);
    expect(provider.startTournament).toHaveBeenCalledWith(TOURNAMENT_ID);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.started).toBe(true);
    expect(result.ok === true && result.data.tournament.state).toBe("started");
  });

  it("is idempotent for a tournament that is already running", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("started")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await startEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(provider.startTournament).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.started).toBe(false);
  });

  it("refuses to start a completed tournament", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("completed")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await startEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
    expect(provider.startTournament).not.toHaveBeenCalled();
  });

  it("refuses to act on a state FOM does not recognise", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("unknown")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await startEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
    expect(provider.startTournament).not.toHaveBeenCalled();
  });

  it("reports a linked tournament that no longer exists as 404", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(null),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await startEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(404);
  });
});

describe("TOURN-003: reportEventMatchResult", () => {
  const reportedMatch: TournamentMatch = {
    matchId: "1",
    round: 1,
    participant1Id: "11",
    participant2Id: "12",
    state: "completed",
    score: { participant1Score: 2, participant2Score: 1 },
    winnerParticipantId: "11",
  };

  /** The provider's view of the match FOM's reference `r1:p1:p2` addresses. */
  const readyMatch: TournamentMatch = {
    matchId: "1",
    round: 1,
    participant1Id: "11",
    participant2Id: "12",
    state: "ready",
    score: null,
    winnerParticipantId: null,
  };

  const MATCH_REF = "r1:p1:p2";

  /** p1/p2 are the FOM participants behind provider ids 11/12; p3 is extras. */
  function participantRowsResult() {
    return {
      data: [
        {
          id: "p1",
          status: "qualified",
          provider_participant_id: "11",
          profile: { full_name: "Ada Lovelace" },
        },
        {
          id: "p2",
          status: "qualified",
          provider_participant_id: "12",
          profile: { full_name: "Grace Hopper" },
        },
        {
          id: "p3",
          status: "qualified",
          provider_participant_id: "13",
          profile: { full_name: "Alan Turing" },
        },
      ],
      error: null,
    };
  }

  /** The database reads a valid report performs: the event, then participants. */
  function mockReportReads(row: Record<string, unknown> = linkedEventRow()) {
    const eventBuilder = mockFromOnce({ data: row, error: null });
    const participantBuilder = mockFromOnce(participantRowsResult());
    return { eventBuilder, participantBuilder };
  }

  function reportingProvider(overrides: Partial<TournamentProvider> = {}) {
    return fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("started")),
      getMatches: vi.fn().mockResolvedValue([readyMatch]),
      reportMatchResult: vi.fn().mockResolvedValue(reportedMatch),
      ...overrides,
    });
  }

  it("translates FOM's participant ids into the provider's before reporting", async () => {
    const provider = reportingProvider();
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads();

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    // The provider sees its own match id and its own participant id — never a
    // FOM id — and the neutral score pair.
    expect(provider.reportMatchResult).toHaveBeenCalledWith(TOURNAMENT_ID, {
      matchId: "1",
      participant1Score: 2,
      participant2Score: 1,
      winnerParticipantId: "11",
    });

    expect(result.ok).toBe(true);
    // The caller gets the provider's match plus the FOM↔provider mapping back.
    expect(result.ok === true && result.data.match).toEqual(reportedMatch);
    expect(
      result.ok === true &&
        result.data.participants.map((p) => p.participantId),
    ).toEqual(["p1", "p2", "p3"]);
  });

  it("does not edit the bracket or write any match state itself", async () => {
    const provider = reportingProvider();
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    const { eventBuilder, participantBuilder } = mockReportReads();

    await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    // Advancement happened inside the provider; FOM only read the mapping.
    expect(eventBuilder.update).not.toHaveBeenCalled();
    expect(eventBuilder.insert).not.toHaveBeenCalled();
    expect(participantBuilder.update).not.toHaveBeenCalled();
    expect(participantBuilder.insert).not.toHaveBeenCalled();
    // The tournament's later state is never read back from FOM's own copy.
    expect(provider.getMatches).toHaveBeenCalledWith(TOURNAMENT_ID);
  });

  it("validates the input before touching the provider or the database", async () => {
    const base = {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    };

    const badInputs = [
      { ...base, matchRef: "  " },
      { ...base, matchRef: "match-1" },
      { ...base, matchRef: "11" },
      { ...base, winnerParticipantId: "   " },
      { ...base, participant1Score: 1.5 },
      { ...base, participant2Score: -1 },
      { ...base, participant1Score: "2" as unknown as number },
    ];

    for (const input of badInputs) {
      const result = await reportEventMatchResult(
        EVENT_A,
        PROFILE_MANAGER,
        input,
      );
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(400);
    }

    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(resolveTournamentProvider).not.toHaveBeenCalled();
  });

  it("rejects a draw instead of inventing a tie-break", async () => {
    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 1,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(resolveTournamentProvider).not.toHaveBeenCalled();
  });

  it("refuses an unauthorized caller before reading anything", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(false);

    const result = await reportEventMatchResult(EVENT_A, "intruder", {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(403);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(resolveTournamentProvider).not.toHaveBeenCalled();
  });

  it("refuses a competition with no external tournament", async () => {
    const provider = reportingProvider();
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads(unlinkedEventRow());

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
    expect(provider.reportMatchResult).not.toHaveBeenCalled();
  });

  it("refuses a tournament that has not started", async () => {
    const provider = reportingProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("created")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads();

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
    expect(provider.getMatches).not.toHaveBeenCalled();
    expect(provider.reportMatchResult).not.toHaveBeenCalled();
  });

  it("refuses a tournament that is already complete", async () => {
    const provider = reportingProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("completed")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads();

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
    expect(provider.reportMatchResult).not.toHaveBeenCalled();
  });

  it("refuses a tournament state FOM does not recognise", async () => {
    const provider = reportingProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("unknown")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads();

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
    expect(provider.reportMatchResult).not.toHaveBeenCalled();
  });

  it("refuses a match that is not part of this tournament", async () => {
    const provider = reportingProvider();
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads();

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      // p1 and p3 never met in this bracket.
      matchRef: "r1:p1:p3",
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(404);
    expect(provider.reportMatchResult).not.toHaveBeenCalled();
  });

  it("refuses a winner that is not one of the match's two sides", async () => {
    const provider = reportingProvider();
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads();

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      // Mapped to a provider participant, but not in this match.
      winnerParticipantId: "p3",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
    expect(provider.reportMatchResult).not.toHaveBeenCalled();
  });

  it("refuses a winner that is not a FOM participant id", async () => {
    const provider = reportingProvider();
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads();

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      // A provider participant id, not a competition_participants.id.
      winnerParticipantId: "11",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
    expect(provider.reportMatchResult).not.toHaveBeenCalled();
  });

  it("refuses a match the provider already reports as settled", async () => {
    const provider = reportingProvider({
      getMatches: vi
        .fn()
        .mockResolvedValue([{ ...readyMatch, state: "completed" }]),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads();

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
    expect(provider.reportMatchResult).not.toHaveBeenCalled();
  });

  it("refuses a match that is not ready for a result yet", async () => {
    const provider = reportingProvider({
      getMatches: vi
        .fn()
        .mockResolvedValue([{ ...readyMatch, state: "pending" }]),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads();

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
    expect(provider.reportMatchResult).not.toHaveBeenCalled();
  });

  it("reports a provider failure as a gateway failure, never as success", async () => {
    const provider = reportingProvider({
      reportMatchResult: vi
        .fn()
        .mockRejectedValue(
          new TournamentProviderError("provider_unavailable", "down"),
        ),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads();

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(502);
  });

  it("reports a result the provider rejects as a bad request", async () => {
    const provider = reportingProvider({
      reportMatchResult: vi
        .fn()
        .mockRejectedValue(
          new TournamentProviderError(
            "provider_invalid_request",
            "The tournament provider rejected the request (HTTP 422).",
            { status: 422 },
          ),
        ),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);
    mockReportReads();

    const result = await reportEventMatchResult(EVENT_A, PROFILE_MANAGER, {
      matchRef: MATCH_REF,
      winnerParticipantId: "p1",
      participant1Score: 2,
      participant2Score: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
  });
});

describe("TOURN-003: finalizeEventTournament", () => {
  /** The champion's mapping read: provider id 11 → competition participant p1. */
  function championRows() {
    return {
      data: [
        {
          id: "p1",
          status: "qualified",
          provider_participant_id: "11",
          profile: { full_name: "Ada Lovelace" },
        },
      ],
      error: null,
    };
  }

  it("finalizes a running tournament and returns the champion", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("started")),
      finalizeTournament: vi.fn().mockResolvedValue(tournament("completed")),
      getWinner: vi
        .fn()
        .mockResolvedValue({ providerParticipantId: "11" }),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce(championRows());

    const result = await finalizeEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(provider.finalizeTournament).toHaveBeenCalledWith(TOURNAMENT_ID);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.finalized).toBe(true);
    expect(result.ok === true && result.data.tournament.state).toBe("completed");
    expect(result.ok === true && result.data.config).toEqual({
      format: "single_elimination",
    });
    // The champion is the PROVIDER's answer, resolved to a FOM participant.
    expect(
      result.ok === true && result.data.winnerProviderParticipantId,
    ).toBe("11");
    expect(result.ok === true && result.data.winnerParticipantId).toBe("p1");
  });

  it("reports an unmapped champion without inventing a FOM participant", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("started")),
      finalizeTournament: vi.fn().mockResolvedValue(tournament("completed")),
      getWinner: vi
        .fn()
        .mockResolvedValue({ providerParticipantId: "99" }),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce(championRows());

    const result = await finalizeEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.winnerParticipantId).toBeNull();
  });

  it("is idempotent for a tournament that is already complete", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("completed")),
      getWinner: vi.fn().mockResolvedValue({ providerParticipantId: "11" }),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce(championRows());

    const result = await finalizeEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(provider.finalizeTournament).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.finalized).toBe(false);
    expect(result.ok === true && result.data.winnerParticipantId).toBe("p1");
  });

  it("refuses to finalize a tournament that never started", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("created")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await finalizeEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(409);
    expect(provider.finalizeTournament).not.toHaveBeenCalled();
  });

  it("surfaces a refused finalization honestly", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("started")),
      finalizeTournament: vi
        .fn()
        .mockRejectedValue(
          new TournamentProviderError(
            "provider_invalid_request",
            "The tournament provider refused to finalize the tournament (HTTP 400).",
            { status: 400 },
          ),
        ),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await finalizeEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(400);
  });

  it("reports a missing tournament as 404", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(null),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await finalizeEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(404);
  });
});

describe("TOURN-001: getEventTournamentSummary", () => {
  function mappedParticipantRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "p9",
      status: "qualified",
      provider_participant_id: "11",
      profile: { full_name: "Alex Mokoena" },
      ...overrides,
    };
  }

  it("resolves the champion of a completed tournament to the FOM participant", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("completed")),
      getMatches: vi.fn().mockResolvedValue([] as TournamentMatch[]),
      getWinner: vi.fn().mockResolvedValue({ providerParticipantId: "11" }),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce({ data: [mappedParticipantRow()], error: null });

    const result = await getEventTournamentSummary(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.isComplete).toBe(true);
    expect(result.ok === true && result.data.openMatchCount).toBe(0);
    expect(result.ok === true && result.data.winnerProviderParticipantId).toBe(
      "11",
    );
    // The provider participant id is translated back into FOM's own id.
    expect(result.ok === true && result.data.winnerParticipantId).toBe("p9");
  });

  it("counts reportable matches while the tournament is running", async () => {
    const matches: TournamentMatch[] = [
      {
        matchId: "1",
        round: 1,
        participant1Id: "11",
        participant2Id: "12",
        state: "ready",
        score: null,
        winnerParticipantId: null,
      },
      {
        matchId: "2",
        round: 1,
        participant1Id: "13",
        participant2Id: "14",
        state: "completed",
        score: { participant1Score: 1, participant2Score: 0 },
        winnerParticipantId: "13",
      },
      {
        matchId: "3",
        round: 2,
        participant1Id: "13",
        participant2Id: null,
        state: "pending",
        score: null,
        winnerParticipantId: null,
      },
    ];
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("started")),
      getMatches: vi.fn().mockResolvedValue(matches),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await getEventTournamentSummary(EVENT_A, PROFILE_MANAGER);

    expect(result.ok === true && result.data.openMatchCount).toBe(1);
    expect(result.ok === true && result.data.isComplete).toBe(false);
    expect(result.ok === true && result.data.winnerParticipantId).toBeNull();
    // A running tournament has no champion to read.
    expect(provider.getWinner).not.toHaveBeenCalled();
  });

  it("does not read a bracket for a tournament that has not started", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("created")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await getEventTournamentSummary(EVENT_A, PROFILE_MANAGER);

    expect(result.ok === true && result.data.openMatchCount).toBe(0);
    expect(provider.getMatches).not.toHaveBeenCalled();
    expect(provider.getWinner).not.toHaveBeenCalled();
  });
});

describe("TOURN-001: getEventTournamentBracket", () => {
  it("returns the bracket with FOM participant identities attached", async () => {
    const matches: TournamentMatch[] = [
      {
        matchId: "1",
        round: 1,
        participant1Id: "11",
        participant2Id: "12",
        state: "ready",
        score: null,
        winnerParticipantId: null,
      },
    ];
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("started")),
      getMatches: vi.fn().mockResolvedValue(matches),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce({
      data: [
        {
          id: "p1",
          status: "registered",
          provider_participant_id: "11",
          profile: { full_name: "Alex Mokoena" },
        },
        {
          id: "p2",
          status: "registered",
          provider_participant_id: null,
          profile: { full_name: "Bea" },
        },
      ],
      error: null,
    });

    const result = await getEventTournamentBracket(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.matches).toEqual(matches);
    // Unmapped participants are not part of the bracket yet.
    expect(result.ok === true && result.data.participants).toEqual([
      {
        providerParticipantId: "11",
        participantId: "p1",
        displayName: "Alex Mokoena",
        status: "registered",
      },
    ]);
  });

  it("T-REM-4: preserves a removed-but-mapped participant and logs the inconsistency", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const provider = fakeProvider({
        getTournament: vi.fn().mockResolvedValue(tournament("started")),
        getMatches: vi.fn().mockResolvedValue([] as TournamentMatch[]),
      });
      vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

      mockFromOnce({ data: linkedEventRow(), error: null });
      // A removed participant that is still provider-mapped (not producible
      // through FOM, but possible from out-of-band changes).
      mockFromOnce({
        data: [
          {
            id: "p1",
            status: "qualified",
            provider_participant_id: "11",
            removed_at: "2026-02-01T00:00:00Z",
            profile: { full_name: "Removed Champ" },
          },
        ],
        error: null,
      });

      const result = await getEventTournamentBracket(EVENT_A, PROFILE_MANAGER);

      // Provider state / historical bracket mapping is preserved untouched.
      expect(result.ok).toBe(true);
      expect(result.ok === true && result.data.participants).toEqual([
        {
          providerParticipantId: "11",
          participantId: "p1",
          displayName: "Removed Champ",
          status: "qualified",
        },
      ]);
      // The inconsistency is surfaced for reconciliation, never hidden.
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not read matches for a tournament that has not started", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("created")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce({ data: [], error: null });

    const result = await getEventTournamentBracket(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.matches).toEqual([]);
    expect(provider.getMatches).not.toHaveBeenCalled();
  });

  it("reports a bracket the provider no longer has as 404", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(null),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });
    mockFromOnce({ data: [], error: null });

    const result = await getEventTournamentBracket(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(404);
  });
});

describe("TOURN-002A: recorded tournament configuration", () => {
  it("reports the format a competition was created with", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("created")),
      getMatches: vi.fn().mockResolvedValue([] as TournamentMatch[]),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: linkedEventRow(), error: null });

    const result = await getEventTournamentSummary(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.config).toEqual({
      format: "single_elimination",
    });
  });

  it("reads a tournament created before TOURN-002A as single elimination", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("created")),
      getMatches: vi.fn().mockResolvedValue([] as TournamentMatch[]),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    // A linked row written before the format was recorded.
    mockFromOnce({
      data: linkedEventRow({ tournament_format: null }),
      error: null,
    });

    const result = await getEventTournamentSummary(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.config).toEqual({
      format: "single_elimination",
    });
  });

  it("never acts on an unexpected stored value", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("created")),
      getMatches: vi.fn().mockResolvedValue([] as TournamentMatch[]),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({
      data: linkedEventRow({ tournament_format: "penguin_racing" }),
      error: null,
    });

    const result = await getEventTournamentSummary(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.config).toEqual({
      format: "single_elimination",
    });
  });

  it("carries the recorded configuration through a start", async () => {
    const provider = fakeProvider({
      getTournament: vi.fn().mockResolvedValue(tournament("created")),
      startTournament: vi.fn().mockResolvedValue(tournament("started")),
    });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({
      data: linkedEventRow({ tournament_format: null }),
      error: null,
    });

    const result = await startEventTournament(EVENT_A, PROFILE_MANAGER);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.started).toBe(true);
    expect(result.ok === true && result.data.config).toEqual({
      format: "single_elimination",
    });
  });
});

describe("TOURN-002A: getEventTournamentFormatOptions", () => {
  it("reports every modelled format with the provider's own capability", async () => {
    const provider = fakeProvider();
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: unlinkedEventRow(), error: null });

    const result = await getEventTournamentFormatOptions(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(result.ok).toBe(true);

    const options = result.ok === true ? result.data : [];
    expect(options.map((option) => option.format)).toEqual(TOURNAMENT_FORMATS);
    expect(
      options
        .filter((option) => option.supported)
        .map((option) => option.format),
    ).toEqual(["single_elimination"]);
    // The adapter is asked, not assumed.
    expect(provider.supportsFormat).toHaveBeenCalledWith("swiss");
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });

  it("reports exactly what the provider supports", async () => {
    const provider = fakeProvider({ supportsFormat: vi.fn(() => false) });
    vi.mocked(resolveTournamentProvider).mockReturnValue(provider);

    mockFromOnce({ data: unlinkedEventRow(), error: null });

    const result = await getEventTournamentFormatOptions(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(result.ok).toBe(true);
    expect(
      result.ok === true && result.data.every((option) => !option.supported),
    ).toBe(true);
  });

  it("authorizes the caller with the existing competition management rule", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(false);

    const result = await getEventTournamentFormatOptions(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(403);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(resolveTournamentProvider).not.toHaveBeenCalled();
  });

  it("reports a missing competition as 404", async () => {
    mockFromOnce({ data: null, error: null });

    const result = await getEventTournamentFormatOptions(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(404);
  });

  it("reports an unconfigured provider instead of guessing a format", async () => {
    vi.mocked(resolveTournamentProvider).mockImplementation(() => {
      throw new TournamentProviderConfigError(["CHALLONGE_API_KEY"]);
    });

    mockFromOnce({ data: unlinkedEventRow(), error: null });

    const result = await getEventTournamentFormatOptions(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.status).toBe(503);
  });
});

describe("TOURN-001: service-wide authorization", () => {
  it("authorizes every read with the existing competition management rule", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(false);

    const bracket = await getEventTournamentBracket(EVENT_A, PROFILE_MANAGER);
    const summary = await getEventTournamentSummary(EVENT_A, PROFILE_MANAGER);
    const formats = await getEventTournamentFormatOptions(
      EVENT_A,
      PROFILE_MANAGER,
    );

    for (const result of [bracket, summary, formats]) {
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(403);
    }
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(resolveTournamentProvider).not.toHaveBeenCalled();
  });

  it("refuses every operation on a competition with no external tournament", async () => {
    mockFromOnce({ data: unlinkedEventRow(), error: null });
    mockFromOnce({ data: unlinkedEventRow(), error: null });

    const started = await startEventTournament(EVENT_A, PROFILE_MANAGER);
    const finalized = await finalizeEventTournament(EVENT_A, PROFILE_MANAGER);

    for (const result of [started, finalized]) {
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.status).toBe(409);
    }
    expect(resolveTournamentProvider).not.toHaveBeenCalled();
  });
});
