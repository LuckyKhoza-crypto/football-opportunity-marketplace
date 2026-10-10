import { describe, it, expect } from "vitest";
import {
  COMPETITION_HOST_BAN_REASON,
  COMPETITION_HOST_REMOVAL_REASON,
  PARTICIPANT_REMOVAL_MESSAGES,
  getParticipantRemovalBlockReason,
} from "@/lib/competition-participant-admin";
import type { CompetitionWithdrawalState } from "@/lib/competition-join";

/**
 * T-REM-3 — pure host removal / ban policy.
 *
 * These assertions pin the SAME lifecycle rule T-REM-2 uses for a player
 * unregistering themselves, so a host can never remove (or ban-and-remove) a
 * participant in a state the player themselves could not withdraw from.
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

describe("T-REM-3: removal/ban reason constants", () => {
  it("uses distinct, durable host reason values", () => {
    expect(COMPETITION_HOST_REMOVAL_REASON).toBe("host_removal");
    expect(COMPETITION_HOST_BAN_REASON).toBe("host_ban");
    expect(COMPETITION_HOST_REMOVAL_REASON).not.toBe(COMPETITION_HOST_BAN_REASON);
  });
});

describe("T-REM-3: getParticipantRemovalBlockReason", () => {
  it("allows removal of an active, unstarted participant", () => {
    expect(getParticipantRemovalBlockReason(state())).toBeNull();
  });

  it("blocks a non-active event (registration window closed)", () => {
    for (const status of ["draft", "drawing", "completed", "cancelled"] as const) {
      expect(getParticipantRemovalBlockReason(state({ eventStatus: status }))).toBe(
        PARTICIPANT_REMOVAL_MESSAGES.eventNotActive,
      );
    }
  });

  it("blocks an already-removed participant", () => {
    expect(
      getParticipantRemovalBlockReason(state({ removedAt: "2026-01-01T00:00:00Z" })),
    ).toBe(PARTICIPANT_REMOVAL_MESSAGES.alreadyRemoved);
  });

  it("blocks a checked-in participant", () => {
    expect(
      getParticipantRemovalBlockReason(state({ checkedInAt: "2026-01-01T00:00:00Z" })),
    ).toBe(PARTICIPANT_REMOVAL_MESSAGES.checkedIn);
  });

  it("blocks a participant who has already attempted the challenge", () => {
    expect(getParticipantRemovalBlockReason(state({ hasAttempts: true }))).toBe(
      PARTICIPANT_REMOVAL_MESSAGES.hasAttempts,
    );
  });

  it("blocks a provider-synced participant (removal is not reversible)", () => {
    expect(getParticipantRemovalBlockReason(state({ providerMapped: true }))).toBe(
      PARTICIPANT_REMOVAL_MESSAGES.providerMapped,
    );
  });

  it("applies the lifecycle checks in the same order as withdrawal", () => {
    // An event that is not active is blocked before anything else, even if the
    // participant would also fail a later check.
    expect(
      getParticipantRemovalBlockReason(
        state({
          eventStatus: "completed",
          removedAt: "2026-01-01T00:00:00Z",
          hasAttempts: true,
        }),
      ),
    ).toBe(PARTICIPANT_REMOVAL_MESSAGES.eventNotActive);
    // Removed is checked before checked-in / attempts / provider.
    expect(
      getParticipantRemovalBlockReason(
        state({
          removedAt: "2026-01-01T00:00:00Z",
          checkedInAt: "2026-01-01T00:00:00Z",
        }),
      ),
    ).toBe(PARTICIPANT_REMOVAL_MESSAGES.alreadyRemoved);
  });

  it("never mentions a provider, id or ban-management internal in a message", () => {
    for (const message of Object.values(PARTICIPANT_REMOVAL_MESSAGES)) {
      expect(message).not.toMatch(/provider|challonge|uuid|ban_|competition_bans/i);
    }
  });
});
