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
  ANNOUNCEMENT_MAX_ATTEMPTS,
  ANNOUNCEMENT_PROCESS_LIMIT,
  isRetryableAnnouncementError,
  processAnnouncementBatch,
  scheduleAnnouncementProcessing,
} from "@/lib/email-announcements-delivery";
import {
  EmailConfigError,
  EmailProviderError,
  EmailProviderRequestError,
  EmailRecipientError,
} from "@/lib/email/errors";
import type { TransactionalEmail } from "@/lib/email/types";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — delivery processor tests.
 *
 * Verifies one-message-per-recipient sending, per-recipient outcome recording,
 * bounded retries/backoff, permanent failures, malformed stored addresses, the
 * promoted competition link, and the after()-scheduled first attempt.
 */

const BATCH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ADDRESS = "recipient@example.com";
const PROMO_URL = "https://fom.example.com/competitions/join/promo-token";

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
    email_announcement_batches: {
      data: {
        id: BATCH_ID,
        subject: "Join our next competition",
        body_text:
          "Hi,\n\nLine one\nLine two\n\n- Bring boots",
        image_url: null,
        promotion_event_id: null,
        promotion_url: null,
      },
      error: null,
    },
  };
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: delivery processor", () => {
  it("sends ONE individual message per recipient and records each acceptance", async () => {
    claim({ data: [recipientRow()], error: null });
    claim({
      data: [
        recipientRow({
          id: "recipient-2",
          recipient_email: "two@example.com",
          recipient_name: null,
        }),
      ],
      error: null,
    });
    claim({ data: [], error: null });

    const sent: TransactionalEmail[] = [];
    const result = await processAnnouncementBatch(BATCH_ID, {
      sender: async (email) => {
        sent.push(email);
        return { messageId: `msg-${sent.length}` };
      },
      now: () => new Date("2026-05-01T10:00:00.000Z"),
    });

    expect(result.claimed).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(sent).toHaveLength(2);
    // Each message has exactly ONE recipient (no shared To/CC list).
    expect(sent[0].to.email).toBe(ADDRESS);
    expect(sent[1].to.email).toBe("two@example.com");
    // Formatting is preserved in the delivered body.
    expect(sent[0].html).toContain("<ul ");
    expect(sent[0].html).toContain("<br />");
    expect(sent[0].text).toContain("Bring boots");

    const accepted = h.updates.filter((u) => u.payload.status === "sent");
    expect(accepted).toHaveLength(2);
    expect(accepted[0].payload.provider_message_id).toBe("msg-1");
  });

  it("claims through the atomic announcement RPC with bounded attempts", async () => {
    await processAnnouncementBatch(BATCH_ID, { limit: 3, maxAttempts: 4 });

    expect(h.rpcCalls.length).toBeGreaterThan(0);
    expect(h.rpcCalls[0].name).toBe("claim_next_announcement_recipient");
    expect(h.rpcCalls[0].args).toMatchObject({
      p_batch_id: BATCH_ID,
      p_max_attempts: 4,
    });
  });

  it("marks a malformed stored address failed without calling the provider", async () => {
    claim({
      data: [recipientRow({ recipient_email: "not-an-email" })],
      error: null,
    });
    claim({ data: [], error: null });

    const sender = vi.fn(async () => ({ messageId: "x" }));
    const result = await processAnnouncementBatch(BATCH_ID, { sender });

    expect(sender).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    const failed = h.updates.find((u) => u.payload.status === "failed");
    expect(failed?.payload.last_error).toMatch(/invalid/i);
  });

  it("permanently fails a non-retryable provider rejection", async () => {
    claim({ data: [recipientRow()], error: null });
    claim({ data: [], error: null });

    const result = await processAnnouncementBatch(BATCH_ID, {
      sender: async () => {
        throw new EmailRecipientError();
      },
    });

    expect(result.failed).toBe(1);
    expect(result.retried).toBe(0);
    expect(h.updates.some((u) => u.payload.status === "failed")).toBe(true);
  });

  it("reschedules a retryable failure with backoff while attempts remain", async () => {
    claim({ data: [recipientRow({ attempts: 1 })], error: null });
    claim({ data: [], error: null });

    const result = await processAnnouncementBatch(BATCH_ID, {
      maxAttempts: 5,
      sender: async () => {
        throw new EmailProviderRequestError("network");
      },
      now: () => new Date("2026-05-01T10:00:00.000Z"),
    });

    expect(result.retried).toBe(1);
    expect(result.failed).toBe(0);
    const retry = h.updates.find((u) => u.payload.status === "pending");
    expect(retry).toBeDefined();
    expect(retry?.payload.available_at).toBe("2026-05-01T10:01:00.000Z");
  });

  it("permanently fails once the attempts cap is reached", async () => {
    claim({
      data: [recipientRow({ attempts: ANNOUNCEMENT_MAX_ATTEMPTS })],
      error: null,
    });
    claim({ data: [], error: null });

    const result = await processAnnouncementBatch(BATCH_ID, {
      sender: async () => {
        throw new EmailProviderRequestError("network");
      },
    });

    expect(result.failed).toBe(1);
    expect(result.retried).toBe(0);
  });


  it("stops the invocation when claiming fails (rows stay queued)", async () => {
    claim({ data: null, error: { code: "42P01" } });

    const sender = vi.fn(async () => ({ messageId: "x" }));
    const result = await processAnnouncementBatch(BATCH_ID, { sender });

    expect(result.claimed).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });

  it("does nothing when the batch no longer exists", async () => {
    h.selectResults.email_announcement_batches = { data: null, error: null };

    const sender = vi.fn(async () => ({ messageId: "x" }));
    const result = await processAnnouncementBatch(BATCH_ID, { sender });

    expect(result.claimed).toBe(0);
    expect(sender).not.toHaveBeenCalled();
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("includes the promoted competition's registration link", async () => {
    h.selectResults.email_announcement_batches = {
      data: {
        id: BATCH_ID,
        subject: "Join us",
        body_text: "Body",
        image_url: null,
        promotion_event_id: EVENT_B,
        promotion_url: PROMO_URL,
      },
      error: null,
    };
    h.selectResults.competition_events = {
      data: { name: "Spring Cup" },
      error: null,
    };
    claim({ data: [recipientRow()], error: null });
    claim({ data: [], error: null });

    const sent: TransactionalEmail[] = [];
    await processAnnouncementBatch(BATCH_ID, {
      sender: async (email) => {
        sent.push(email);
        return { messageId: "msg-1" };
      },
    });

    expect(sent[0].html).toContain(PROMO_URL);
    expect(sent[0].text).toContain(PROMO_URL);
  });

  it("includes the uploaded image in the delivered body", async () => {
    h.selectResults.email_announcement_batches = {
      data: {
        id: BATCH_ID,
        subject: "Join us",
        body_text: "Before\n\n[image]\n\nAfter",
        image_url: "https://cdn.example.com/pic.png",
        promotion_event_id: null,
        promotion_url: null,
      },
      error: null,
    };
    claim({ data: [recipientRow()], error: null });
    claim({ data: [], error: null });

    const sent: TransactionalEmail[] = [];
    await processAnnouncementBatch(BATCH_ID, {
      sender: async (email) => {
        sent.push(email);
        return { messageId: "msg-1" };
      },
    });

    expect(sent[0].html).toContain('src="https://cdn.example.com/pic.png"');
    expect(sent[0].text).toContain("Image: https://cdn.example.com/pic.png");
  });

  it("bounds the number of sends per invocation", async () => {
    for (let i = 0; i < 10; i += 1) {
      claim({
        data: [
          recipientRow({ id: `r-${i}`, recipient_email: `u${i}@example.com` }),
        ],
        error: null,
      });
    }

    const sender = vi.fn(async () => ({ messageId: "msg" }));
    const result = await processAnnouncementBatch(BATCH_ID, {
      limit: 3,
      sender,
    });

    expect(result.sent).toBe(3);
    expect(sender).toHaveBeenCalledTimes(3);
    expect(ANNOUNCEMENT_PROCESS_LIMIT).toBe(25);
  });
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: retry classification", () => {
  it("treats network, rate-limit, 5xx and config errors as retryable", () => {
    expect(
      isRetryableAnnouncementError(new EmailProviderRequestError("net")),
    ).toBe(true);
    expect(
      isRetryableAnnouncementError(
        new EmailProviderError("rate", { status: 429 }),
      ),
    ).toBe(true);
    expect(
      isRetryableAnnouncementError(
        new EmailProviderError("boom", { status: 503 }),
      ),
    ).toBe(true);
    expect(
      isRetryableAnnouncementError(new EmailConfigError(["BREVO_API_KEY"])),
    ).toBe(true);
  });

  it("treats a rejected recipient and a 4xx rejection as permanent", () => {
    expect(isRetryableAnnouncementError(new EmailRecipientError())).toBe(false);
    expect(
      isRetryableAnnouncementError(
        new EmailProviderError("bad", { status: 400 }),
      ),
    ).toBe(false);
  });
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: scheduled first attempt", () => {
  it("registers the first attempt with after()", () => {
    scheduleAnnouncementProcessing(BATCH_ID);
    expect(afterState.callbacks).toHaveLength(1);
  });

  it("is a harmless no-op outside a request scope", () => {
    afterState.shouldThrow = true;
    expect(() => scheduleAnnouncementProcessing(BATCH_ID)).not.toThrow();
  });
});

