import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CHALLONGE_TOURNAMENT_PROVIDER_ID,
  DEFAULT_TOURNAMENT_PROVIDER,
  getDefaultTournamentProvider,
  isTournamentProviderId,
  resolveTournamentProvider,
  TOURNAMENT_PROVIDER_IDS,
} from "@/lib/integrations/tournament/registry";
import { TournamentProviderError } from "@/lib/integrations/tournament/errors";
import { isChallongeConfigured } from "@/lib/integrations/tournament/config";
import type { TournamentProvider } from "@/lib/integrations/tournament/types";

/**
 * TOURN-001 — Provider selection.
 *
 * The registry is the replaceability seam: FOM asks for the provider recorded on
 * a competition and receives a TournamentProvider. Nothing outside the
 * integration folder ever names Challonge.
 */

const CONTRACT_METHODS: Array<keyof TournamentProvider> = [
  "supportsFormat",
  "createTournament",
  "getTournament",
  "addParticipants",
  "getParticipants",
  "startTournament",
  "getMatches",
  "reportMatchResult",
  "finalizeTournament",
  "getWinner",
];

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CHALLONGE_API_KEY;
});

afterEach(() => {
  delete process.env.CHALLONGE_API_KEY;
});

describe("TOURN-001: provider registry", () => {
  it("resolves the challonge provider id to an adapter implementing the contract", () => {
    const provider = resolveTournamentProvider("challonge");

    expect(provider.id).toBe(CHALLONGE_TOURNAMENT_PROVIDER_ID);
    for (const method of CONTRACT_METHODS) {
      expect(typeof provider[method]).toBe("function");
    }
  });

  it("normalises casing and whitespace coming from a database row or request", () => {
    expect(resolveTournamentProvider("  Challonge ").id).toBe("challonge");
  });

  it("falls back to the default provider when no id is given", () => {
    expect(DEFAULT_TOURNAMENT_PROVIDER).toBe("challonge");
    expect(resolveTournamentProvider(null).id).toBe("challonge");
    expect(resolveTournamentProvider(undefined).id).toBe("challonge");
    expect(resolveTournamentProvider("").id).toBe("challonge");
    expect(getDefaultTournamentProvider().id).toBe("challonge");
  });

  it("rejects an unregistered provider instead of guessing", () => {
    expect(() => resolveTournamentProvider("some-other-provider")).toThrow(
      TournamentProviderError,
    );

    try {
      resolveTournamentProvider("some-other-provider");
    } catch (error) {
      const providerError = error as TournamentProviderError;
      expect(providerError.code).toBe("provider_unknown");
      expect(providerError.message).toContain("some-other-provider");
      expect(providerError.message).toContain("challonge");
    }
  });

  it("exposes the registered provider ids", () => {
    expect(TOURNAMENT_PROVIDER_IDS).toEqual(["challonge"]);
    expect(isTournamentProviderId("challonge")).toBe(true);
    expect(isTournamentProviderId("CHALLONGE")).toBe(true);
    expect(isTournamentProviderId("nope")).toBe(false);
  });

  it("resolves without requiring credentials (the key is only read on a call)", () => {
    delete process.env.CHALLONGE_API_KEY;

    // Resolution succeeds and reporting configuration is honest.
    expect(resolveTournamentProvider("challonge").id).toBe("challonge");
    expect(isChallongeConfigured()).toBe(false);
  });
});
