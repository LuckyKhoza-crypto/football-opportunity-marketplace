// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { ParticipantManager } from "../ParticipantManager";
import type { CompetitionParticipantWithState } from "@/types/competition-attempt";

/**
 * T-REM-3 — Remove (R) / Ban (B) controls in the participant-management UI.
 *
 * The panel talks to the two API endpoints only, so these tests mock `fetch` and
 * assert: the confirmation step for BOTH actions, the explicit ban confirmation,
 * loading/success/error states, banned-state indicators and that the server's
 * error message is surfaced.
 */

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P1 = "p1111111-1111-4111-8111-111111111111";
const REMOVE_URL = `/api/competitions/${EVENT_A}/participants/${P1}`;
const BAN_URL = `/api/competitions/${EVENT_A}/participants/${P1}/ban`;

const fetchMock = vi.fn();

function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function participant(
  overrides: Partial<CompetitionParticipantWithState> = {},
): CompetitionParticipantWithState {
  return {
    id: P1,
    event_id: EVENT_A,
    status: "registered",
    checked_in_at: null,
    created_at: "2026-01-01T00:00:00Z",
    profile: { full_name: "Ada Lovelace" },
    verificationCode: "ABCD2345",
    removedAt: null,
    banned: false,
    providerMapped: false,
    attemptsUsed: 0,
    attemptsRemaining: 3,
    bestResult: null,
    lastResult: null,
    passed: false,
    challengeComplete: false,
    canAttempt: true,
    ...overrides,
  };
}

function renderManager(p: CompetitionParticipantWithState) {
  return render(
    <ParticipantManager
      eventId={EVENT_A}
      event={{
        id: EVENT_A,
        name: "Sunday Cup",
        challenge_name: "Juggle",
        challenge_threshold: 30,
        max_attempts: 3,
        status: "active",
      }}
      initialParticipants={[p]}
      verifiedParticipantId={null}
    />,
  );
}

/** Select the participant so the management panel appears. */
function selectParticipant() {
  fireEvent.click(screen.getByRole("button", { name: /ada lovelace/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("T-REM-3: ParticipantManager remove/ban", () => {
  it("reveals separate Remove and Ban actions and explains the difference", () => {
    renderManager(participant());
    selectParticipant();

    expect(screen.getByRole("button", { name: /^remove$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ban$/i })).toBeInTheDocument();
    // The explanation makes the two meanings explicit.
    expect(screen.getByText(/register again later/i)).toBeInTheDocument();
    expect(screen.getByText(/never register again/i)).toBeInTheDocument();
  });

  it("does not remove when the confirmation is dismissed", () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    renderManager(participant());
    selectParticipant();

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes on confirmation, shows success and flags the row as Removed", async () => {
    fetchMock.mockResolvedValue(
      reply(200, { success: true, participantId: P1, removedAt: "2026-02-01T00:00:00.000Z", banned: false }),
    );
    renderManager(participant());
    selectParticipant();

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        REMOVE_URL,
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(
      await screen.findByText(/ada lovelace was removed/i),
    ).toBeInTheDocument();
    // The list refreshes and the row now shows the Removed badge.
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.getByText("Removed")).toBeInTheDocument();
  });

  it("surfaces a server removal error (e.g. checked in)", async () => {
    fetchMock.mockResolvedValue(
      reply(409, {
        error: "This participant has already checked in and can no longer be removed.",
      }),
    );
    renderManager(participant());
    selectParticipant();

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    expect(
      await screen.findByText(/already checked in and can no longer be removed/i),
    ).toBeInTheDocument();
  });

  it("uses an explicit, permanence-warning confirmation for banning", async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        success: true,
        participantId: P1,
        banned: true,
        alreadyBanned: false,
        removed: true,
        removedAt: "2026-02-01T00:00:00.000Z",
        bannedAt: "2026-02-01T00:00:00.000Z",
      }),
    );
    renderManager(participant());
    selectParticipant();

    fireEvent.click(screen.getByRole("button", { name: /^ban$/i }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    const message = vi.mocked(window.confirm).mock.calls[0][0] as string;
    expect(message).toMatch(/permanent/i);
    expect(message).toMatch(/not a global account ban/i);
    // Flush the async state update triggered by the confirmed action.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("does not ban when the confirmation is dismissed", () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    renderManager(participant());
    selectParticipant();

    fireEvent.click(screen.getByRole("button", { name: /^ban$/i }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bans on confirmation and shows success", async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        success: true,
        participantId: P1,
        banned: true,
        alreadyBanned: false,
        removed: true,
        removedAt: "2026-02-01T00:00:00.000Z",
        bannedAt: "2026-02-01T00:00:00.000Z",
      }),
    );
    renderManager(participant());
    selectParticipant();

    fireEvent.click(screen.getByRole("button", { name: /^ban$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        BAN_URL,
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText(/was banned from this competition/i)).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server ban error (unsafe lifecycle state)", async () => {
    fetchMock.mockResolvedValue(
      reply(409, {
        error:
          "This participant has already been added to the external tournament and cannot be removed here.",
      }),
    );
    renderManager(participant());
    selectParticipant();

    fireEvent.click(screen.getByRole("button", { name: /^ban$/i }));

    expect(
      await screen.findByText(/already been added to the external tournament/i),
    ).toBeInTheDocument();
  });

  it("indicates a banned player and disables both actions", () => {
    renderManager(participant({ banned: true }));
    selectParticipant();

    expect(screen.getByText("Banned")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^remove$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^ban$/i })).toBeDisabled();
    // Ban-management state is shown only to the operator, never publicly.
    expect(
      screen.getByText(/already banned from this competition/i),
    ).toBeInTheDocument();
  });

  it("shows a busy/loading state while a ban request is in flight", async () => {
    let resolveFetch: ((r: Response) => void) | null = null;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve)),
    );
    renderManager(participant());
    selectParticipant();

    fireEvent.click(screen.getByRole("button", { name: /^ban$/i }));

    // While the request is in flight, both actions are disabled (busy).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^ban$/i })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: /^remove$/i })).toBeDisabled();

    // Resolving the request surfaces the success state.
    resolveFetch!(
      reply(200, {
        success: true,
        participantId: P1,
        banned: true,
        alreadyBanned: false,
        removed: true,
        removedAt: "2026-02-01T00:00:00.000Z",
        bannedAt: "2026-02-01T00:00:00.000Z",
      }),
    );
    expect(
      await screen.findByText(/was banned from this competition/i),
    ).toBeInTheDocument();
  });

  it("explains and disables the actions for an unsafe lifecycle state (attempted)", () => {
    renderManager(participant({ attemptsUsed: 1, attemptsRemaining: 2 }));
    selectParticipant();

    expect(
      screen.getByText(/already attempted the challenge and can no longer be removed/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^remove$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^ban$/i })).toBeDisabled();
  });

  it("lets a previously removed participant still be banned", () => {
    renderManager(participant({ removedAt: "2026-01-01T00:00:00.000Z" }));
    selectParticipant();

    expect(screen.getByRole("button", { name: /^remove$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^ban$/i })).toBeEnabled();
    expect(
      screen.getByText(/may still register again later, or you can ban them/i),
    ).toBeInTheDocument();
  });

  it("T-REM-4: counts only active participants and notes removed ones", () => {
    render(
      <ParticipantManager
        eventId={EVENT_A}
        event={{
          id: EVENT_A,
          name: "Sunday Cup",
          challenge_name: "Juggle",
          challenge_threshold: 30,
          max_attempts: 3,
          status: "active",
        }}
        initialParticipants={[
          participant(),
          participant({
            id: "p9999999-9999-4999-8999-999999999999",
            profile: { full_name: "Bea Removed" },
            removedAt: "2026-02-01T00:00:00.000Z",
            canAttempt: false,
          }),
        ]}
        verifiedParticipantId={null}
      />,
    );

    // Counts reflect CURRENT participation (the removed row is excluded) ...
    expect(screen.getByText("Participants (1)")).toBeInTheDocument();
    // ... but the removed row stays visible for audit/ban management.
    expect(screen.getByText(/1 removed/)).toBeInTheDocument();
  });
});

