import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

interface Query {
  table: string;
  columns: string | null;
  filters: Array<[string, unknown]>;
}

const h = vi.hoisted(() => ({
  selectQueues: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
  queries: [] as Query[],
  insertCalls: [] as Array<{ table: string; payload: unknown }>,
  insertResults: {} as Record<string, { data: unknown; error: unknown }>,
  deleteCalls: [] as Array<{ table: string; eq: [string, unknown] }>,
}));

interface Chain {
  eq: (column: string, value: unknown) => Chain;
  is: (column: string, value: unknown) => Chain;
  order: (column: string, options?: unknown) => Chain;
  limit: (count: number) => Chain;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  single: () => Promise<{ data: unknown; error: unknown }>;
  then: (resolve: (value: unknown) => unknown) => unknown;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: (columns?: string): Chain => {
        const queue = h.selectQueues[table];
        const result =
          queue && queue.length > 0
            ? queue.shift()!
            : { data: null, error: null };
        const entry: Query = { table, columns: columns ?? null, filters: [] };
        h.queries.push(entry);

        const chain: Chain = {
          eq: (column, value) => {
            entry.filters.push([column, value]);
            return chain;
          },
          is: (column, value) => {
            entry.filters.push([column, value]);
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => result,
          single: async () => result,
          then: (resolve) => resolve(result),
        };
        return chain;
      },
      insert: async (payload: unknown) => {
        h.insertCalls.push({ table, payload });
        return h.insertResults[table] ?? { data: null, error: null };
      },
      delete: () => ({
        eq: async (column: string, value: unknown) => {
          h.deleteCalls.push({ table, eq: [column, value] });
          return { data: null, error: null };
        },
      }),
    }),
  },
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

vi.mock("@/lib/competition-bulk-email-delivery", () => ({
  scheduleBulkEmailProcessing: vi.fn(),
  processBulkEmailBatchForEvent: vi.fn(),
}));

import {
  getCompetitionBulkEmailAudience,
  getCompetitionBulkEmailBatch,
  listCompetitionBulkEmailBatches,
  previewCompetitionBulkEmail,
  processCompetitionBulkEmailBatch,
  sendCompetitionBulkEmail,
} from "@/lib/competition-bulk-email-server";
import {
  processBulkEmailBatchForEvent,
  scheduleBulkEmailProcessing,
} from "@/lib/competition-bulk-email-delivery";
import type { CompetitionMutationResult } from "@/lib/competition-server";

/**
 * Narrow a discriminated mutation result to its refusal arm (type-safe) so the
 * HTTP status can be asserted.
 */
function expectFailure<T>(
  result: CompetitionMutationResult<T>,
): { ok: false; error: string; status: number } {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a refused result");
  return result;
}

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MANAGER = "11111111-1111-4111-8111-111111111111";
const AMBASSADOR = "22222222-2222-4222-8222-222222222222";
const UNRELATED = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const BATCH_ID = "55555555-5555-4555-8555-555555555555";
const ADDRESS_ONE = "one@example.com";
const ADDRESS_TWO = "two@example.com";

/** Queue the manager check (`competition_events` "id" select). */
function queueManager(isManager: boolean) {
  const queue = h.selectQueues.competition_events ?? [];
  queue.push({ data: isManager ? { id: EVENT_A } : null, error: null });
  h.selectQueues.competition_events = queue;
}

/** Queue the ambassador check (`competition_ambassadors` "id" select). */
function queueAmbassador(isAmbassador: boolean) {
  const queue = h.selectQueues.competition_ambassadors ?? [];
  queue.push({ data: isAmbassador ? { id: "ca-1" } : null, error: null });
  h.selectQueues.competition_ambassadors = queue;
}

/** Queue the full event row read (`select("*")`). */
function queueEventRow(data: unknown = { id: EVENT_A, name: "Sunday Cup" }) {
  const queue = h.selectQueues.competition_events ?? [];
  queue.push({ data, error: null });
  h.selectQueues.competition_events = queue;
}

/** Queue the participant/audience rows. */
function queueParticipantRows(rows: unknown[]) {
  const queue = h.selectQueues.competition_participants ?? [];
  queue.push({ data: rows, error: null });
  h.selectQueues.competition_participants = queue;
}

/** Queue a batch row lookup on `competition_bulk_emails`. */
function queueBatchLookup(data: unknown) {
  const queue = h.selectQueues.competition_bulk_emails ?? [];
  queue.push({ data, error: null });
  h.selectQueues.competition_bulk_emails = queue;
}

/** Queue the recipient status read used to build a summary. */
function queueRecipientStatuses(statuses: string[]) {
  const queue = h.selectQueues.competition_bulk_email_recipients ?? [];
  queue.push({ data: statuses.map((status) => ({ status })), error: null });
  h.selectQueues.competition_bulk_email_recipients = queue;
}

function audienceRow(overrides: Record<string, unknown> = {}) {
  return {
    profile_id: "p1",
    removed_at: null,
    profile: { email: ADDRESS_ONE, full_name: "Ada" },
    ...overrides,
  };
}

function batchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH_ID,
    event_id: EVENT_A,
    subject: "Arrival instructions",
    created_at: "2026-05-01T08:00:00.000Z",
    eligible_count: 1,
    invalid_count: 0,
    duplicate_count: 0,
    ...overrides,
  };
}

/** Authorize the caller as the event creator. */
function asManager() {
  queueManager(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueues = {};
  h.queries = [];
  h.insertCalls = [];
  h.insertResults = {};
  h.deleteCalls = [];
  process.env.BREVO_API_KEY = "test-key";
  process.env.BREVO_FROM_EMAIL = "no-reply@example.com";
  process.env.BREVO_FROM_NAME = "FOM Sports";
});

describe("T-BULK-1: audience retrieval", () => {
  it("resolves the audience from the DB for the creator: removed_at IS NULL", async () => {
    asManager();
    queueParticipantRows([
      audienceRow(),
      audienceRow({
        profile_id: "p2",
        profile: { email: ADDRESS_TWO, full_name: "Bo" },
      }),
    ]);

    const result = await getCompetitionBulkEmailAudience(EVENT_A, MANAGER);

    expect(result).toEqual({
      ok: true,
      data: {
        activeCount: 2,
        eligibleCount: 2,
        invalidCount: 0,
        duplicateCount: 0,
      },
    });

    const query = h.queries.find(
      (q) => q.table === "competition_participants",
    );
    // The authoritative active-participant rule plus the event scope.
    expect(query?.filters).toEqual([
      ["event_id", EVENT_A],
      ["removed_at", null],
    ]);
    // The existing profile relationship is the address source.
    expect(query?.columns).toContain("profiles");
    expect(query?.columns).toContain("email");
  });

  it("authorizes an assigned ambassador", async () => {
    queueManager(false);
    queueAmbassador(true);
    queueParticipantRows([audienceRow()]);

    const result = await getCompetitionBulkEmailAudience(EVENT_A, AMBASSADOR);
    expect(result.ok).toBe(true);
  });

  it("refuses an unrelated authenticated user without reading participants", async () => {
    queueManager(false);
    queueAmbassador(false);

    const result = await getCompetitionBulkEmailAudience(EVENT_A, UNRELATED);

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Not authorized"),
      status: 403,
    });
    expect(
      h.queries.some((q) => q.table === "competition_participants"),
    ).toBe(false);
  });

  it("requires an event and a profile", async () => {
    expect(
      expectFailure(await getCompetitionBulkEmailAudience("", MANAGER)).status,
    ).toBe(400);
    expect(
      expectFailure(await getCompetitionBulkEmailAudience(EVENT_A, "")).status,
    ).toBe(400);
  });

  it("never exposes recipient addresses", async () => {
    asManager();
    queueParticipantRows([
      audienceRow(),
      audienceRow({ profile_id: "p2", profile: { email: ADDRESS_TWO, full_name: null } }),
    ]);

    const result = await getCompetitionBulkEmailAudience(EVENT_A, MANAGER);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ADDRESS_ONE);
    expect(serialized).not.toContain(ADDRESS_TWO);
  });
});

describe("T-BULK-1: preview", () => {
  it("builds an escaped preview with the audience count and sends nothing", async () => {
    asManager();
    queueEventRow();
    queueParticipantRows([audienceRow()]);

    const result = await previewCompetitionBulkEmail({
      eventId: EVENT_A,
      actorProfileId: MANAGER,
      subject: "Arrival instructions",
      message: "Bring <b>boots</b> & water.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.subject).toBe("Arrival instructions");
    expect(result.data.audience.eligibleCount).toBe(1);
    expect(result.data.html).toContain("&lt;b&gt;boots&lt;/b&gt;");
    expect(result.data.html).not.toContain("<b>boots</b>");
    expect(result.data.html).toContain("Sunday Cup");
    expect(result.data.text).toContain("Bring <b>boots</b> & water.");
    // A preview has no side effects at all.
    expect(h.insertCalls).toHaveLength(0);
    expect(scheduleBulkEmailProcessing).not.toHaveBeenCalled();
    // No real recipient address is used or returned.
    expect(JSON.stringify(result)).not.toContain(ADDRESS_ONE);
  });

  it("rejects invalid input before any authorization or database work", async () => {
    const result = await previewCompetitionBulkEmail({
      eventId: EVENT_A,
      actorProfileId: MANAGER,
      subject: "",
      message: "hello",
    });

    expect(result.ok).toBe(false);
    expect(h.queries).toHaveLength(0);
  });

  it("refuses an unrelated authenticated user", async () => {
    queueManager(false);
    queueAmbassador(false);

    const result = await previewCompetitionBulkEmail({
      eventId: EVENT_A,
      actorProfileId: UNRELATED,
      subject: "Hi",
      message: "Hello",
    });

    expect(expectFailure(result).status).toBe(403);
    expect(
      h.queries.some((q) => q.table === "competition_participants"),
    ).toBe(false);
  });

  it("returns 404 when the competition does not exist", async () => {
    asManager();
    queueEventRow(null);

    const result = await previewCompetitionBulkEmail({
      eventId: EVENT_A,
      actorProfileId: MANAGER,
      subject: "Hi",
      message: "Hello",
    });

    expect(result).toEqual({
      ok: false,
      error: "Competition not found",
      status: 404,
    });
  });
});


describe("T-BULK-1: send / enqueue", () => {
  const compose = (overrides: Record<string, unknown> = {}) => ({
    eventId: EVENT_A,
    actorProfileId: MANAGER,
    subject: "Arrival instructions",
    message: "Please arrive by 08:30.",
    requestId: REQUEST_ID,
    ...overrides,
  });

  it("queues one recipient row per deliverable address and schedules delivery", async () => {
    asManager();
    queueEventRow();
    queueBatchLookup(null);
    queueParticipantRows([
      audienceRow(),
      audienceRow({
        profile_id: "p2",
        profile: { email: `  ${ADDRESS_TWO.toUpperCase()} `, full_name: "Bo" },
      }),
    ]);

    const result = await sendCompetitionBulkEmail(compose());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Nothing is reported as delivered: the batch starts fully pending.
    expect(result.data.audience).toEqual({
      activeCount: 2,
      eligibleCount: 2,
      invalidCount: 0,
      duplicateCount: 0,
    });
    expect(result.data.acceptedCount).toBe(0);
    expect(result.data.failedCount).toBe(0);
    expect(result.data.pendingCount).toBe(2);
    expect(result.data.state).toBe("processing");
    expect(result.data.subject).toBe("Arrival instructions");

    const batchInsert = h.insertCalls.find(
      (call) => call.table === "competition_bulk_emails",
    );
    expect(batchInsert?.payload).toMatchObject({
      event_id: EVENT_A,
      sent_by_profile_id: MANAGER,
      request_id: REQUEST_ID,
      subject: "Arrival instructions",
      body_text: "Please arrive by 08:30.",
      eligible_count: 2,
    });

    const recipientInsert = h.insertCalls.find(
      (call) => call.table === "competition_bulk_email_recipients",
    );
    const rows = recipientInsert?.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    // Addresses are normalized; one row (message) per address.
    expect(rows.map((row) => row.recipient_email)).toEqual([
      ADDRESS_ONE,
      ADDRESS_TWO,
    ]);
    expect(rows[0]).toMatchObject({
      profile_id: "p1",
      recipient_name: "Ada",
      status: "pending",
    });

    expect(scheduleBulkEmailProcessing).toHaveBeenCalledWith(result.data.id);
    // The response never carries an address.
    expect(JSON.stringify(result)).not.toContain(ADDRESS_ONE);
    expect(JSON.stringify(result)).not.toContain(ADDRESS_TWO);
  });

  it("authorizes an assigned ambassador as the sender", async () => {
    queueManager(false);
    queueAmbassador(true);
    queueEventRow();
    queueBatchLookup(null);
    queueParticipantRows([audienceRow()]);

    const result = await sendCompetitionBulkEmail(
      compose({ actorProfileId: AMBASSADOR }),
    );
    expect(result.ok).toBe(true);
  });

  it("sends nothing when authorization fails", async () => {
    queueManager(false);
    queueAmbassador(false);

    const result = await sendCompetitionBulkEmail(
      compose({ actorProfileId: UNRELATED }),
    );

    expect(expectFailure(result).status).toBe(403);
    expect(h.insertCalls).toHaveLength(0);
    expect(scheduleBulkEmailProcessing).not.toHaveBeenCalled();
  });

  it("sends nothing when validation fails", async () => {
    const missingSubject = await sendCompetitionBulkEmail(
      compose({ subject: "  " }),
    );
    const tooLong = await sendCompetitionBulkEmail(
      compose({ message: "m".repeat(5001) }),
    );
    const badRequestId = await sendCompetitionBulkEmail(
      compose({ requestId: "not-a-uuid" }),
    );
    const missingRequestId = await sendCompetitionBulkEmail(
      compose({ requestId: undefined }),
    );

    for (const result of [missingSubject, tooLong, badRequestId, missingRequestId]) {
      expect(expectFailure(result).status).toBe(400);
    }
    // Validation happens before anything is read or written.
    expect(h.queries).toHaveLength(0);
    expect(h.insertCalls).toHaveLength(0);
    expect(scheduleBulkEmailProcessing).not.toHaveBeenCalled();
  });

  it("refuses to queue when email is not configured", async () => {
    delete process.env.BREVO_API_KEY;
    asManager();
    queueEventRow();

    const result = await sendCompetitionBulkEmail(compose());

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("not configured"),
      status: 503,
    });
    expect(h.insertCalls).toHaveLength(0);
    expect(scheduleBulkEmailProcessing).not.toHaveBeenCalled();
  });

  it("returns 404 when the competition does not exist", async () => {
    asManager();
    queueEventRow(null);

    const result = await sendCompetitionBulkEmail(compose());
    expect(expectFailure(result).status).toBe(404);
    expect(h.insertCalls).toHaveLength(0);
  });

  it("excludes removed participants from the queued audience", async () => {
    asManager();
    queueEventRow();
    queueBatchLookup(null);
    queueParticipantRows([
      audienceRow(),
      audienceRow({
        profile_id: "removed",
        removed_at: "2026-01-01T00:00:00.000Z",
        profile: { email: "removed@example.com", full_name: "Gone" },
      }),
      audienceRow({ profile_id: "invalid", profile: { email: null, full_name: null } }),
      audienceRow({
        profile_id: "duplicate",
        profile: { email: ADDRESS_ONE.toUpperCase(), full_name: "Dup" },
      }),
    ]);

    const result = await sendCompetitionBulkEmail(compose());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.audience).toEqual({
      activeCount: 3,
      eligibleCount: 1,
      invalidCount: 1,
      duplicateCount: 1,
    });

    const rows = h.insertCalls.find(
      (call) => call.table === "competition_bulk_email_recipients",
    )?.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_email).toBe(ADDRESS_ONE);
  });
});

describe("T-BULK-1: idempotency, partial failure and batch reads", () => {
  const compose = (overrides: Record<string, unknown> = {}) => ({
    eventId: EVENT_A,
    actorProfileId: MANAGER,
    subject: "Arrival instructions",
    message: "Please arrive by 08:30.",
    requestId: REQUEST_ID,
    ...overrides,
  });

  it("returns the existing batch for a repeated request id without sending again", async () => {
    asManager();
    queueEventRow();
    queueBatchLookup(batchRow());
    queueRecipientStatuses(["sent", "sent"]);

    const result = await sendCompetitionBulkEmail(compose());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe(BATCH_ID);
    expect(result.data.acceptedCount).toBe(2);
    expect(result.data.pendingCount).toBe(0);
    expect(result.data.state).toBe("sent");

    // No second batch, no second audience read, no duplicate send.
    expect(
      h.insertCalls.filter((call) => call.table === "competition_bulk_emails"),
    ).toHaveLength(0);
    expect(scheduleBulkEmailProcessing).not.toHaveBeenCalled();
    expect(
      h.queries.some((q) => q.table === "competition_participants"),
    ).toBe(false);
  });

  it("treats a concurrent duplicate insert as the winning batch", async () => {
    asManager();
    queueEventRow();
    queueBatchLookup(null);
    queueParticipantRows([audienceRow()]);
    h.insertResults.competition_bulk_emails = {
      data: null,
      error: { code: "23505" },
    };
    queueBatchLookup(batchRow());
    queueRecipientStatuses(["pending"]);

    const result = await sendCompetitionBulkEmail(compose());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe(BATCH_ID);
    expect(scheduleBulkEmailProcessing).not.toHaveBeenCalled();
  });

  it("rolls the batch back when its recipients cannot be stored", async () => {
    asManager();
    queueEventRow();
    queueBatchLookup(null);
    queueParticipantRows([audienceRow()]);
    h.insertResults.competition_bulk_email_recipients = {
      data: null,
      error: { code: "23503" },
    };

    const result = await sendCompetitionBulkEmail(compose());

    expect(result).toEqual({
      ok: false,
      error: "Failed to queue the message",
      status: 500,
    });
    // A batch that could not be fully enqueued must not survive.
    expect(h.deleteCalls[0]?.table).toBe("competition_bulk_emails");
    expect(h.deleteCalls[0]?.eq[0]).toBe("id");
    expect(scheduleBulkEmailProcessing).not.toHaveBeenCalled();
  });

  it("reports an empty audience honestly and sends nothing", async () => {
    asManager();
    queueEventRow();
    queueBatchLookup(null);
    queueParticipantRows([]);

    const result = await sendCompetitionBulkEmail(compose());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.audience.eligibleCount).toBe(0);
    expect(result.data.state).toBe("empty");
    expect(
      h.insertCalls.some(
        (call) => call.table === "competition_bulk_email_recipients",
      ),
    ).toBe(false);
    expect(scheduleBulkEmailProcessing).not.toHaveBeenCalled();
  });
});


describe("T-BULK-1: batch reads", () => {
  it("reads one batch's recorded outcomes for an authorized manager", async () => {
    asManager();
    queueBatchLookup(batchRow({ eligible_count: 3 }));
    queueRecipientStatuses(["sent", "failed", "pending"]);

    const result = await getCompetitionBulkEmailBatch(EVENT_A, BATCH_ID, MANAGER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      id: BATCH_ID,
      acceptedCount: 1,
      failedCount: 1,
      pendingCount: 1,
      state: "processing",
    });
    // The batch must be bound to the event in the route.
    const query = h.queries.find((q) => q.table === "competition_bulk_emails");
    expect(query?.filters).toEqual([
      ["id", BATCH_ID],
      ["event_id", EVENT_A],
    ]);
    // Only the status column is read for the outcome counts.
    const statusQuery = h.queries.find(
      (q) => q.table === "competition_bulk_email_recipients",
    );
    expect(statusQuery?.columns).toBe("status");
  });

  it("refuses an unauthorized read and 404s for a foreign or missing batch", async () => {
    queueManager(false);
    queueAmbassador(false);
    const denied = await getCompetitionBulkEmailBatch(
      EVENT_A,
      BATCH_ID,
      UNRELATED,
    );
    expect(expectFailure(denied).status).toBe(403);

    asManager();
    queueBatchLookup(null);
    const missing = await getCompetitionBulkEmailBatch(
      EVENT_A,
      BATCH_ID,
      MANAGER,
    );
    expect(missing).toEqual({
      ok: false,
      error: "Message batch not found",
      status: 404,
    });
  });

  it("lists recent batch summaries without bodies or addresses", async () => {
    asManager();
    h.selectQueues.competition_bulk_emails = [
      {
        data: [batchRow(), batchRow({ id: "other-batch", subject: "Kickoff" })],
        error: null,
      },
    ];
    h.selectQueues.competition_bulk_email_recipients = [
      { data: [{ status: "sent" }], error: null },
      { data: [{ status: "failed" }], error: null },
    ];

    const result = await listCompetitionBulkEmailBatches(EVENT_A, MANAGER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((batch) => batch.subject)).toEqual([
      "Arrival instructions",
      "Kickoff",
    ]);
    expect(result.data[1].state).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("Please arrive");
    const query = h.queries.find((q) => q.table === "competition_bulk_emails");
    expect(query?.filters).toEqual([["event_id", EVENT_A]]);
  });

  it("refuses an unauthorized batch list", async () => {
    queueManager(false);
    queueAmbassador(false);
    const result = await listCompetitionBulkEmailBatches(EVENT_A, UNRELATED);
    expect(expectFailure(result).status).toBe(403);
  });
});

describe("T-BULK-1: draining remaining recipients", () => {
  it("authorizes, binds the batch to the event, then returns the summary", async () => {
    asManager();
    // Authorization is re-checked again when the outcome summary is read.
    asManager();
    vi.mocked(processBulkEmailBatchForEvent).mockResolvedValue({
      claimed: 2,
      sent: 2,
      failed: 0,
      retried: 0,
    });
    queueBatchLookup(batchRow());
    queueRecipientStatuses(["sent", "sent"]);

    const result = await processCompetitionBulkEmailBatch(
      EVENT_A,
      BATCH_ID,
      MANAGER,
    );

    expect(processBulkEmailBatchForEvent).toHaveBeenCalledWith(EVENT_A, BATCH_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.acceptedCount).toBe(2);
  });

  it("refuses an unauthorized caller without draining", async () => {
    queueManager(false);
    queueAmbassador(false);

    const result = await processCompetitionBulkEmailBatch(
      EVENT_A,
      BATCH_ID,
      UNRELATED,
    );

    expect(expectFailure(result).status).toBe(403);
    expect(processBulkEmailBatchForEvent).not.toHaveBeenCalled();
  });

  it("returns 404 when the batch does not belong to the competition", async () => {
    asManager();
    vi.mocked(processBulkEmailBatchForEvent).mockResolvedValue(null);

    const result = await processCompetitionBulkEmailBatch(
      EVENT_B,
      BATCH_ID,
      MANAGER,
    );

    expect(result).toEqual({
      ok: false,
      error: "Message batch not found",
      status: 404,
    });
  });

  it("requires the event, batch and profile ids", async () => {
    expect(
      expectFailure(
        await processCompetitionBulkEmailBatch(EVENT_A, "", MANAGER),
      ).status,
    ).toBe(400);
  });
});

