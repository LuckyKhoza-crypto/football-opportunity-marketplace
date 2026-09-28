import { describe, it, expect } from "vitest";

import {
  DEFAULT_TOURNAMENT_FORMAT,
  isMatchReference,
  isTournamentComplete,
  isTournamentFormat,
  isValidMatchScoreValue,
  MATCH_REFERENCE_PREFIX,
  participantDisplayName,
  TOURNAMENT_FORMATS,
  toMatchReference,
  toTournamentConfig,
} from "@/lib/integrations/tournament/contract";

/**
 * TOURN-001 — Pure provider-neutral contract helpers.
 * TOURN-002A — the tournament format vocabulary + configuration narrowing.
 * TOURN-003 — FOM's own match reference (result reporting).
 */

describe("TOURN-002A: tournament formats and configuration", () => {
  it("models every format an organiser may eventually choose", () => {
    expect(TOURNAMENT_FORMATS).toEqual([
      "single_elimination",
      "double_elimination",
      "round_robin",
      "swiss",
      "group_stage_knockout",
    ]);
  });

  it("keeps single elimination as the default (backward compatibility)", () => {
    expect(DEFAULT_TOURNAMENT_FORMAT).toBe("single_elimination");
    expect(isTournamentFormat(DEFAULT_TOURNAMENT_FORMAT)).toBe(true);
  });

  it("narrows only modelled formats", () => {
    for (const format of TOURNAMENT_FORMATS) {
      expect(isTournamentFormat(format)).toBe(true);
    }

    expect(isTournamentFormat("group_stage")).toBe(false);
    expect(isTournamentFormat("")).toBe(false);
    expect(isTournamentFormat(undefined)).toBe(false);
    expect(isTournamentFormat(null)).toBe(false);
    expect(isTournamentFormat(1)).toBe(false);
  });

  it("reads a missing configuration as the default", () => {
    expect(toTournamentConfig(undefined)).toEqual({
      format: "single_elimination",
    });
    expect(toTournamentConfig(null)).toEqual({ format: "single_elimination" });
    expect(toTournamentConfig({})).toEqual({ format: "single_elimination" });
    expect(toTournamentConfig({ format: undefined })).toEqual({
      format: "single_elimination",
    });
  });

  it("accepts a modelled format unchanged", () => {
    expect(toTournamentConfig({ format: "single_elimination" })).toEqual({
      format: "single_elimination",
    });
    expect(toTournamentConfig({ format: "round_robin" })).toEqual({
      format: "round_robin",
    });
  });

  it("rejects a format it does not model instead of substituting one", () => {
    // Never converted into another format — especially not the default.
    expect(toTournamentConfig({ format: "penguin_racing" })).toBeNull();
    expect(toTournamentConfig({ format: "" })).toBeNull();
    expect(toTournamentConfig({ format: 7 })).toBeNull();
    // Not a configuration object at all.
    expect(toTournamentConfig("single_elimination")).toBeNull();
    expect(toTournamentConfig(7)).toBeNull();
  });
});

describe("TOURN-001: isTournamentComplete", () => {
  it("treats only the completed state as complete", () => {
    expect(isTournamentComplete({ state: "completed" })).toBe(true);
    expect(isTournamentComplete({ state: "started" })).toBe(false);
    expect(isTournamentComplete({ state: "created" })).toBe(false);
    // An unrecognised provider state must never look complete.
    expect(isTournamentComplete({ state: "unknown" })).toBe(false);
  });

  it("is safe for a missing tournament", () => {
    expect(isTournamentComplete(null)).toBe(false);
    expect(isTournamentComplete(undefined)).toBe(false);
  });
});

describe("TOURN-001: isValidMatchScoreValue", () => {
  it("accepts whole, non-negative numbers", () => {
    expect(isValidMatchScoreValue(0)).toBe(true);
    expect(isValidMatchScoreValue(12)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidMatchScoreValue(-1)).toBe(false);
    expect(isValidMatchScoreValue(1.5)).toBe(false);
    expect(isValidMatchScoreValue("3")).toBe(false);
    expect(isValidMatchScoreValue(Number.NaN)).toBe(false);
    expect(isValidMatchScoreValue(null)).toBe(false);
  });
});

describe("TOURN-001: participantDisplayName", () => {
  it("uses the participant's own name when present", () => {
    expect(participantDisplayName("  Alex   Mokoena ", 4)).toBe(
      "Alex Mokoena",
    );
  });

  it("falls back to a stable positional name when the profile has none", () => {
    expect(participantDisplayName(null, 3)).toBe("Player 3");
    expect(participantDisplayName("   ", 1)).toBe("Player 1");
    expect(participantDisplayName(undefined, 0)).toBe("Player 1");
  });

  it("never leaks an email-shaped fallback", () => {
    expect(participantDisplayName(null, 2)).not.toContain("@");
  });
});

describe("TOURN-003: match references", () => {
  const PARTICIPANT_1 = "11111111-1111-4111-8111-111111111111";
  const PARTICIPANT_2 = "22222222-2222-4222-8222-222222222222";

  it("composes the reference from the round and the two FOM participant ids", () => {
    expect(
      toMatchReference({
        round: 2,
        participant1Id: PARTICIPANT_1,
        participant2Id: PARTICIPANT_2,
      }),
    ).toBe(`${MATCH_REFERENCE_PREFIX}2:${PARTICIPANT_1}:${PARTICIPANT_2}`);
  });

  it("is null while a side is undecided or unmapped", () => {
    // TBD side: the provider has not fed the match yet.
    expect(
      toMatchReference({
        round: 1,
        participant1Id: PARTICIPANT_1,
        participant2Id: null,
      }),
    ).toBeNull();

    // Present on the provider but not mapped to a FOM participant.
    expect(
      toMatchReference({
        round: 1,
        participant1Id: null,
        participant2Id: PARTICIPANT_2,
      }),
    ).toBeNull();

    expect(
      toMatchReference({
        round: 1,
        participant1Id: "   ",
        participant2Id: PARTICIPANT_2,
      }),
    ).toBeNull();
  });

  it("keeps the round the provider reported (no fixed bracket shape)", () => {
    const ref = toMatchReference({
      round: 7,
      participant1Id: PARTICIPANT_1,
      participant2Id: PARTICIPANT_2,
    });
    expect(ref?.startsWith(`${MATCH_REFERENCE_PREFIX}7:`)).toBe(true);
  });

  it("narrows only well-formed references", () => {
    const valid = toMatchReference({
      round: 1,
      participant1Id: PARTICIPANT_1,
      participant2Id: PARTICIPANT_2,
    }) as string;

    expect(isMatchReference(valid)).toBe(true);

    // Provider-shaped ids, other separators, missing parts and non-strings.
    expect(isMatchReference(PARTICIPANT_1)).toBe(false);
    expect(isMatchReference("99110022")).toBe(false);
    expect(isMatchReference("r1")).toBe(false);
    expect(isMatchReference(`r1:${PARTICIPANT_1}`)).toBe(false);
    expect(isMatchReference(`r:${PARTICIPANT_1}:${PARTICIPANT_2}`)).toBe(false);
    expect(isMatchReference(`r1:${PARTICIPANT_1}:${PARTICIPANT_2}:x`)).toBe(false);
    expect(isMatchReference("")).toBe(false);
    expect(isMatchReference(null)).toBe(false);
    expect(isMatchReference(1)).toBe(false);
  });
});
