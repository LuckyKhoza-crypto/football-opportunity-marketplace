import { describe, it, expect } from "vitest";

import {
  COMPETITION_EVENT_STATUS_VALUES,
  COMPETITION_PARTICIPANT_STATUS_VALUES,
  COMPETITION_EVENT_TRANSITIONS,
  isCompetitionEventStatus,
  isCompetitionParticipantStatus,
  isValidChallengeConfig,
  isQualified,
  getAllowedEventTransitions,
  isValidEventTransition,
  computeCompetitionStatistics,
} from "@/lib/competition";
import type { CompetitionParticipantStatus } from "@/types";

describe("COMP-001: competition event status", () => {
  it("accepts every supported lifecycle status", () => {
    for (const status of [
      "draft",
      "active",
      "drawing",
      "completed",
      "cancelled",
    ]) {
      expect(isCompetitionEventStatus(status)).toBe(true);
    }
  });

  it("exposes exactly the supported lifecycle statuses", () => {
    expect(COMPETITION_EVENT_STATUS_VALUES).toEqual([
      "draft",
      "active",
      "drawing",
      "completed",
      "cancelled",
    ]);
  });

  it("rejects invalid event status values", () => {
    expect(isCompetitionEventStatus("published")).toBe(false);
    expect(isCompetitionEventStatus("DRAFT")).toBe(false);
    expect(isCompetitionEventStatus("")).toBe(false);
    expect(isCompetitionEventStatus("qualified")).toBe(false);
    expect(isCompetitionEventStatus(undefined)).toBe(false);
    expect(isCompetitionEventStatus(3)).toBe(false);
  });
});

describe("COMP-001: participant status", () => {
  it("accepts every supported participant status", () => {
    for (const status of [
      "registered",
      "challenge_pending",
      "qualified",
      "not_qualified",
    ]) {
      expect(isCompetitionParticipantStatus(status)).toBe(true);
    }
  });

  it("exposes exactly the supported participant statuses", () => {
    expect(COMPETITION_PARTICIPANT_STATUS_VALUES).toEqual([
      "registered",
      "challenge_pending",
      "qualified",
      "not_qualified",
    ]);
  });

  it("rejects invalid participant status values", () => {
    expect(isCompetitionParticipantStatus("active")).toBe(false);
    expect(isCompetitionParticipantStatus("winner")).toBe(false);
    expect(isCompetitionParticipantStatus(null)).toBe(false);
  });

  it("treats qualified and not_qualified as distinct event-specific states", () => {
    expect(isQualified("qualified")).toBe(true);
    expect(isQualified("not_qualified")).toBe(false);
  });
});

describe("COMP-001: challenge configuration", () => {
  it("accepts a valid challenge configuration stored on the event", () => {
    expect(
      isValidChallengeConfig({
        challenge_name: "Juggle Challenge",
        challenge_threshold: 30,
        max_attempts: 3,
      }),
    ).toBe(true);
  });

  it("supports different challenges (config is not hard-coded)", () => {
    expect(
      isValidChallengeConfig({
        challenge_name: "Sprint Challenge",
        challenge_threshold: 10,
        max_attempts: 5,
      }),
    ).toBe(true);
  });

  it("rejects a missing/blank challenge name", () => {
    expect(
      isValidChallengeConfig({
        challenge_name: "",
        challenge_threshold: 30,
        max_attempts: 3,
      }),
    ).toBe(false);
    expect(
      isValidChallengeConfig({
        challenge_name: "   ",
        challenge_threshold: 30,
        max_attempts: 3,
      }),
    ).toBe(false);
  });

  it("rejects a non-positive threshold", () => {
    expect(
      isValidChallengeConfig({
        challenge_name: "Juggle Challenge",
        challenge_threshold: 0,
        max_attempts: 3,
      }),
    ).toBe(false);
    expect(
      isValidChallengeConfig({
        challenge_name: "Juggle Challenge",
        challenge_threshold: -1,
        max_attempts: 3,
      }),
    ).toBe(false);
  });

  it("rejects a non-positive max attempts", () => {
    expect(
      isValidChallengeConfig({
        challenge_name: "Juggle Challenge",
        challenge_threshold: 30,
        max_attempts: 0,
      }),
    ).toBe(false);
    expect(
      isValidChallengeConfig({
        challenge_name: "Juggle Challenge",
        challenge_threshold: 30,
        max_attempts: -3,
      }),
    ).toBe(false);
  });

  it("rejects non-integer configuration values", () => {
    expect(
      isValidChallengeConfig({
        challenge_name: "Juggle Challenge",
        challenge_threshold: 30.5,
        max_attempts: 3,
      }),
    ).toBe(false);
  });
});

describe("COMP-002: lifecycle transitions", () => {
  it("allows every documented valid transition", () => {
    const valid: [string, string][] = [
      ["draft", "active"],
      ["draft", "cancelled"],
      ["active", "drawing"],
      ["active", "cancelled"],
      ["drawing", "active"],
      ["drawing", "completed"],
    ];

    for (const [from, to] of valid) {
      expect(
        isValidEventTransition(
          from as never,
          to as never,
        ),
      ).toBe(true);
    }
  });

  it("rejects invalid transitions", () => {
    const invalid: [string, string][] = [
      ["draft", "completed"],
      ["draft", "drawing"],
      ["completed", "active"],
      ["completed", "drawing"],
      ["cancelled", "active"],
      ["cancelled", "cancelled"],
      ["active", "completed"],
      ["drawing", "cancelled"],
    ];

    for (const [from, to] of invalid) {
      expect(
        isValidEventTransition(
          from as never,
          to as never,
        ),
      ).toBe(false);
    }
  });

  it("treats completed and cancelled as terminal", () => {
    expect(getAllowedEventTransitions("completed")).toEqual([]);
    expect(getAllowedEventTransitions("cancelled")).toEqual([]);
  });

  it("rejects self-transitions", () => {
    for (const status of COMPETITION_EVENT_STATUS_VALUES) {
      expect(isValidEventTransition(status, status)).toBe(false);
    }
  });

  it("does not allow callers to mutate the transition map", () => {
    const before = [...COMPETITION_EVENT_TRANSITIONS.draft];
    const copy = getAllowedEventTransitions("draft");
    copy.push("completed");
    expect(COMPETITION_EVENT_TRANSITIONS.draft).toEqual(before);
  });
});

describe("COMP-002: statistics", () => {
  const rows = (statuses: CompetitionParticipantStatus[]) =>
    statuses.map((status) => ({ status }));

  it("counts zero for an empty event", () => {
    const stats = computeCompetitionStatistics([]);
    expect(stats).toEqual({
      total: 0,
      registered: 0,
      challenge_pending: 0,
      qualified: 0,
      not_qualified: 0,
      ambassadors: 0,
    });
  });

  it("counts participants by status", () => {
    const stats = computeCompetitionStatistics(
      rows([
        "registered",
        "registered",
        "challenge_pending",
        "qualified",
        "qualified",
        "qualified",
        "not_qualified",
      ]),
      [{ id: "a" }, { id: "b" }],
    );

    expect(stats.total).toBe(7);
    expect(stats.registered).toBe(2);
    expect(stats.challenge_pending).toBe(1);
    expect(stats.qualified).toBe(3);
    expect(stats.not_qualified).toBe(1);
    expect(stats.ambassadors).toBe(2);
  });

  it("registered + challenge_pending represents pending participants", () => {
    const stats = computeCompetitionStatistics(
      rows(["registered", "challenge_pending", "qualified"]),
    );
    expect(stats.registered + stats.challenge_pending).toBe(2);
  });
});
