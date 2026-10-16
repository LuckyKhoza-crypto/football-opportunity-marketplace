import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const sessionState = vi.hoisted(() => ({
  profileId: null as string | null,
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () =>
    sessionState.profileId ? { user: { id: sessionState.profileId } } : null,
  ),
}));

vi.mock("@/lib/competition-bulk-email-server", () => ({
  getCompetitionBulkEmailAudience: vi.fn(),
  listCompetitionBulkEmailBatches: vi.fn(),
  previewCompetitionBulkEmail: vi.fn(),
  sendCompetitionBulkEmail: vi.fn(),
  getCompetitionBulkEmailBatch: vi.fn(),
  processCompetitionBulkEmailBatch: vi.fn(),
}));

import {
  getBulkEmailBatchHandler,
  getBulkEmailPanelHandler,
  previewBulkEmailHandler,
  processBulkEmailBatchHandler,
  sendBulkEmailHandler,
} from "@/lib/competition-bulk-email-api";
import {
  getCompetitionBulkEmailAudience,
  getCompetitionBulkEmailBatch,
  listCompetitionBulkEmailBatches,
  previewCompetitionBulkEmail,
  processCompetitionBulkEmailBatch,
  sendCompetitionBulkEmail,
} from "@/lib/competition-bulk-email-server";

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "11111111-1111-4111-8111-111111111111";
const INTRUDER = "33333333-3333-4333-8333-333333333333";
const BATCH_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";

const EMPTY_AUDIENCE = {
  activeCount: 0,
  eligibleCount: 0,
  invalidCount: 0,
  duplicateCount: 0,
};

function request(body?: unknown): Request {
  return {
    json: async () => body ?? {},
  } as unknown as Request;
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionState.profileId = MANAGER;
  vi.mocked(getCompetitionBulkEmailAudience).mockResolvedValue({
    ok: true,
    data: EMPTY_AUDIENCE,
  });
  vi.mocked(listCompetitionBulkEmailBatches).mockResolvedValue({
    ok: true,
    data: [],
  });
});

describe("T-BULK-1: bulk email route handlers", () => {
  it("rejects unauthenticated requests on every handler without doing work", async () => {
    sessionState.profileId = null;

    const responses = [
      await getBulkEmailPanelHandler(request(), EVENT_A),
      await previewBulkEmailHandler(request({ subject: "s", message: "m" }), EVENT_A),
      await sendBulkEmailHandler(
        request({ subject: "s", message: "m", requestId: REQUEST_ID }),
        EVENT_A,
      ),
      await getBulkEmailBatchHandler(request(), EVENT_A, BATCH_ID),
      await processBulkEmailBatchHandler(request(), EVENT_A, BATCH_ID),
    ];

    for (const response of responses) {
      expect(response.status).toBe(401);
    }
    expect(getCompetitionBulkEmailAudience).not.toHaveBeenCalled();
    expect(previewCompetitionBulkEmail).not.toHaveBeenCalled();
    expect(sendCompetitionBulkEmail).not.toHaveBeenCalled();
    expect(processCompetitionBulkEmailBatch).not.toHaveBeenCalled();
  });

  it("returns the audience count and recent batches for the panel", async () => {
    vi.mocked(getCompetitionBulkEmailAudience).mockResolvedValue({
      ok: true,
      data: { ...EMPTY_AUDIENCE, activeCount: 4, eligibleCount: 3, invalidCount: 1 },
    });
    vi.mocked(listCompetitionBulkEmailBatches).mockResolvedValue({
      ok: true,
      data: [
        {
          id: BATCH_ID,
          eventId: EVENT_A,
          subject: "Arrival instructions",
          createdAt: "2026-05-01T08:00:00.000Z",
          audience: { ...EMPTY_AUDIENCE, eligibleCount: 3 },
          acceptedCount: 2,
          failedCount: 0,
          pendingCount: 1,
          state: "processing",
        },
      ],
    });

    const response = await getBulkEmailPanelHandler(request(), EVENT_A);
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.audience).toEqual({
      activeCount: 4,
      eligibleCount: 3,
      invalidCount: 1,
      duplicateCount: 0,
    });
    // No address can appear anywhere in a panel response.
    expect(JSON.stringify(body)).not.toContain("@");
  });

  it("maps an unauthorized panel request to 403", async () => {
    sessionState.profileId = INTRUDER;
    vi.mocked(getCompetitionBulkEmailAudience).mockResolvedValue({
      ok: false,
      error: "Not authorized to email participants of this competition",
      status: 403,
    });

    const response = await getBulkEmailPanelHandler(request(), EVENT_A);
    expect(response.status).toBe(403);
  });

  it("returns the server-rendered preview and passes only subject/message", async () => {
    vi.mocked(previewCompetitionBulkEmail).mockResolvedValue({
      ok: true,
      data: {
        subject: "Arrival instructions",
        html: "<html>ok</html>",
        text: "ok",
        audience: EMPTY_AUDIENCE,
      },
    });

    const response = await previewBulkEmailHandler(
      request({ subject: " Arrival instructions ", message: "hello" }),
      EVENT_A,
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.preview).toMatchObject({ subject: "Arrival instructions" });
    expect(previewCompetitionBulkEmail).toHaveBeenCalledWith({
      eventId: EVENT_A,
      actorProfileId: MANAGER,
      subject: " Arrival instructions ",
      message: "hello",
    });
  });

  it("surfaces a preview validation error as 400", async () => {
    vi.mocked(previewCompetitionBulkEmail).mockResolvedValue({
      ok: false,
      error: "A subject is required.",
      status: 400,
    });

    const response = await previewBulkEmailHandler(
      request({ subject: "", message: "m" }),
      EVENT_A,
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error).toBe("A subject is required.");
  });

  it("queues a send with the session identity and the idempotency id", async () => {
    vi.mocked(sendCompetitionBulkEmail).mockResolvedValue({
      ok: true,
      data: {
        id: BATCH_ID,
        eventId: EVENT_A,
        subject: "Arrival instructions",
        createdAt: "2026-05-01T08:00:00.000Z",
        audience: { ...EMPTY_AUDIENCE, eligibleCount: 2 },
        acceptedCount: 0,
        failedCount: 0,
        pendingCount: 2,
        state: "processing",
      },
    });

    const response = await sendBulkEmailHandler(
      request({
        subject: "Arrival instructions",
        message: "Please arrive by 08:30.",
        requestId: REQUEST_ID,
        // These must be ignored: the actor and the audience are server-derived.
        actorProfileId: INTRUDER,
        profileId: INTRUDER,
        recipients: ["not-allowed@example.com"],
      }),
      EVENT_A,
    );
    const body = await json(response);

    expect(response.status).toBe(201);
    expect(sendCompetitionBulkEmail).toHaveBeenCalledWith({
      eventId: EVENT_A,
      actorProfileId: MANAGER,
      subject: "Arrival instructions",
      message: "Please arrive by 08:30.",
      requestId: REQUEST_ID,
    });
    expect(JSON.stringify(body)).not.toContain("not-allowed@example.com");
  });

  it("does not report a send when validation or authorization fails", async () => {
    vi.mocked(sendCompetitionBulkEmail).mockResolvedValue({
      ok: false,
      error: "A valid request id is required to send this message.",
      status: 400,
    });
    const invalid = await sendBulkEmailHandler(request({}), EVENT_A);
    expect(invalid.status).toBe(400);

    sessionState.profileId = INTRUDER;
    vi.mocked(sendCompetitionBulkEmail).mockResolvedValue({
      ok: false,
      error: "Not authorized to email participants of this competition",
      status: 403,
    });
    const denied = await sendBulkEmailHandler(
      request({ subject: "s", message: "m", requestId: REQUEST_ID }),
      EVENT_A,
    );
    expect(denied.status).toBe(403);
  });

  it("returns one batch summary and maps a missing batch to 404", async () => {
    vi.mocked(getCompetitionBulkEmailBatch).mockResolvedValue({
      ok: true,
      data: {
        id: BATCH_ID,
        eventId: EVENT_A,
        subject: "Arrival instructions",
        createdAt: "2026-05-01T08:00:00.000Z",
        audience: { ...EMPTY_AUDIENCE, eligibleCount: 2 },
        acceptedCount: 2,
        failedCount: 0,
        pendingCount: 0,
        state: "sent",
      },
    });

    const response = await getBulkEmailBatchHandler(request(), EVENT_A, BATCH_ID);
    expect(response.status).toBe(200);
    expect((await json(response)).batch).toMatchObject({ state: "sent" });
    expect(getCompetitionBulkEmailBatch).toHaveBeenCalledWith(
      EVENT_A,
      BATCH_ID,
      MANAGER,
    );

    vi.mocked(getCompetitionBulkEmailBatch).mockResolvedValue({
      ok: false,
      error: "Message batch not found",
      status: 404,
    });
    const missing = await getBulkEmailBatchHandler(request(), EVENT_A, BATCH_ID);
    expect(missing.status).toBe(404);
  });

  it("drains the remaining recipients for an authorized manager", async () => {
    vi.mocked(processCompetitionBulkEmailBatch).mockResolvedValue({
      ok: true,
      data: {
        id: BATCH_ID,
        eventId: EVENT_A,
        subject: "Arrival instructions",
        createdAt: "2026-05-01T08:00:00.000Z",
        audience: { ...EMPTY_AUDIENCE, eligibleCount: 2 },
        acceptedCount: 1,
        failedCount: 1,
        pendingCount: 0,
        state: "partial",
      },
    });

    const response = await processBulkEmailBatchHandler(
      request(),
      EVENT_A,
      BATCH_ID,
    );
    expect(response.status).toBe(200);
    expect((await json(response)).batch).toMatchObject({
      acceptedCount: 1,
      failedCount: 1,
      state: "partial",
    });
    expect(processCompetitionBulkEmailBatch).toHaveBeenCalledWith(
      EVENT_A,
      BATCH_ID,
      MANAGER,
    );
  });

  it("maps an unauthorized drain to 403 and an unexpected failure to 500", async () => {
    vi.mocked(processCompetitionBulkEmailBatch).mockResolvedValue({
      ok: false,
      error: "Not authorized to send this message batch",
      status: 403,
    });
    const denied = await processBulkEmailBatchHandler(request(), EVENT_A, BATCH_ID);
    expect(denied.status).toBe(403);

    vi.mocked(processCompetitionBulkEmailBatch).mockRejectedValue(
      new Error("boom"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await processBulkEmailBatchHandler(request(), EVENT_A, BATCH_ID);
    expect(failed.status).toBe(500);
    errorSpy.mockRestore();
  });
});

