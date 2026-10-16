import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Capture Next.js `after()` callbacks so the scheduled trigger is testable.
const afterState = vi.hoisted(() => ({
  callbacks: [] as Array<() => unknown>,
  shouldThrow: false,
}));

vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    if (afterState.shouldThrow) throw new Error("after() outside request scope");
    afterState.callbacks.push(cb);
  },
}));

const h = vi.hoisted(() => ({
  selectResults: {} as Record<string, { data: unknown; error: unknown }>,
  rpcQueue: [] as Array<{ data: unknown; error: unknown }>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  updates: [] as Array<{
    table: string;
    payload: Record<string, unknown>;
    eq: [string, unknown];
  }>,
}));

interface SelectChain {
  eq: (column: string, value: unknown) => SelectChain;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: (): SelectChain => {
        const chain: SelectChain = {
          eq: () => chain,
          maybeSingle: async () =>
            h.selectResults[table] ?? { data: null, error: null },
        };
        return chain;
      },
      update: (payload: Record<string, unknown>) => ({
        eq: async (column: string, value: unknown) => {
          h.updates.push({ table, payload, eq: [column, value] });
          return { data: null, error: null };
        },
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args });
      if (h.rpcQueue.length > 0) return h.rpcQueue.shift()!;
      return { data: [], error: null };
    },
  },
}));

import {
  BULK_EMAIL_MAX_ATTEMPTS,
  BULK_EMAIL_PROCESS_LIMIT,
  isRetryableBulkEmailError,
  processBulkEmailBatch,
  processBulkEmailBatchForEvent,
  scheduleBulkEmailProcessing,
} from "@/lib/competition-bulk-email-delivery";
import {
  EmailConfigError,
  EmailProviderError,
  EmailProviderRequestError,
  EmailRecipientError,
} from "@/lib/email/errors";
import type { TransactionalEmail } from "@/lib/email/types";

const BATCH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADDRESS = "player@example.com";

function recipientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "recipient-1",
    recipient_email: ADDRESS,
    recipient_name: "Ada",
    attempts: 1,
    ...overrides,
  };
}

function claim(result: { data: unknown; error: unknown }) {
  h.rpcQueue.push(result);
}

beforeEach(() => {
  vi.clearAllMocks();
  afterState.callbacks = [];
  afterState.shouldThrow = false;
  h.rpcQueue = [];
  h.rpcCalls = [];
  h.updates = [];
  h.selectResults = {
    competition_bulk_emails: {
      data: {
        id: BATCH_ID,
        event_id: EVENT_A,
        subject: "Arrival instructions",
        body_text: "Please arrive by 08:30.",
      },
      error: null,
    },
    competition_events: {
      data: {
        name: "Sunday Cup",
        event_date: "2026-05-01T09:00:00.000Z",
        location: "Riverside",
        challenge_name: "Juggle",
      },
      error: null,
    },
  };
});

describe("T-BULK-1: bulk email processor", () => {
  it("sends ONE individual message per recipient and records each acceptance", async () => {
    claim({ data: [recipientRow()], error: null });
    claim({
      data: [recipientRow({ id: "recipient-2", recipient_email: "two@example.com", recipient_name: null })],
      error: null,
    });

    const sent: TransactionalEmail[] = [];
    const sender = vi.fn(async (email: TransactionalEmail) => {
      sent.push(email);
      return { messageId: `brevo-${sent.length}` };
    });

    const result = await processBulkEmailBatch(BATCH_ID, {
      sender,
      now: () => new Date("2026-05-01T08:00:00.000Z"),
    });

    expect(result).toEqual({ claimed: 2, sent: 2, failed: 0, retried: 0 });
    expect(sent).toHaveLength(2);
    // One recipient per message — never a visible recipient list.
    expect(sent[0].to.email).toBe(ADDRESS);
    expect(sent[1].to.email).toBe("two@example.com");
    expect(sent[0].html).not.toContain("two@example.com");
    expect(sent[0].html).toContain("Sunday Cup");
    expect(sent[0].subject).toBe("Arrival instructions");

    const sentUpdates = h.updates.filter((u) => u.payload.status === "sent");
    expect(sentUpdates).toHaveLength(2);
    expect(sentUpdates[0].eq).toEqual(["id", "recipient-1"]);
    expect(sentUpdates[0].payload.provider_message_id).toBe("brevo-1");
  });

  it("bounds the number of sends per invocation", async () => {
    for (let i = 0; i < 5; i += 1) {
      claim({
        data: [recipientRow({ id: `recipient-${i}`, recipient_email: `p${i}@example.com` })],
        error: null,
      });
    }

    const sender = vi.fn(async () => ({ messageId: "m" }));
    const result = await processBulkEmailBatch(BATCH_ID, { sender, limit: 2 });

    expect(result.claimed).toBe(2);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(BULK_EMAIL_PROCESS_LIMIT).toBeGreaterThan(0);
  });

  it("sends nothing when the claim finds no eligible recipient", async () => {
    const sender = vi.fn(async () => ({ messageId: "m" }));
    const result = await processBulkEmailBatch(BATCH_ID, { sender });

    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0, retried: 0 });
    expect(sender).not.toHaveBeenCalled();
  });

  it("does not send twice when processing the same batch again", async () => {
    claim({ data: [recipientRow()], error: null });
    const sender = vi.fn(async () => ({ messageId: "m" }));

    await processBulkEmailBatch(BATCH_ID, { sender });
    // The atomic claim returns nothing once the row is no longer pending.
    await processBulkEmailBatch(BATCH_ID, { sender });

    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("passes the batch id and bounded attempt/stale window to the claim RPC", async () => {
    await processBulkEmailBatch(BATCH_ID, { sender: vi.fn(), limit: 1 });

    expect(h.rpcCalls[0].name).toBe("claim_next_bulk_email_recipient");
    expect(h.rpcCalls[0].args).toEqual({
      p_batch_id: BATCH_ID,
      p_stale_seconds: 300,
      p_max_attempts: BULK_EMAIL_MAX_ATTEMPTS,
    });
  });

  it("sends nothing when the batch no longer exists", async () => {
    h.selectResults.competition_bulk_emails = { data: null, error: null };
    const sender = vi.fn(async () => ({ messageId: "m" }));

    const result = await processBulkEmailBatch(BATCH_ID, { sender });

    expect(result.claimed).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });
});

describe("T-BULK-1: provider failures, retries and rate limits", () => {
  it("classifies retryable vs permanent provider errors", () => {
    expect(isRetryableBulkEmailError(new EmailRecipientError())).toBe(false);
    expect(isRetryableBulkEmailError(new EmailProviderRequestError())).toBe(true);
    expect(
      isRetryableBulkEmailError(new EmailProviderError("rate limited", { status: 429 })),
    ).toBe(true);
    expect(
      isRetryableBulkEmailError(new EmailProviderError("server error", { status: 503 })),
    ).toBe(true);
    expect(
      isRetryableBulkEmailError(new EmailProviderError("bad request", { status: 400 })),
    ).toBe(false);
    expect(
      isRetryableBulkEmailError(new EmailConfigError(["BREVO_API_KEY"])),
    ).toBe(true);
    expect(isRetryableBulkEmailError(new Error("boom"))).toBe(true);
  });

  it("reschedules a rate-limited recipient with backoff instead of failing it", async () => {
    claim({ data: [recipientRow({ attempts: 1 })], error: null });

    const now = new Date("2026-05-01T08:00:00.000Z");
    const sender = vi.fn(async () => {
      throw new EmailProviderError("rate limited", { status: 429 });
    });

    const result = await processBulkEmailBatch(BATCH_ID, {
      sender,
      now: () => now,
    });

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 0, retried: 1 });
    const retry = h.updates.find((u) => u.payload.status === "pending");
    expect(retry).toBeDefined();
    // 60s backoff after the first attempt.
    expect(retry?.payload.available_at).toBe("2026-05-01T08:01:00.000Z");
    expect(h.updates.some((u) => u.payload.status === "failed")).toBe(false);
  });

  it("marks a recipient permanently failed on a non-retryable rejection", async () => {
    claim({ data: [recipientRow()], error: null });

    const sender = vi.fn(async () => {
      throw new EmailProviderError("invalid recipient", { status: 400 });
    });

    const result = await processBulkEmailBatch(BATCH_ID, { sender });

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1, retried: 0 });
    const failed = h.updates.find((u) => u.payload.status === "failed");
    expect(failed?.payload.last_error).toContain("invalid recipient");
  });

  it("stops retrying and fails the recipient once attempts are exhausted", async () => {
    claim({
      data: [recipientRow({ attempts: BULK_EMAIL_MAX_ATTEMPTS })],
      error: null,
    });

    const sender = vi.fn(async () => {
      throw new EmailProviderRequestError();
    });

    const result = await processBulkEmailBatch(BATCH_ID, { sender });

    expect(result.failed).toBe(1);
    expect(result.retried).toBe(0);
    expect(h.updates.some((u) => u.payload.status === "pending")).toBe(false);
  });

  it("handles a partial failure per recipient (no batch-wide verdict)", async () => {
    claim({ data: [recipientRow({ id: "r1" })], error: null });
    claim({
      data: [
        recipientRow({ id: "r2", recipient_email: "two@example.com", attempts: 5 }),
      ],
      error: null,
    });
    claim({
      data: [recipientRow({ id: "r3", recipient_email: "three@example.com" })],
      error: null,
    });

    let call = 0;
    const sender = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new EmailProviderError("bad", { status: 422 });
      return { messageId: `m${call}` };
    });

    const result = await processBulkEmailBatch(BATCH_ID, { sender });

    expect(result).toEqual({ claimed: 3, sent: 2, failed: 1, retried: 0 });
    // The successful recipients are NOT re-sent or downgraded by the failure.
    expect(h.updates.filter((u) => u.payload.status === "sent")).toHaveLength(2);
  });
});



describe("T-BULK-1: invalid addresses, infrastructure errors and logging safety", () => {
  it("never sends to a stored address that is no longer valid", async () => {
    claim({
      data: [recipientRow({ recipient_email: "not-an-address" })],
      error: null,
    });

    const sender = vi.fn(async () => ({ messageId: "m" }));
    const result = await processBulkEmailBatch(BATCH_ID, { sender });

    expect(sender).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(h.updates[0].payload.last_error).toMatch(/invalid/i);
  });

  it("stops without throwing when the claim RPC fails", async () => {
    claim({ data: null, error: { code: "57014" } });
    const sender = vi.fn(async () => ({ messageId: "m" }));

    const result = await processBulkEmailBatch(BATCH_ID, { sender });

    expect(result.claimed).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });

  it("redacts secrets from the recorded failure reason", async () => {
    process.env.BREVO_API_KEY = "super-secret-key";
    claim({ data: [recipientRow()], error: null });

    const sender = vi.fn(async () => {
      throw new EmailProviderError("rejected with api-key super-secret-key", {
        status: 400,
      });
    });

    await processBulkEmailBatch(BATCH_ID, { sender });

    const failed = h.updates.find((u) => u.payload.status === "failed");
    expect(String(failed?.payload.last_error)).not.toContain("super-secret-key");
    delete process.env.BREVO_API_KEY;
  });

  it("never logs a recipient address", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    claim({ data: null, error: { code: "57014" } });

    await processBulkEmailBatch(BATCH_ID, { sender: vi.fn() });

    const logged = JSON.stringify([
      ...errorSpy.mock.calls,
      ...infoSpy.mock.calls,
    ]);
    expect(logged).not.toContain(ADDRESS);
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });
});

describe("T-BULK-1: batch/event binding and after() scheduling", () => {
  it("only processes a batch that belongs to the event", async () => {
    const sender = vi.fn(async () => ({ messageId: "m" }));

    expect(
      await processBulkEmailBatchForEvent(EVENT_A, BATCH_ID, { sender }),
    ).toEqual({ claimed: 0, sent: 0, failed: 0, retried: 0 });

    expect(
      await processBulkEmailBatchForEvent(
        "99999999-9999-4999-8999-999999999999",
        BATCH_ID,
        { sender },
      ),
    ).toBeNull();
  });

  it("schedules the first attempt after the response", async () => {
    claim({ data: [recipientRow()], error: null });
    const sender = vi.fn(async () => ({ messageId: "m" }));

    scheduleBulkEmailProcessing(BATCH_ID, { sender });
    expect(afterState.callbacks).toHaveLength(1);

    await afterState.callbacks[0]();
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("is a safe no-op outside a request scope and never rejects", async () => {
    afterState.shouldThrow = true;
    expect(() => scheduleBulkEmailProcessing(BATCH_ID)).not.toThrow();

    afterState.shouldThrow = false;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    claim({ data: null, error: { code: "57014" } });
    scheduleBulkEmailProcessing(BATCH_ID);
    await expect(afterState.callbacks[0]()).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});

