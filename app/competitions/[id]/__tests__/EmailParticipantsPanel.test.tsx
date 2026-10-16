// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { EmailParticipantsPanel } from "../EmailParticipantsPanel";
import type {
  CompetitionBulkEmailAudienceSummary,
  CompetitionBulkEmailBatchSummary,
} from "@/types/competition-bulk-email";

/**
 * T-BULK-1 — "Email Participants" UI.
 *
 * The panel talks to the API only, so these tests mock `fetch` and assert: the
 * recipient count, the server-rendered preview, the explicit confirmation step,
 * in-flight disabling, the recorded outcome summary (accepted / failed /
 * pending), safe retry of the remaining recipients and error surfacing.
 */

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PANEL_URL = `/api/competitions/${EVENT_A}/emails`;
const PREVIEW_URL = `${PANEL_URL}/preview`;
const BATCH_ID = "55555555-5555-4555-8555-555555555555";
const PROCESS_URL = `${PANEL_URL}/${BATCH_ID}/process`;

const fetchMock = vi.fn();

function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function audience(overrides: Record<string, unknown> = {}) {
  return {
    activeCount: 2,
    eligibleCount: 2,
    invalidCount: 0,
    duplicateCount: 0,
    ...overrides,
  };
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH_ID,
    eventId: EVENT_A,
    subject: "Arrival instructions",
    createdAt: "2026-05-01T08:00:00.000Z",
    audience: audience(),
    acceptedCount: 2,
    failedCount: 0,
    pendingCount: 0,
    state: "sent",
    ...overrides,
  };
}

interface Handlers {
  panel?: () => Response;
  preview?: () => Response;
  send?: () => Response;
  process?: () => Response;
}

/** Route fetch calls by URL. */
function mockFetch(handlers: Handlers = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === PANEL_URL && method === "GET") {
      return handlers.panel
        ? handlers.panel()
        : reply(200, { audience: audience(), batches: [] });
    }
    if (url === PREVIEW_URL) {
      return handlers.preview
        ? handlers.preview()
        : reply(200, {
            preview: {
              subject: "Arrival instructions",
              html: "<html><body>preview body</body></html>",
              text: "preview text",
              audience: audience(),
            },
          });
    }
    if (url === PANEL_URL && method === "POST") {
      return handlers.send ? handlers.send() : reply(201, { batch: batch() });
    }
    if (url === PROCESS_URL) {
      return handlers.process
        ? handlers.process()
        : reply(200, { batch: batch() });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
}

function sendRequests() {
  return fetchMock.mock.calls.filter(
    ([url, init]) => url === PANEL_URL && init?.method === "POST",
  );
}

async function renderPanel(
  initialAudience: CompetitionBulkEmailAudienceSummary = audience(),
  initialBatches: CompetitionBulkEmailBatchSummary[] = [],
) {
  render(
    <EmailParticipantsPanel
      eventId={EVENT_A}
      eventName="Sunday Cup"
      initialAudience={initialAudience}
      initialBatches={initialBatches}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getAllByText(/recipients will receive this email/).length,
    ).toBeGreaterThan(0),
  );
}

async function compose(subject = "Arrival instructions", message = "Arrive by 08:30.") {
  fireEvent.change(screen.getByLabelText(/subject/i), {
    target: { value: subject },
  });
  fireEvent.change(screen.getByLabelText(/message/i), {
    target: { value: message },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mockFetch();
});

describe("T-BULK-1: Email Participants panel", () => {
  it("shows the server-resolved recipient count on load", async () => {
    await renderPanel();

    expect(screen.getByText(/2 active registrations/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send to 2 recipients/i }),
    ).toBeInTheDocument();
  });

  it("reports skipped recipients without exposing any address", async () => {
    await renderPanel(
      audience({
        activeCount: 4,
        eligibleCount: 2,
        invalidCount: 1,
        duplicateCount: 1,
      }),
    );

    expect(
      screen.getByText(/1 skipped \(missing or invalid email address\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 skipped \(duplicate email address\)/),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("@example.com");
  });

  it("disables sending until a subject and message are entered", async () => {
    await renderPanel();

    expect(
      screen.getByRole("button", { name: /send to 2 recipients/i }),
    ).toBeDisabled();

    await compose();
    expect(
      screen.getByRole("button", { name: /send to 2 recipients/i }),
    ).toBeEnabled();
  });

  it("renders a server-built preview without sending anything", async () => {
    await renderPanel();
    await compose();

    fireEvent.click(screen.getByRole("button", { name: /preview email/i }));

    await waitFor(() =>
      expect(screen.getByTitle("Email preview")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Subject:/)).toBeInTheDocument();

    const previewCall = fetchMock.mock.calls.find(([url]) => url === PREVIEW_URL);
    expect(previewCall).toBeDefined();
    expect(JSON.parse(String(previewCall?.[1]?.body))).toEqual({
      subject: "Arrival instructions",
      message: "Arrive by 08:30.",
    });
    // A preview never queues a batch.
    expect(sendRequests()).toHaveLength(0);
  });

  it("requires an explicit confirmation before sending", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderPanel();
    await compose();

    fireEvent.click(
      screen.getByRole("button", { name: /send to 2 recipients/i }),
    );

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(sendRequests()).toHaveLength(0);
  });
});


describe("T-BULK-1: outcome reporting and safe retry", () => {
  it("sends only the subject, message and idempotency id, then shows the outcome", async () => {
    await renderPanel();
    await compose();

    fireEvent.click(
      screen.getByRole("button", { name: /send to 2 recipients/i }),
    );

    await waitFor(() =>
      expect(
        screen.getAllByText(/Accepted by the provider/).length,
      ).toBeGreaterThan(0),
    );

    const calls = sendRequests();
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0][1]?.body)) as Record<string, unknown>;
    // The browser can never supply a recipient list or a count.
    expect(Object.keys(body).sort()).toEqual(["message", "requestId", "subject"]);
    expect(String(body.requestId).length).toBeGreaterThan(0);

    expect(screen.getByText(/Eligible recipients: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Accepted by the provider: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Failed: 0/)).toBeInTheDocument();
    expect(screen.getByText(/Still pending: 0/)).toBeInTheDocument();
    expect(
      screen.getByText(/not a confirmation that it reached an inbox/i),
    ).toBeInTheDocument();
  });

  it("disables repeated submission while the request is in flight", async () => {
    const sendControl: { resolve?: (response: Response) => void } = {};
    const pendingSend = new Promise<Response>((resolve) => {
      sendControl.resolve = resolve;
    });

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === PANEL_URL && method === "GET") {
        return reply(200, { audience: audience(), batches: [] });
      }
      if (url === PANEL_URL) return pendingSend;
      return reply(200, { batch: batch() });
    });

    await renderPanel();
    await compose();

    const send = screen.getByRole("button", { name: /send to 2 recipients/i });
    fireEvent.click(send);
    fireEvent.click(send);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled(),
    );
    // The double click produced exactly ONE send request.
    expect(sendRequests()).toHaveLength(1);

    sendControl.resolve?.(
      reply(201, {
        batch: batch({
          state: "processing",
          acceptedCount: 0,
          failedCount: 0,
          pendingCount: 2,
        }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByText(/Accepted by the provider: 2/)).toBeInTheDocument(),
    );
  });

  it("reports a partial failure after draining the remainder", async () => {
    mockFetch({
      send: () =>
        reply(201, {
          batch: batch({
            state: "processing",
            acceptedCount: 1,
            failedCount: 0,
            pendingCount: 1,
          }),
        }),
      process: () =>
        reply(200, {
          batch: batch({
            state: "partial",
            acceptedCount: 1,
            failedCount: 1,
            pendingCount: 0,
          }),
        }),
    });
    await renderPanel();
    await compose();

    fireEvent.click(
      screen.getByRole("button", { name: /send to 2 recipients/i }),
    );

    await waitFor(() =>
      expect(screen.getAllByText(/Partially sent/).length).toBeGreaterThan(0),
    );
    expect(screen.getByText(/Accepted by the provider: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Failed: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Still pending: 0/)).toBeInTheDocument();
    // Nothing is pending, so no retry action is offered.
    expect(
      screen.queryByRole("button", { name: /send remaining/i }),
    ).not.toBeInTheDocument();
  });

  it("offers 'Send remaining' when recipients are still pending", async () => {
    mockFetch({
      send: () =>
        reply(201, {
          batch: batch({
            state: "processing",
            acceptedCount: 0,
            failedCount: 0,
            pendingCount: 1,
          }),
        }),
      process: () =>
        reply(200, {
          batch: batch({
            state: "processing",
            acceptedCount: 0,
            failedCount: 0,
            pendingCount: 1,
          }),
        }),
    });
    await renderPanel();
    await compose();

    fireEvent.click(
      screen.getByRole("button", { name: /send to 2 recipients/i }),
    );

    const retry = await screen.findByRole("button", {
      name: /send remaining \(1\)/i,
    });
    expect(screen.getAllByText(/Sending…/).length).toBeGreaterThan(0);

    const before = fetchMock.mock.calls.filter(([url]) => url === PROCESS_URL)
      .length;
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => url === PROCESS_URL).length,
      ).toBeGreaterThan(before),
    );
    // Retrying only ever drains the REMAINING pending recipients.
    expect(sendRequests()).toHaveLength(1);
  });

  it("surfaces a server error and never continues processing", async () => {
    mockFetch({
      send: () => reply(409, { error: "No active participants to email." }),
    });
    await renderPanel();
    await compose();

    fireEvent.click(
      screen.getByRole("button", { name: /send to 2 recipients/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("No active participants to email."),
      ).toBeInTheDocument(),
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => url === PROCESS_URL),
    ).toHaveLength(0);
  });
});

