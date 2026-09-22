import { describe, it, expect } from "vitest";
import {
  parseAttemptResultValue,
  meetsChallengeThreshold,
  computeParticipantChallengeState,
  getNextAttemptNumber,
  resolveParticipantStatus,
  getChallengeStateLabel,
  ATTEMPT_RESULT_ABS_LIMIT,
  type AttemptSummary,
} from "@/lib/competition-attempt";

/**
 * COMP-004 — Pure attempt/verification helper tests.
 *
 * These cover the deterministic business logic (numbering, threshold, state)
 * that must never depend on the browser.
 */

const EV = {
  challenge_name: "Juggle Challenge",
  challenge_threshold: 30,
  max_attempts: 3,
};

const PART = { id: "part-1", event_id: "ev-1", status: "registered" as const };

function attempt(
  attempt_number: number,
  result_value: number,
  passed: boolean,
): AttemptSummary {
  return { attempt_number, result_value, passed };
}

describe("COMP-004: parseAttemptResultValue", () => {
  it("accepts a finite number", () => {
    const r = parseAttemptResultValue(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("accepts a numeric string", () => {
    const r = parseAttemptResultValue("42.5");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42.5);
  });

  it("accepts negative numbers (direction is decided elsewhere)", () => {
    const r = parseAttemptResultValue(-5);
    expect(r.ok).toBe(true);
  });

  it.each([undefined, null, "", "   ", {}, [], true])(
    "rejects missing/malformed input %p",
    (input) => {
      expect(parseAttemptResultValue(input).ok).toBe(false);
    },
  );

  it.each(["abc", "12px", "12,5", "one"])(
    "rejects malformed string %p",
    (input) => {
      expect(parseAttemptResultValue(input).ok).toBe(false);
    },
  );

  it("rejects NaN", () => {
    expect(parseAttemptResultValue(NaN).ok).toBe(false);
  });

  it("rejects Infinity and -Infinity", () => {
    expect(parseAttemptResultValue(Infinity).ok).toBe(false);
    expect(parseAttemptResultValue(-Infinity).ok).toBe(false);
    expect(parseAttemptResultValue("Infinity").ok).toBe(false);
  });

  it("rejects values beyond the magnitude cap", () => {
    expect(parseAttemptResultValue(ATTEMPT_RESULT_ABS_LIMIT + 1).ok).toBe(false);
    expect(parseAttemptResultValue("1e309").ok).toBe(false);
  });

  it("accepts the magnitude cap boundary", () => {
    expect(parseAttemptResultValue(ATTEMPT_RESULT_ABS_LIMIT).ok).toBe(true);
  });
});

describe("COMP-004: meetsChallengeThreshold", () => {
  it("passes when result equals the threshold", () => {
    expect(meetsChallengeThreshold(30, 30)).toBe(true);
  });

  it("passes when result exceeds the threshold", () => {
    expect(meetsChallengeThreshold(31, 30)).toBe(true);
  });

  it("fails when result is below the threshold", () => {
    expect(meetsChallengeThreshold(29, 30)).toBe(false);
  });
});

describe("COMP-004: getNextAttemptNumber", () => {
  it("returns 1 for no attempts", () => {
    expect(getNextAttemptNumber([])).toBe(1);
  });

  it("increments sequentially", () => {
    expect(getNextAttemptNumber([attempt(1, 5, false)])).toBe(2);
    expect(
      getNextAttemptNumber([attempt(1, 5, false), attempt(2, 8, false)]),
    ).toBe(3);
  });

  it("uses the max attempt number (robust to unordered input)", () => {
    expect(
      getNextAttemptNumber([attempt(2, 5, false), attempt(1, 5, false)]),
    ).toBe(3);
  });
});

describe("COMP-004: computeParticipantChallengeState", () => {
  it("reports registered state with no attempts", () => {
    const s = computeParticipantChallengeState(PART, EV, []);
    expect(s.attemptsUsed).toBe(0);
    expect(s.attemptsRemaining).toBe(3);
    expect(s.bestResult).toBeNull();
    expect(s.passed).toBe(false);
    expect(s.challengeComplete).toBe(false);
    expect(s.canAttempt).toBe(true);
  });

  it("reports attempts used/remaining after one failed attempt", () => {
    const s = computeParticipantChallengeState(PART, EV, [attempt(1, 10, false)]);
    expect(s.attemptsUsed).toBe(1);
    expect(s.attemptsRemaining).toBe(2);
    expect(s.bestResult).toBe(10);
    expect(s.lastResult).toBe(10);
    expect(s.passed).toBe(false);
    expect(s.canAttempt).toBe(true);
  });

  it("computes the best result across attempts", () => {
    const s = computeParticipantChallengeState(PART, EV, [
      attempt(1, 10, false),
      attempt(2, 25, false),
      attempt(3, 20, false),
    ]);
    expect(s.bestResult).toBe(25);
    expect(s.lastResult).toBe(20);
  });

  it("marks qualified and completes the challenge on a passing attempt", () => {
    const s = computeParticipantChallengeState(PART, EV, [
      attempt(1, 10, false),
      attempt(2, 30, true),
    ]);
    expect(s.passed).toBe(true);
    expect(s.challengeComplete).toBe(true);
    expect(s.passedOnAttempt).toBe(2);
    expect(s.canAttempt).toBe(false);
  });

  it("records the FIRST passing attempt number", () => {
    const s = computeParticipantChallengeState(PART, EV, [
      attempt(1, 31, true),
      attempt(2, 40, true),
    ]);
    expect(s.passedOnAttempt).toBe(1);
  });

  it("closes the challenge after max_attempts without passing", () => {
    const s = computeParticipantChallengeState(PART, EV, [
      attempt(1, 1, false),
      attempt(2, 2, false),
      attempt(3, 3, false),
    ]);
    expect(s.attemptsRemaining).toBe(0);
    expect(s.canAttempt).toBe(false);
    expect(s.passed).toBe(false);
  });

  it("handles unsorted attempts by attempt number", () => {
    const s = computeParticipantChallengeState(PART, EV, [
      attempt(3, 3, false),
      attempt(1, 31, true),
    ]);
    expect(s.passedOnAttempt).toBe(1);
    expect(s.lastResult).toBe(3);
  });
});

describe("COMP-004: resolveParticipantStatus", () => {
  it("returns qualified when any attempt passed", () => {
    expect(
      resolveParticipantStatus("registered", [attempt(1, 30, true)], 3),
    ).toBe("qualified");
  });

  it("returns not_qualified when attempts are exhausted", () => {
    expect(
      resolveParticipantStatus(
        "challenge_pending",
        [attempt(1, 1, false), attempt(2, 2, false), attempt(3, 3, false)],
        3,
      ),
    ).toBe("not_qualified");
  });

  it("returns challenge_pending once an attempt exists but not exhausted", () => {
    expect(
      resolveParticipantStatus("registered", [attempt(1, 1, false)], 3),
    ).toBe("challenge_pending");
  });

  it("keeps registered when there are no attempts", () => {
    expect(resolveParticipantStatus("registered", [], 3)).toBe("registered");
  });

  it("qualified takes precedence over exhaustion", () => {
    expect(
      resolveParticipantStatus(
        "challenge_pending",
        [attempt(1, 30, true), attempt(2, 1, false), attempt(3, 1, false)],
        3,
      ),
    ).toBe("qualified");
  });
});

describe("COMP-004: getChallengeStateLabel", () => {
  it("labels qualified", () => {
    expect(
      getChallengeStateLabel({
        passed: true,
        challengeComplete: true,
        attemptsUsed: 2,
        attemptsRemaining: 1,
      }),
    ).toBe("Qualified");
  });

  it("labels not qualified when attempts are exhausted", () => {
    expect(
      getChallengeStateLabel({
        passed: false,
        challengeComplete: false,
        attemptsUsed: 3,
        attemptsRemaining: 0,
      }),
    ).toBe("Not Qualified");
  });

  it("labels attempting after a failed attempt", () => {
    expect(
      getChallengeStateLabel({
        passed: false,
        challengeComplete: false,
        attemptsUsed: 1,
        attemptsRemaining: 2,
      }),
    ).toBe("Attempting");
  });

  it("labels registered with no attempts", () => {
    expect(
      getChallengeStateLabel({
        passed: false,
        challengeComplete: false,
        attemptsUsed: 0,
        attemptsRemaining: 3,
      }),
    ).toBe("Registered");
  });
});