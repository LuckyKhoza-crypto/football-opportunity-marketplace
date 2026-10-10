import { describe, it, expect } from "vitest";

import {
  COMPETITION_SELF_REMOVAL_REASON,
  getWithdrawalBlockReason,
  type CompetitionWithdrawalState,
} from "@/lib/competition-join";

/**
 * T-REM-2 — the pure withdrawal eligibility rule.
 *
 * This is the single rule shared by the player UI and the authoritative server
 * mutation, so it is tested in isolation here (no database, no HTTP).
 */

function state(
  overrides: Partial<CompetitionWithdrawalState> = {},
): CompetitionWithdrawalState {
  return {
    eventStatus: "active",
    removedAt: null,
    checkedInAt: null,
    hasAttempts: false,
    providerMapped: false,
    ...overrides,
  };
}

describe("T-REM-2: withdrawal eligibility rule", () => {
  it("allows an eligible registration (null block reason)", () => {
    expect(getWithdrawalBlockReason(state())).toBeNull();
  });

  it("treats a missing removed_at as active (allowed)", () => {
    expect(
      getWithdrawalBlockReason(state({ removedAt: undefined })),
    ).toBeNull();
  });

  it("blocks a checked-in participant and explains why", () => {
    const reason = getWithdrawalBlockReason(
      state({ checkedInAt: "2026-01-01T09:00:00.000Z" }),
    );
    expect(reason).toMatch(/checked in/i);
    expect(reason).toMatch(/can no longer unregister/i);
  });

  it("blocks a participant with recorded attempts", () => {
    expect(getWithdrawalBlockReason(state({ hasAttempts: true }))).toMatch(
      /challenge|attempt/i,
    );
  });

  it("blocks a provider-synced participant without naming the provider", () => {
    const reason = getWithdrawalBlockReason(state({ providerMapped: true }));
    expect(reason).toBeTruthy();
    expect(reason).not.toMatch(/challonge|provider|api|tournament id/i);
  });

  it("blocks an already-removed registration (repeat unregister)", () => {
    const reason = getWithdrawalBlockReason(
      state({ removedAt: "2026-01-01T09:00:00.000Z" }),
    );
    expect(reason).toMatch(/already unregistered/i);
  });

  it("rejects every non-active lifecycle state", () => {
    for (const eventStatus of [
      "draft",
      "drawing",
      "completed",
      "cancelled",
    ] as const) {
      const reason = getWithdrawalBlockReason(state({ eventStatus }));
      expect(reason).toBeTruthy();
      expect(reason).toMatch(/no longer accepting withdrawals/i);
    }
  });

  it("checks the event lifecycle before participant state", () => {
    // A completed event with a checked-in participant reports the event state.
    const reason = getWithdrawalBlockReason(
      state({
        eventStatus: "completed",
        checkedInAt: "2026-01-01T09:00:00.000Z",
      }),
    );
    expect(reason).toMatch(/no longer accepting withdrawals/i);
  });

  it("exposes a stable, explicit self-removal reason", () => {
    expect(COMPETITION_SELF_REMOVAL_REASON).toBe("self_unregistration");
  });
});
