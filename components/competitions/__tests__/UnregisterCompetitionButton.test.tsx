// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { UnregisterCompetitionButton } from "../UnregisterCompetitionButton";

/**
 * T-REM-2 — the player-facing unregister action (shared by the competition pass
 * and the participant entry page).
 *
 * The component is presentational + input collection: confirmation, loading,
 * success and server-error handling. The server response is authoritative.
 */

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WITHDRAW_URL = `/api/competitions/${EVENT_A}/withdraw`;

const fetchMock = vi.fn();

function reply({ status = 200, body = {} }: { status?: number; body?: unknown }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderButton(overrides: {
  canWithdraw?: boolean;
  blockedReason?: string | null;
} = {}) {
  return render(
    <UnregisterCompetitionButton
      eventId={EVENT_A}
      canWithdraw={overrides.canWithdraw ?? true}
      blockedReason={overrides.blockedReason ?? null}
    />,
  );
}

describe("T-REM-2: UnregisterCompetitionButton", () => {
  it("shows the action when withdrawal is allowed", () => {
    renderButton();
    expect(
      screen.getByRole("button", { name: /unregister/i }),
    ).toBeInTheDocument();
  });

  it("requires confirmation before sending any request", () => {
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /unregister/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /yes, unregister/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("cancelling the confirmation sends no request", () => {
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /unregister/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /unregister/i }),
    ).toBeInTheDocument();
  });

  it("posts to the withdraw endpoint (no body) and shows success", async () => {
    fetchMock.mockResolvedValue(
      reply({ status: 200, body: { success: true, eventId: EVENT_A } }),
    );

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /unregister/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, unregister/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(WITHDRAW_URL, { method: "POST" });
    });

    expect(
      await screen.findByText(/you've unregistered from this competition/i),
    ).toBeInTheDocument();
    // The action is replaced by the success state.
    expect(
      screen.queryByRole("button", { name: /unregister/i }),
    ).toBeNull();
  });

  it("shows a loading state while the request is in flight", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /unregister/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, unregister/i }));

    const loading = await screen.findByRole("button", {
      name: /unregistering/i,
    });
    expect(loading).toBeDisabled();

    resolveFetch(reply({ status: 200, body: { success: true } }));
    expect(
      await screen.findByText(/you've unregistered from this competition/i),
    ).toBeInTheDocument();
  });

  it("surfaces a server rejection without claiming success", async () => {
    fetchMock.mockResolvedValue(
      reply({
        status: 409,
        body: {
          error: "You have already checked in and can no longer unregister.",
        },
      }),
    );

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /unregister/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, unregister/i }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(/already checked in/i);
    expect(
      screen.queryByText(/you've unregistered from this competition/i),
    ).toBeNull();
    // The confirmation stays open so the player can retry / cancel.
    expect(
      screen.getByRole("button", { name: /yes, unregister/i }),
    ).toBeInTheDocument();
  });

  it("explains why unregistering is not allowed (e.g. checked in)", () => {
    renderButton({
      canWithdraw: false,
      blockedReason:
        "You have already checked in and can no longer unregister.",
    });

    expect(
      screen.queryByRole("button", { name: /unregister/i }),
    ).toBeNull();
    expect(
      screen.getByText(/already checked in and can no longer unregister/i),
    ).toBeInTheDocument();
  });

  it("renders nothing when there is nothing to show", () => {
    const { container } = renderButton({
      canWithdraw: false,
      blockedReason: null,
    });
    expect(container).toBeEmptyDOMElement();
  });
});
