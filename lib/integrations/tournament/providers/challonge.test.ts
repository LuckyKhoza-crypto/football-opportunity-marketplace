import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CHALLONGE_API_BASE_URL,
  CHALLONGE_PROVIDER_ID,
  CHALLONGE_SUPPORTED_FORMATS,
  challongeSupportsFormat,
  createChallongeProvider,
  sanitizeProviderDetail,
  toChallongeScoresCsv,
  toChallongeTournamentType,
  toMatchScore,
  toMatchState,
  toTournament,
  toTournamentFormat,
  toTournamentMatch,
  toTournamentState,
} from "@/lib/integrations/tournament/providers/challonge";
import {
  TournamentProviderConfigError,
  TournamentProviderError,
} from "@/lib/integrations/tournament/errors";

/**
 * TOURN-001 — Challonge v1 adapter.
 *
 * Two things are asserted here:
 *   1. the translation between FOM-neutral types and Challonge's wire format
 *      (create/get/participants/start/matches/result/finalize/winner), and
 *   2. that a provider failure is never mistaken for success, never leaks the
 *      API key, and always surfaces as a typed error.
 *
 * The live API behaviour these expectations encode was verified by the isolated
 * POC (lib/integrations/challonge-poc/); the network is mocked here.
 */

const API_KEY = "test-challonge-api-key-value";
const BASE_URL = CHALLONGE_API_BASE_URL;

let fetchMock: ReturnType<typeof vi.fn>;

/** Minimal Response-like object for the mocked fetch. */
function httpResponse(
  body: unknown,
  init: { status?: number; raw?: string; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  const text =
    init.raw !== undefined
      ? init.raw
      : body === undefined
        ? ""
        : JSON.stringify(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        (init.headers ?? {})[String(name).toLowerCase()] ?? null,
    },
    text: async () => text,
  } as unknown as Response;
}

/** Adapter under test. Retries are disabled unless a test asks for them. */
function provider(options: { retryDelaysMs?: number[] } = {}) {
  return createChallongeProvider({
    baseUrl: BASE_URL,
    retryDelaysMs: options.retryDelaysMs ?? [],
  });
}

function requestAt(index: number): { url: URL; init: RequestInit } {
  const call = fetchMock.mock.calls[index] as [URL, RequestInit];
  return { url: call[0], init: call[1] };
}

function bodyAt(index: number): unknown {
  const { init } = requestAt(index);
  return init.body ? JSON.parse(String(init.body)) : undefined;
}

async function captureError(
  action: () => Promise<unknown>,
): Promise<TournamentProviderError> {
  try {
    await action();
  } catch (error) {
    return error as TournamentProviderError;
  }
  throw new Error("Expected the call to fail, but it resolved.");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CHALLONGE_API_KEY = API_KEY;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CHALLONGE_API_KEY;
});

describe("TOURN-001: Challonge adapter — authentication", () => {
  it("authenticates with the server-only key as the v1 api_key parameter", async () => {
    fetchMock.mockResolvedValue(
      httpResponse({
        tournament: {
          id: 123,
          name: "FOM",
          state: "pending",
          tournament_type: "single elimination",
        },
      }),
    );

    const tournament = await provider().getTournament("123");
    const { url, init } = requestAt(0);

    expect(tournament?.providerTournamentId).toBe("123");
    expect(url.origin + url.pathname).toBe(`${BASE_URL}/tournaments/123.json`);
    expect(url.searchParams.get("api_key")).toBe(API_KEY);
    expect(init.method).toBe("GET");
    expect(String(init.body ?? "")).not.toContain(API_KEY);
  });

  it("fails closed without a key, naming the variable but never a value", async () => {
    delete process.env.CHALLONGE_API_KEY;

    const error = await captureError(() => provider().getTournament("1"));

    expect(error).toBeInstanceOf(TournamentProviderConfigError);
    expect(error.code).toBe("provider_not_configured");
    expect((error as TournamentProviderConfigError).missing).toEqual([
      "CHALLONGE_API_KEY",
    ]);
    expect(error.message).toContain("CHALLONGE_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TOURN-001: Challonge adapter — error handling", () => {
  it("maps rejected credentials to provider_auth_failed without the key", async () => {
    fetchMock.mockResolvedValue(
      httpResponse(undefined, { status: 401, raw: '{"error":"Unauthorized"}' }),
    );

    const error = await captureError(() => provider().getMatches("9"));

    expect(error.code).toBe("provider_auth_failed");
    expect(error.status).toBe(401);
    expect(error.providerId).toBe(CHALLONGE_PROVIDER_ID);
    expect(error.message).toContain("/tournaments/9/matches.json");
    expect(error.message).not.toContain(API_KEY);
  });

  it("scrubs an api_key that a provider error body might echo back", async () => {
    fetchMock.mockResolvedValue(
      httpResponse(undefined, {
        status: 422,
        raw: '{"errors":["bad api_key=super-secret-token"]}',
      }),
    );

    const error = await captureError(() => provider().getMatches("9"));

    expect(error.code).toBe("provider_invalid_request");
    expect(error.message).not.toContain("super-secret-token");
    expect(error.message).toContain("api_key=***");
  });

  it("sanitises provider text and truncates it", () => {
    expect(sanitizeProviderDetail("api_key=abc123 failed")).toBe(
      "api_key=*** failed",
    );
    expect(sanitizeProviderDetail("x".repeat(1000)).length).toBeLessThanOrEqual(
      200,
    );
  });

  it("reports a definitive 404 as provider_not_found", async () => {
    fetchMock.mockResolvedValue(
      httpResponse(undefined, { status: 404, raw: "" }),
    );

    const error = await captureError(() => provider().getMatches("9"));

    expect(error.code).toBe("provider_not_found");
    expect(error.status).toBe(404);
  });

  it("treats a 404 on a tournament read as 'not found' (null) for adoption", async () => {
    fetchMock.mockResolvedValue(
      httpResponse(undefined, { status: 404, raw: "" }),
    );

    expect(await provider().getTournament("fom_evt_abc")).toBeNull();
  });

  it("retries throttled responses and then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(
        httpResponse(undefined, {
          status: 429,
          raw: "",
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(
        httpResponse({
          tournament: {
            id: 7,
            name: "FOM",
            state: "underway",
            tournament_type: "single elimination",
          },
        }),
      );

    const tournament = await provider({ retryDelaysMs: [0, 0] }).getTournament(
      "7",
    );

    expect(tournament?.state).toBe("started");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after its bounded retries on a server error", async () => {
    fetchMock.mockResolvedValue(
      httpResponse(undefined, { status: 503, raw: '{"error":"down"}' }),
    );

    const error = await captureError(() =>
      provider({ retryDelaysMs: [0, 0] }).getTournament("7"),
    );

    expect(error.code).toBe("provider_unavailable");
    expect(error.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("maps a network failure to provider_request_failed", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const error = await captureError(() => provider().getTournament("7"));

    expect(error.code).toBe("provider_request_failed");
  });

  it("maps a malformed response body to provider_response_invalid", async () => {
    fetchMock.mockResolvedValue(
      httpResponse(undefined, { raw: "<html>oops</html>" }),
    );

    const error = await captureError(() => provider().getTournament("7"));

    expect(error.code).toBe("provider_response_invalid");
  });

  it("rejects an unexpected response shape instead of guessing", async () => {
    fetchMock.mockResolvedValue(httpResponse({ error: "not a list" }));

    const error = await captureError(() => provider().getMatches("7"));

    expect(error.code).toBe("provider_response_invalid");
  });

  it("rejects a response missing the object it should contain", async () => {
    fetchMock.mockResolvedValue(httpResponse({}));

    const error = await captureError(() => provider().getTournament("7"));

    expect(error.code).toBe("provider_response_invalid");
  });
});

describe("TOURN-001: Challonge adapter — FOM-neutral translation", () => {
  it("maps every verified Challonge tournament state onto FOM's lifecycle", () => {
    expect(toTournamentState("pending")).toBe("created");
    expect(toTournamentState("checked_in")).toBe("created");
    expect(toTournamentState("underway")).toBe("started");
    // The POC proved a played-out bracket lands here until it is finalized.
    expect(toTournamentState("awaiting_review")).toBe("started");
    expect(toTournamentState("complete")).toBe("completed");
  });

  it("reports an unmodelled state as unknown rather than guessing", () => {
    expect(toTournamentState("something-new")).toBe("unknown");
    expect(toTournamentState(undefined)).toBe("unknown");
  });

  it("maps Challonge's match states onto FOM's match lifecycle", () => {
    expect(toMatchState("pending")).toBe("pending");
    expect(toMatchState("open")).toBe("ready");
    expect(toMatchState("complete")).toBe("completed");
    expect(toMatchState("weird")).toBe("unknown");
  });

  it("maps a Challonge scores_csv into FOM's paired score", () => {
    expect(toMatchScore("3-1")).toEqual({
      participant1Score: 3,
      participant2Score: 1,
    });
    // Multi-leg values keep the first leg; FOM models one paired score.
    expect(toMatchScore("3-1,2-2")).toEqual({
      participant1Score: 3,
      participant2Score: 1,
    });
    expect(toMatchScore(null)).toBeNull();
    expect(toMatchScore("")).toBeNull();
    expect(toMatchScore("not-a-score")).toBeNull();
  });

  it("renders FOM's paired score as a Challonge scores_csv", () => {
    expect(
      toChallongeScoresCsv({ participant1Score: 3, participant2Score: 1 }),
    ).toBe("3-1");
  });

  it("maps a tournament onto FOM fields only", () => {
    const tournament = toTournament({
      id: 42,
      name: "FOM Finals",
      url: "fom_evt_abc",
      state: "underway",
      tournament_type: "single elimination",
      full_challonge_url: "https://challonge.com/fom_evt_abc",
      completed_at: null,
    });

    expect(tournament).toEqual({
      providerTournamentId: "42",
      name: "FOM Finals",
      format: "single_elimination",
      state: "started",
      externalUrl: "https://challonge.com/fom_evt_abc",
      completedAt: null,
    });
    // No Challonge-specific field survives the translation.
    expect(tournament).not.toHaveProperty("tournament_type");
    expect(tournament).not.toHaveProperty("url");
  });

  it("accepts the format variants Challonge reports", () => {
    expect(toTournamentFormat("single elimination")).toBe("single_elimination");
    expect(toTournamentFormat("single_elimination")).toBe("single_elimination");
    expect(toTournamentFormat("Single Elimination")).toBe("single_elimination");
  });

  it("translates a readable format without inventing a supported one", () => {
    // Reading is not creating: a tournament FOM cannot create is still described
    // honestly, never reported as single elimination.
    expect(toTournamentFormat("double elimination")).toBe("double_elimination");
    expect(toTournamentFormat("round robin")).toBe("round_robin");
    expect(toTournamentFormat("Swiss")).toBe("swiss");
  });

  it("uses the requested format only when the provider omits it", () => {
    expect(toTournamentFormat(null, "single_elimination")).toBe(
      "single_elimination",
    );
    // The caller's own request is kept verbatim, never converted.
    expect(toTournamentFormat(null, "round_robin")).toBe("round_robin");

    expect(() => toTournamentFormat(null)).toThrow(TournamentProviderError);

    try {
      toTournamentFormat(null);
    } catch (error) {
      expect((error as TournamentProviderError).code).toBe(
        "provider_response_invalid",
      );
    }
  });

  it("refuses a format FOM does not model", () => {
    try {
      toTournamentFormat("group stages with finals");
    } catch (error) {
      const providerError = error as TournamentProviderError;
      expect(providerError.code).toBe("provider_response_invalid");
      expect(providerError.message).not.toContain("group stages");
    }
  });

  it("maps a raw match onto FOM-neutral fields", () => {
    const match = toTournamentMatch({
      id: 900,
      round: 2,
      player1_id: 11,
      player2_id: 12,
      winner_id: 12,
      state: "complete",
      scores_csv: "0-2",
    });

    expect(match).toEqual({
      matchId: "900",
      round: 2,
      participant1Id: "11",
      participant2Id: "12",
      state: "completed",
      score: { participant1Score: 0, participant2Score: 2 },
      winnerParticipantId: "12",
    });
    expect(match).not.toHaveProperty("player1_id");
    expect(match).not.toHaveProperty("scores_csv");
  });

  it("tolerates an undecided match", () => {
    const match = toTournamentMatch({
      id: 901,
      round: 1,
      player1_id: null,
      player2_id: null,
      winner_id: null,
      state: "pending",
      scores_csv: null,
    });

    expect(match.participant1Id).toBeNull();
    expect(match.participant2Id).toBeNull();
    expect(match.winnerParticipantId).toBeNull();
    expect(match.score).toBeNull();
  });
});

describe("TOURN-002A: Challonge adapter — format capability", () => {
  it("advertises only the format it can actually create", () => {
    expect(CHALLONGE_SUPPORTED_FORMATS).toEqual(["single_elimination"]);

    expect(challongeSupportsFormat("single_elimination")).toBe(true);
    expect(challongeSupportsFormat("double_elimination")).toBe(false);
    expect(challongeSupportsFormat("round_robin")).toBe(false);
    expect(challongeSupportsFormat("swiss")).toBe(false);
    expect(challongeSupportsFormat("group_stage_knockout")).toBe(false);
  });

  it("reports the same capability through the provider contract", () => {
    const adapter = provider();

    expect(adapter.supportsFormat("single_elimination")).toBe(true);
    expect(adapter.supportsFormat("swiss")).toBe(false);
  });

  it("maps only a supported format onto a Challonge tournament_type", () => {
    expect(toChallongeTournamentType("single_elimination")).toBe(
      "single elimination",
    );

    for (const format of CHALLONGE_SUPPORTED_FORMATS) {
      expect(() => toChallongeTournamentType(format)).not.toThrow();
    }

    try {
      toChallongeTournamentType("round_robin");
    } catch (error) {
      const providerError = error as TournamentProviderError;
      expect(providerError.code).toBe("tournament_invalid_input");
      expect(providerError.message).toContain("round_robin");
    }
  });

  it("creates nothing for a format it does not support", async () => {
    const error = await captureError(() =>
      provider().createTournament({
        name: "FOM",
        slug: "fom_evt_x",
        config: { format: "double_elimination" },
      }),
    );

    expect(error.code).toBe("tournament_invalid_input");
    // No request was made: nothing was created, and nothing was substituted.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TOURN-001: Challonge adapter — create and participants", () => {
  it("creates a tournament from the FOM request", async () => {
    fetchMock.mockResolvedValue(
      httpResponse({
        tournament: {
          id: 555,
          name: "FOM Finals Night",
          url: "fom_evt_abc",
          state: "pending",
          tournament_type: "single elimination",
          full_challonge_url: "https://challonge.com/fom_evt_abc",
          completed_at: null,
        },
      }),
    );

    const tournament = await provider().createTournament({
      name: "FOM Finals Night",
      slug: "fom_evt_abc",
      config: { format: "single_elimination" },
    });

    const { url, init } = requestAt(0);
    expect(url.origin + url.pathname).toBe(`${BASE_URL}/tournaments.json`);
    expect(init.method).toBe("POST");
    expect(bodyAt(0)).toEqual({
      tournament: {
        name: "FOM Finals Night",
        url: "fom_evt_abc",
        tournament_type: "single elimination",
        private: true,
      },
    });
    expect(tournament.providerTournamentId).toBe("555");
    expect(tournament.state).toBe("created");
  });

  it("keeps the requested format when the creation response omits it", async () => {
    fetchMock.mockResolvedValue(
      httpResponse({ tournament: { id: 1, name: "FOM", state: "pending" } }),
    );

    const tournament = await provider().createTournament({
      name: "FOM",
      slug: "fom_evt_x",
      config: { format: "single_elimination" },
    });

    expect(tournament.format).toBe("single_elimination");
  });

  it("surfaces a duplicate slug so the caller can adopt the existing tournament", async () => {
    fetchMock.mockResolvedValue(
      httpResponse(undefined, {
        status: 422,
        raw: '{"errors":["url has already been taken"]}',
      }),
    );

    const error = await captureError(() =>
      provider().createTournament({
        name: "FOM",
        slug: "fom_evt_abc",
        config: { format: "single_elimination" },
      }),
    );

    expect(error.code).toBe("provider_invalid_request");
    expect(error.status).toBe(422);
    expect(error.message).toContain("url has already been taken");
  });

  it("adds participants in one call and correlates the ids by order", async () => {
    fetchMock.mockResolvedValue(
      httpResponse([
        { participant: { id: 11, name: "Alex" } },
        { participant: { id: 12, name: "Bea" } },
      ]),
    );

    const added = await provider().addParticipants("555", [
      { ref: "p1", displayName: "Alex" },
      { ref: "p2", displayName: "Bea" },
    ]);

    const { url, init } = requestAt(0);
    expect(url.origin + url.pathname).toBe(
      `${BASE_URL}/tournaments/555/participants/bulk_add.json`,
    );
    expect(init.method).toBe("POST");
    expect(bodyAt(0)).toEqual({
      participants: [{ name: "Alex" }, { name: "Bea" }],
    });
    expect(added).toEqual([
      { ref: "p1", providerParticipantId: "11" },
      { ref: "p2", providerParticipantId: "12" },
    ]);
  });

  it("does not call the provider when there is nothing to add", async () => {
    expect(await provider().addParticipants("555", [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a mismatched participant response so a wrong mapping is never stored", async () => {
    fetchMock.mockResolvedValue(
      httpResponse([{ participant: { id: 11, name: "Alex" } }]),
    );

    const error = await captureError(() =>
      provider().addParticipants("555", [
        { ref: "p1", displayName: "Alex" },
        { ref: "p2", displayName: "Bea" },
      ]),
    );

    expect(error.code).toBe("provider_response_invalid");
    expect(error.message).toContain("No mapping was saved");
  });

  it("refuses a reordered participant response", async () => {
    fetchMock.mockResolvedValue(
      httpResponse([
        { participant: { id: 11, name: "Bea" } },
        { participant: { id: 12, name: "Alex" } },
      ]),
    );

    const error = await captureError(() =>
      provider().addParticipants("555", [
        { ref: "p1", displayName: "Alex" },
        { ref: "p2", displayName: "Bea" },
      ]),
    );

    expect(error.code).toBe("provider_response_invalid");
    expect(error.message).toContain("unexpected order");
  });

  it("lists the participants the provider currently holds", async () => {
    fetchMock.mockResolvedValue(
      httpResponse([
        { participant: { id: 11, name: "Alex" } },
        { participant: { id: 12, name: "Bea" } },
      ]),
    );

    expect(await provider().getParticipants("555")).toEqual([
      { providerParticipantId: "11", displayName: "Alex" },
      { providerParticipantId: "12", displayName: "Bea" },
    ]);
  });
});

describe("TOURN-001: Challonge adapter — start, matches and results", () => {
  it("starts the tournament and reports the authoritative state back", async () => {
    fetchMock
      .mockResolvedValueOnce(httpResponse(undefined, { raw: "" }))
      .mockResolvedValueOnce(
        httpResponse({
          tournament: {
            id: 555,
            name: "FOM",
            state: "underway",
            tournament_type: "single elimination",
          },
        }),
      );

    const tournament = await provider().startTournament("555");

    expect(requestAt(0).url.pathname).toBe("/v1/tournaments/555/start.json");
    expect(requestAt(0).init.method).toBe("POST");
    expect(tournament.state).toBe("started");
  });

  it("reports a start whose tournament vanished as not found", async () => {
    fetchMock
      .mockResolvedValueOnce(httpResponse(undefined, { raw: "" }))
      .mockResolvedValueOnce(httpResponse(undefined, { status: 404, raw: "" }));

    const error = await captureError(() => provider().startTournament("555"));

    expect(error.code).toBe("provider_not_found");
  });

  it("reads the bracket as FOM-neutral matches", async () => {
    fetchMock.mockResolvedValue(
      httpResponse([
        {
          match: {
            id: 1,
            round: 1,
            player1_id: 11,
            player2_id: 12,
            winner_id: 11,
            state: "complete",
            scores_csv: "2-0",
          },
        },
        {
          match: {
            id: 2,
            round: 2,
            player1_id: 11,
            player2_id: null,
            winner_id: null,
            state: "pending",
            scores_csv: null,
          },
        },
      ]),
    );

    const matches = await provider().getMatches("555");

    expect(requestAt(0).url.pathname).toBe("/v1/tournaments/555/matches.json");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({
      matchId: "1",
      round: 1,
      participant1Id: "11",
      participant2Id: "12",
      state: "completed",
      score: { participant1Score: 2, participant2Score: 0 },
      winnerParticipantId: "11",
    });
    expect(matches[1].state).toBe("pending");
  });

  it("submits a FOM result as the provider's score + winner", async () => {
    fetchMock.mockResolvedValue(
      httpResponse({
        match: {
          id: 1,
          round: 1,
          player1_id: 11,
          player2_id: 12,
          winner_id: 11,
          state: "complete",
          scores_csv: "3-1",
        },
      }),
    );

    const match = await provider().reportMatchResult("555", {
      matchId: "1",
      participant1Score: 3,
      participant2Score: 1,
      winnerParticipantId: "11",
    });

    const { url, init } = requestAt(0);
    expect(url.pathname).toBe("/v1/tournaments/555/matches/1.json");
    expect(init.method).toBe("PUT");
    expect(bodyAt(0)).toEqual({ match: { scores_csv: "3-1", winner_id: 11 } });
    expect(match.winnerParticipantId).toBe("11");
    // An explicit winner needs no extra read.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("derives the winner from the scores when none is given", async () => {
    fetchMock
      .mockResolvedValueOnce(
        httpResponse([
          {
            match: {
              id: 1,
              round: 1,
              player1_id: 11,
              player2_id: 12,
              winner_id: null,
              state: "open",
              scores_csv: null,
            },
          },
        ]),
      )
      .mockResolvedValueOnce(
        httpResponse({
          match: {
            id: 1,
            round: 1,
            player1_id: 11,
            player2_id: 12,
            winner_id: 12,
            state: "complete",
            scores_csv: "0-1",
          },
        }),
      );

    const match = await provider().reportMatchResult("555", {
      matchId: "1",
      participant1Score: 0,
      participant2Score: 1,
    });

    expect(bodyAt(1)).toEqual({ match: { scores_csv: "0-1", winner_id: 12 } });
    expect(match.winnerParticipantId).toBe("12");
  });

  it("refuses a level score with no explicit winner", async () => {
    fetchMock.mockResolvedValueOnce(
      httpResponse([
        {
          match: {
            id: 1,
            round: 1,
            player1_id: 11,
            player2_id: 12,
            winner_id: null,
            state: "open",
            scores_csv: null,
          },
        },
      ]),
    );

    const error = await captureError(() =>
      provider().reportMatchResult("555", {
        matchId: "1",
        participant1Score: 1,
        participant2Score: 1,
      }),
    );

    expect(error.code).toBe("tournament_invalid_input");
    // The result was never submitted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires a match id before calling the provider", async () => {
    const error = await captureError(() =>
      provider().reportMatchResult("555", {
        matchId: "   ",
        participant1Score: 1,
        participant2Score: 0,
      }),
    );

    expect(error.code).toBe("tournament_invalid_input");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not report success when the provider fails to confirm a result", async () => {
    fetchMock.mockResolvedValue(httpResponse({}));

    const error = await captureError(() =>
      provider().reportMatchResult("555", {
        matchId: "1",
        participant1Score: 1,
        participant2Score: 0,
        winnerParticipantId: "11",
      }),
    );

    expect(error.code).toBe("provider_response_invalid");
  });
});

describe("TOURN-001: Challonge adapter — finalize and champion", () => {
  it("is idempotent for an already-completed tournament", async () => {
    fetchMock.mockResolvedValue(
      httpResponse({
        tournament: {
          id: 555,
          name: "FOM",
          state: "complete",
          tournament_type: "single elimination",
          completed_at: "2026-01-01T10:00:00Z",
        },
      }),
    );

    const tournament = await provider().finalizeTournament("555");

    expect(tournament.state).toBe("completed");
    expect(tournament.completedAt).toBe("2026-01-01T10:00:00Z");
    // No finalize call is issued for a tournament that is already final.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestAt(0).init.method).toBe("GET");
  });

  it("finalizes a started tournament and returns the completed state", async () => {
    fetchMock
      .mockResolvedValueOnce(
        httpResponse({
          tournament: {
            id: 555,
            name: "FOM",
            state: "awaiting_review",
            tournament_type: "single elimination",
          },
        }),
      )
      .mockResolvedValueOnce(httpResponse(undefined, { raw: "" }))
      .mockResolvedValueOnce(
        httpResponse({
          tournament: {
            id: 555,
            name: "FOM",
            state: "complete",
            tournament_type: "single elimination",
            completed_at: "2026-01-01T10:00:00Z",
          },
        }),
      );

    const tournament = await provider().finalizeTournament("555");

    expect(requestAt(1).url.pathname).toBe("/v1/tournaments/555/finalize.json");
    expect(requestAt(1).init.method).toBe("POST");
    expect(tournament.state).toBe("completed");
  });

  it("surfaces an unfinalizable tournament as a clear invalid request", async () => {
    fetchMock
      .mockResolvedValueOnce(
        httpResponse({
          tournament: {
            id: 555,
            name: "FOM",
            state: "underway",
            tournament_type: "single elimination",
          },
        }),
      )
      // The POC observed HTTP 400 with an EMPTY body when finalize is refused.
      .mockResolvedValueOnce(httpResponse(undefined, { status: 400, raw: "" }));

    const error = await captureError(() => provider().finalizeTournament("555"));

    expect(error.code).toBe("provider_invalid_request");
    expect(error.status).toBe(400);
    expect(error.message).toContain("HTTP 400");
  });

  it("refuses to finalize a tournament that never started", async () => {
    fetchMock.mockResolvedValue(
      httpResponse({
        tournament: {
          id: 555,
          name: "FOM",
          state: "pending",
          tournament_type: "single elimination",
        },
      }),
    );

    const error = await captureError(() => provider().finalizeTournament("555"));

    expect(error.code).toBe("provider_invalid_request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("has no champion while the tournament is still running", async () => {
    fetchMock.mockResolvedValue(
      httpResponse({
        tournament: {
          id: 555,
          name: "FOM",
          state: "underway",
          tournament_type: "single elimination",
        },
      }),
    );

    expect(await provider().getWinner("555")).toBeNull();
    // The bracket is not read while there is no champion to resolve.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads the champion from the final round of a completed tournament", async () => {
    fetchMock
      .mockResolvedValueOnce(
        httpResponse({
          tournament: {
            id: 555,
            name: "FOM",
            state: "complete",
            tournament_type: "single elimination",
          },
        }),
      )
      .mockResolvedValueOnce(
        httpResponse([
          {
            match: {
              id: 1,
              round: 1,
              player1_id: 11,
              player2_id: 12,
              winner_id: 11,
              state: "complete",
              scores_csv: "1-0",
            },
          },
          {
            match: {
              id: 2,
              round: 1,
              player1_id: 13,
              player2_id: 14,
              winner_id: 13,
              state: "complete",
              scores_csv: "1-0",
            },
          },
          {
            match: {
              id: 3,
              round: 2,
              player1_id: 11,
              player2_id: 13,
              winner_id: 13,
              state: "complete",
              scores_csv: "0-1",
            },
          },
        ]),
      );

    expect(await provider().getWinner("555")).toEqual({
      providerParticipantId: "13",
    });
  });

  it("has no champion when no match has been decided", async () => {
    fetchMock
      .mockResolvedValueOnce(
        httpResponse({
          tournament: {
            id: 555,
            name: "FOM",
            state: "complete",
            tournament_type: "single elimination",
          },
        }),
      )
      .mockResolvedValueOnce(httpResponse([]));

    expect(await provider().getWinner("555")).toBeNull();
  });

  it("reports a winner read for a missing tournament as not found", async () => {
    fetchMock.mockResolvedValue(
      httpResponse(undefined, { status: 404, raw: "" }),
    );

    const error = await captureError(() => provider().getWinner("555"));

    expect(error.code).toBe("provider_not_found");
  });
});
