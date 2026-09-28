import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

// EMAIL-002A: capture Next.js `after()` callbacks so the immediate background
// trigger is testable without a real request scope.
const afterState = vi.hoisted(() => ({
  callbacks: [] as Array<() => unknown>,
  shouldThrow: false,
}));

vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    if (afterState.shouldThrow) {
      throw new Error("after() called outside a request scope");
    }
    afterState.callbacks.push(cb);
  },
}));

const h = vi.hoisted(() => {
  const state = {
    rpcQueue: [] as Array<{ data: unknown; error: unknown }>,
    selectResults: {} as Record<string, { data: unknown; error: unknown }>,
    insertResult: { data: null, error: null } as {
      data: unknown;
      error: unknown;
    },
    updateResult: { data: null, error: null } as {
      data: unknown;
      error: unknown;
    },
    insertCalls: [] as Array<{ table: string; payload: Record<string, unknown> }>,
    updateCalls: [] as Array<{
      table: string;
      payload: Record<string, unknown>;
      eq: [string, unknown];
    }>,
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  };
  return state;
});

vi.mock("@/lib/supabase-admin", () => {
  function selectChain(table: string) {
    const chain = {
      eq: () => chain,
      maybeSingle: async () =>
        h.selectResults[table] ?? { data: null, error: null },
    };
    return chain;
  }

  const supabaseAdmin = {
    from: (table: string) => ({
      select: () => selectChain(table),
      insert: (payload: Record<string, unknown>) => {
        h.insertCalls.push({ table, payload });
        return h.insertResult;
      },
      update: (payload: Record<string, unknown>) => ({
        eq: async (col: string, val: unknown) => {
          h.updateCalls.push({ table, payload, eq: [col, val] });
          return h.updateResult;
        },
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args });
      if (h.rpcQueue.length > 0) return h.rpcQueue.shift()!;
      return { data: [], error: null };
    },
  };

  return { supabaseAdmin };
});

vi.mock("@/lib/email/email-service", () => ({
  sendTransactionalEmail: vi.fn(),
}));

import {
  computeRetryDelaySeconds,
  buildNotificationEmail,
  enqueueEmailDeliveryForNotification,
  isEmailNotificationType,
  processEmailDeliveries,
  sanitizeDeliveryError,
  scheduleEmailDeliveryProcessing,
  EMAIL_DELIVERY_MAX_ATTEMPTS,
} from "@/lib/email/notification-delivery";
import type { TransactionalEmail } from "@/lib/email/types";

function claimedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "delivery-1",
    notification_id: "notif-1",
    recipient_email: "player@example.com",
    attempts: 1,
    status: "sending",
    ...overrides,
  };
}

describe("EMAIL-002: email-enabled notification allowlist", () => {
  it("enables message_received and application_status_changed only", () => {
    expect(isEmailNotificationType("message_received")).toBe(true);
    expect(isEmailNotificationType("application_status_changed")).toBe(true);
    expect(isEmailNotificationType("application_received")).toBe(false);
    expect(isEmailNotificationType("player_joined_team")).toBe(false);
    expect(isEmailNotificationType("")).toBe(false);
  });
});

describe("EMAIL-002: retry backoff", () => {
  it("grows exponentially and is capped", () => {
    expect(computeRetryDelaySeconds(1)).toBe(60);
    expect(computeRetryDelaySeconds(2)).toBe(120);
    expect(computeRetryDelaySeconds(3)).toBe(240);
    // Capped at 6h regardless of how large attempts grows.
    expect(computeRetryDelaySeconds(50)).toBe(6 * 60 * 60);
  });
});

describe("EMAIL-002: safe error sanitisation", () => {
  it("never leaks the Brevo API key", () => {
    process.env.BREVO_API_KEY = "super-secret-key-value";
    const message = sanitizeDeliveryError(
      new Error("request failed with api-key super-secret-key-value"),
    );
    expect(message).not.toContain("super-secret-key-value");
    delete process.env.BREVO_API_KEY;
  });

  it("redacts bearer tokens and long opaque strings", () => {
    const message = sanitizeDeliveryError(
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    );
    expect(message.toLowerCase()).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(message).toContain("[redacted]");
  });

  it("truncates very long messages", () => {
    const message = sanitizeDeliveryError("x".repeat(5000));
    expect(message.length).toBeLessThanOrEqual(500);
  });
});

describe("EMAIL-002: email construction", () => {
  it("builds a transactional email from a notification", () => {
    const email = buildNotificationEmail(
      { title: "New message", body: "You have a new message.", link: null },
      "player@example.com",
    );
    expect(email.to.email).toBe("player@example.com");
    expect(email.subject).toBe("New message");
    expect(email.html).toContain("You have a new message.");
    expect(email.text).toContain("You have a new message.");
  });

  it("escapes untrusted notification body content in the HTML", () => {
    const email = buildNotificationEmail(
      { title: "Hi", body: "<script>alert(1)</script>", link: null },
      "player@example.com",
    );
    expect(email.html).not.toContain("<script>alert(1)</script>");
  });

  it("builds the specialized outreach email when the payload is outreach (EMAIL-003)", () => {
    process.env.NEXTAUTH_URL = "https://fomsports.example";
    const email = buildNotificationEmail(
      {
        title: "New message from a team",
        body: "Northside FC contacted you about \"First Team Striker\".",
        link: "/messages/conv-123",
        data: {
          kind: "outreach",
          teamName: "Northside FC",
          opportunityTitle: "First Team Striker",
          opportunityRole: "ST",
          playerName: "Alex Doe",
        },
      },
      "player@example.com",
    );

    // Specialized subject/copy, not the raw notification title.
    expect(email.subject).toBe("Northside FC contacted you on FOM Sports");
    expect(email.html).toContain("Northside FC");
    expect(email.html).toContain("First Team Striker");
    expect(email.html).toContain("View Conversation");
    expect(email.html).toContain("https://fomsports.example/messages/conv-123");
    delete process.env.NEXTAUTH_URL;
  });

  it("does NOT specialize a normal message_received notification without outreach data (EMAIL-003)", () => {
    const email = buildNotificationEmail(
      {
        title: "New message",
        body: "Alex Player sent you a new message.",
        link: "/messages/conv-9",
        data: null,
      },
      "player@example.com",
    );

    // Falls back to the generic EMAIL-002 behavior.
    expect(email.subject).toBe("New message");
    expect(email.html).toContain("Alex Player sent you a new message.");
    expect(email.text).not.toContain("View Conversation");
  });

  it("builds the specialized application-status email when the payload is application_status_changed (EMAIL-004)", () => {
    process.env.NEXTAUTH_URL = "https://fomsports.example";
    const email = buildNotificationEmail(
      {
        title: "Application updated",
        body: "Phoenix Pro Stars FC has accepted your application for Center Back.",
        link: "/player/applications/app-123",
        data: {
          kind: "application_status_changed",
          status: "accepted",
          teamName: "Phoenix Pro Stars FC",
          opportunityTitle: "First Team Striker",
          opportunityRole: "ST",
          playerName: "Alex Doe",
        },
      },
      "player@example.com",
    );

    // Specialized subject/copy, not the raw notification title.
    expect(email.subject).toBe(
      "Your application to Phoenix Pro Stars FC was accepted",
    );
    expect(email.html).toContain("Phoenix Pro Stars FC");
    expect(email.html).toContain("First Team Striker");
    expect(email.html).toContain("View Application");
    expect(email.html).toContain(
      "https://fomsports.example/player/applications/app-123",
    );
    delete process.env.NEXTAUTH_URL;
  });

  it("still uses the outreach template for outreach and the generic fallback otherwise (EMAIL-004 dispatch)", () => {
    process.env.NEXTAUTH_URL = "https://fomsports.example";

    const outreach = buildNotificationEmail(
      {
        title: "New message from a team",
        body: "Northside FC contacted you.",
        link: "/messages/conv-1",
        data: { kind: "outreach", teamName: "Northside FC" },
      },
      "player@example.com",
    );
    expect(outreach.subject).toBe("Northside FC contacted you on FOM Sports");

    const generic = buildNotificationEmail(
      {
        title: "New message",
        body: "Alex Player sent you a new message.",
        link: "/messages/conv-9",
        data: null,
      },
      "player@example.com",
    );
    expect(generic.subject).toBe("New message");
    delete process.env.NEXTAUTH_URL;
  });
});

describe("EMAIL-002: enqueue", () => {
  beforeEach(() => {
    h.rpcQueue = [];
    h.selectResults = {};
    h.insertResult = { data: null, error: null };
    h.updateResult = { data: null, error: null };
    h.insertCalls = [];
    h.updateCalls = [];
    h.rpcCalls = [];
    vi.clearAllMocks();
  });

  it("creates exactly one delivery row for an email-enabled notification", async () => {
    h.selectResults.profiles = { data: { email: "player@example.com" }, error: null };

    const result = await enqueueEmailDeliveryForNotification({
      notificationId: "notif-1",
      userId: "user-1",
      type: "message_received",
    });

    expect(result.enqueued).toBe(true);
    expect(h.insertCalls).toHaveLength(1);
    expect(h.insertCalls[0].table).toBe("email_notification_deliveries");
    expect(h.insertCalls[0].payload).toMatchObject({
      notification_id: "notif-1",
      recipient_email: "player@example.com",
      status: "pending",
    });
  });

  it("creates no delivery row for a non-email notification type", async () => {
    h.selectResults.profiles = { data: { email: "player@example.com" }, error: null };

    const result = await enqueueEmailDeliveryForNotification({
      notificationId: "notif-2",
      userId: "user-1",
      type: "application_received",
    });

    expect(result.enqueued).toBe(false);
    expect(result.skipped).toBe(true);
    expect(h.insertCalls).toHaveLength(0);
  });

  it("treats a duplicate delivery insert (23505) as already enqueued", async () => {
    h.selectResults.profiles = { data: { email: "player@example.com" }, error: null };
    h.insertResult = { data: null, error: { code: "23505" } };

    const result = await enqueueEmailDeliveryForNotification({
      notificationId: "notif-1",
      userId: "user-1",
      type: "message_received",
    });

    expect(result.enqueued).toBe(false);
    expect(result.deduplicated).toBe(true);
  });

  it("resolves the recipient from profiles.email (never auth.users)", async () => {
    h.selectResults.profiles = { data: { email: "  player@example.com " }, error: null };

    await enqueueEmailDeliveryForNotification({
      notificationId: "notif-3",
      userId: "user-9",
      type: "message_received",
    });

    expect(h.insertCalls[0].payload.recipient_email).toBe("player@example.com");
  });

  it("skips cleanly when the profile has no usable email", async () => {
    h.selectResults.profiles = { data: { email: null }, error: null };

    const result = await enqueueEmailDeliveryForNotification({
      notificationId: "notif-4",
      userId: "user-1",
      type: "message_received",
    });

    expect(result.enqueued).toBe(false);
    expect(h.insertCalls).toHaveLength(0);
  });

  it("does not throw when enqueue infrastructure fails", async () => {
    h.selectResults.profiles = { data: { email: "player@example.com" }, error: null };
    h.insertResult = { data: null, error: { code: "42P01" } };

    await expect(
      enqueueEmailDeliveryForNotification({
        notificationId: "notif-5",
        userId: "user-1",
        type: "message_received",
      }),
    ).resolves.toMatchObject({ enqueued: false });
  });
});

describe("EMAIL-002: processor", () => {
  beforeEach(() => {
    h.rpcQueue = [];
    h.selectResults = {};
    h.insertResult = { data: null, error: null };
    h.updateResult = { data: null, error: null };
    h.insertCalls = [];
    h.updateCalls = [];
    h.rpcCalls = [];
    vi.clearAllMocks();
  });

  it("processes a pending delivery and marks it sent with the provider message id", async () => {
    h.rpcQueue = [{ data: [claimedRow()], error: null }];
    h.selectResults.notifications = {
      data: { title: "New message", body: "Hello", link: null },
      error: null,
    };
    const sender = vi.fn().mockResolvedValue({ messageId: "brevo-msg-1" });

    const result = await processEmailDeliveries({ sender, limit: 5 });

    expect(result.claimed).toBe(1);
    expect(result.sent).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);

    const sentUpdate = h.updateCalls.find((c) => c.payload.status === "sent");
    expect(sentUpdate).toBeTruthy();
    expect(sentUpdate!.payload.provider_message_id).toBe("brevo-msg-1");
    expect(sentUpdate!.payload.sent_at).toBeTruthy();
  });

  it("passes a correctly-built email to the sender", async () => {
    h.rpcQueue = [{ data: [claimedRow()], error: null }];
    h.selectResults.notifications = {
      data: { title: "New message", body: "You have a message", link: "/messages/1" },
      error: null,
    };
    const sender = vi.fn().mockResolvedValue({ messageId: "m-1" });

    await processEmailDeliveries({ sender, limit: 1 });

    const email = sender.mock.calls[0][0] as TransactionalEmail;
    expect(email.to.email).toBe("player@example.com");
    expect(email.subject).toBe("New message");
  });

  it("sends the specialized outreach email for an outreach-originated notification (EMAIL-003)", async () => {
    process.env.NEXTAUTH_URL = "https://fomsports.example";
    h.rpcQueue = [{ data: [claimedRow()], error: null }];
    h.selectResults.notifications = {
      data: {
        title: "New message from a team",
        body: 'Northside FC contacted you about "First Team Striker".',
        link: "/messages/conv-123",
        data: {
          kind: "outreach",
          teamName: "Northside FC",
          opportunityTitle: "First Team Striker",
          opportunityRole: "ST",
          playerName: "Alex Doe",
        },
      },
      error: null,
    };
    const sender = vi.fn().mockResolvedValue({ messageId: "m-outreach" });

    const result = await processEmailDeliveries({ sender, limit: 1 });

    expect(result.sent).toBe(1);
    const email = sender.mock.calls[0][0] as TransactionalEmail;
    expect(email.subject).toBe("Northside FC contacted you on FOM Sports");
    expect(email.html).toContain("Northside FC");
    expect(email.html).toContain("First Team Striker");
    // CTA resolves to an absolute conversation URL on the app origin.
    expect(email.html).toContain("https://fomsports.example/messages/conv-123");
    delete process.env.NEXTAUTH_URL;
  });

  it("keeps generic behavior for a normal message_received notification (EMAIL-003)", async () => {
    h.rpcQueue = [{ data: [claimedRow()], error: null }];
    h.selectResults.notifications = {
      data: {
        title: "New message",
        body: "Alex Player sent you a new message.",
        link: "/messages/conv-9",
        data: null,
      },
      error: null,
    };
    const sender = vi.fn().mockResolvedValue({ messageId: "m-generic" });

    const result = await processEmailDeliveries({ sender, limit: 1 });

    expect(result.sent).toBe(1);
    const email = sender.mock.calls[0][0] as TransactionalEmail;
    expect(email.subject).toBe("New message");
    expect(email.html).toContain("Alex Player sent you a new message.");
  });

  it("sends the specialized application-status email for an application-status notification (EMAIL-004)", async () => {
    process.env.NEXTAUTH_URL = "https://fomsports.example";
    h.rpcQueue = [{ data: [claimedRow()], error: null }];
    h.selectResults.notifications = {
      data: {
        title: "Application updated",
        body: "Phoenix Pro Stars FC has accepted your application for Center Back.",
        link: "/player/applications/app-123",
        data: {
          kind: "application_status_changed",
          status: "accepted",
          teamName: "Phoenix Pro Stars FC",
          opportunityTitle: "First Team Striker",
          opportunityRole: "ST",
          playerName: "Alex Doe",
        },
      },
      error: null,
    };
    const sender = vi.fn().mockResolvedValue({ messageId: "m-app-status" });

    const result = await processEmailDeliveries({ sender, limit: 1 });

    expect(result.sent).toBe(1);
    const email = sender.mock.calls[0][0] as TransactionalEmail;
    expect(email.subject).toBe(
      "Your application to Phoenix Pro Stars FC was accepted",
    );
    expect(email.html).toContain("Phoenix Pro Stars FC");
    expect(email.html).toContain("First Team Striker");
    // CTA resolves to an absolute application URL on the app origin.
    expect(email.html).toContain(
      "https://fomsports.example/player/applications/app-123",
    );
    delete process.env.NEXTAUTH_URL;
  });

  it("schedules a bounded retry on failure and moves available_at forward", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    h.rpcQueue = [{ data: [claimedRow({ attempts: 1 })], error: null }];
    h.selectResults.notifications = {
      data: { title: "New message", body: "Hello", link: null },
      error: null,
    };
    const sender = vi.fn().mockRejectedValue(new Error("Provider unavailable"));

    const result = await processEmailDeliveries({
      sender,
      limit: 1,
      now: () => now,
    });

    expect(result.retried).toBe(1);
    const retryUpdate = h.updateCalls.find(
      (c) => c.payload.status === "pending" && c.payload.available_at,
    );
    expect(retryUpdate).toBeTruthy();
    const availableAt = new Date(retryUpdate!.payload.available_at as string);
    expect(availableAt.getTime()).toBeGreaterThan(now.getTime());
    expect(retryUpdate!.payload.last_error).toContain("Provider unavailable");
  });

  it("marks the delivery failed once the retry limit is reached", async () => {
    h.rpcQueue = [
      { data: [claimedRow({ attempts: EMAIL_DELIVERY_MAX_ATTEMPTS })], error: null },
    ];
    h.selectResults.notifications = {
      data: { title: "New message", body: "Hello", link: null },
      error: null,
    };
    const sender = vi.fn().mockRejectedValue(new Error("nope"));

    const result = await processEmailDeliveries({ sender, limit: 1 });

    expect(result.failed).toBe(1);
    const failedUpdate = h.updateCalls.find((c) => c.payload.status === "failed");
    expect(failedUpdate).toBeTruthy();
  });

  it("cannot claim the same row twice (stop when the queue is drained)", async () => {
    h.rpcQueue = [
      { data: [claimedRow()], error: null },
      { data: [], error: null },
    ];
    h.selectResults.notifications = {
      data: { title: "New message", body: "Hello", link: null },
      error: null,
    };
    const sender = vi.fn().mockResolvedValue({ messageId: "m-1" });

    const result = await processEmailDeliveries({ sender, limit: 10 });

    expect(result.claimed).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("marks failed when the parent notification is gone", async () => {
    h.rpcQueue = [{ data: [claimedRow()], error: null }];
    h.selectResults.notifications = { data: null, error: null };
    const sender = vi.fn();

    const result = await processEmailDeliveries({ sender, limit: 1 });

    expect(result.failed).toBe(1);
    expect(sender).not.toHaveBeenCalled();
  });
});

describe("EMAIL-002A: immediate best-effort processing trigger", () => {
  beforeEach(() => {
    h.rpcQueue = [];
    h.selectResults = {};
    h.insertResult = { data: null, error: null };
    h.updateResult = { data: null, error: null };
    h.insertCalls = [];
    h.updateCalls = [];
    h.rpcCalls = [];
    afterState.callbacks = [];
    afterState.shouldThrow = false;
    vi.clearAllMocks();
  });

  it("schedules the EXISTING processor via Next.js after() exactly once", () => {
    scheduleEmailDeliveryProcessing();
    expect(afterState.callbacks).toHaveLength(1);
  });

  it("runs the existing processor when the scheduled callback fires", async () => {
    h.rpcQueue = [{ data: [claimedRow()], error: null }];
    h.selectResults.notifications = {
      data: { title: "New message", body: "Hello", link: null },
      error: null,
    };
    const sender = vi.fn().mockResolvedValue({ messageId: "brevo-msg-1" });

    scheduleEmailDeliveryProcessing({ limit: 1, sender });
    expect(afterState.callbacks).toHaveLength(1);

    await afterState.callbacks[0]();

    // The shared outbox path claimed and sent the delivery.
    expect(h.rpcCalls[0].name).toBe("claim_next_email_delivery");
    expect(sender).toHaveBeenCalledTimes(1);
    const sentUpdate = h.updateCalls.find((c) => c.payload.status === "sent");
    expect(sentUpdate).toBeTruthy();
  });

  it("never throws into the caller when after() is unavailable", () => {
    afterState.shouldThrow = true;
    expect(() => scheduleEmailDeliveryProcessing()).not.toThrow();
  });

  it("swallows background processor failures (best-effort)", async () => {
    h.rpcQueue = [{ data: null, error: { code: "42P01" } }];

    scheduleEmailDeliveryProcessing();
    await expect(afterState.callbacks[0]()).resolves.toBeUndefined();
  });
});

describe("EMAIL-002A: bounded retry ladder (max 5 total attempts)", () => {
  beforeEach(() => {
    h.rpcQueue = [];
    h.selectResults = {};
    h.insertResult = { data: null, error: null };
    h.updateResult = { data: null, error: null };
    h.insertCalls = [];
    h.updateCalls = [];
    h.rpcCalls = [];
    afterState.callbacks = [];
    afterState.shouldThrow = false;
    vi.clearAllMocks();
  });

  it("remains retryable for attempts 1-4 and only fails on attempt 5", async () => {
    const notify = {
      data: { title: "New message", body: "Hello", link: null },
      error: null,
    };

    for (const attempts of [1, 2, 3, 4]) {
      h.rpcQueue = [{ data: [claimedRow({ attempts })], error: null }];
      h.selectResults.notifications = notify;
      h.updateCalls = [];
      h.rpcCalls = [];
      const sender = vi.fn().mockRejectedValue(new Error("down"));

      const result = await processEmailDeliveries({ sender, limit: 1 });

      expect(result.retried).toBe(1);
      expect(result.failed).toBe(0);
      const retryUpdate = h.updateCalls.find(
        (c) => c.payload.status === "pending" && c.payload.available_at,
      );
      expect(retryUpdate).toBeTruthy();
    }

    // Attempt 5 (the final allowed attempt) fails permanently.
    h.rpcQueue = [
      { data: [claimedRow({ attempts: EMAIL_DELIVERY_MAX_ATTEMPTS })], error: null },
    ];
    h.selectResults.notifications = notify;
    h.updateCalls = [];
    const sender = vi.fn().mockRejectedValue(new Error("down"));

    const result = await processEmailDeliveries({ sender, limit: 1 });

    expect(result.failed).toBe(1);
    expect(result.retried).toBe(0);
    expect(h.updateCalls.find((c) => c.payload.status === "failed")).toBeTruthy();
  });

  it("passes the retry cap to the claim RPC so a 6th attempt is impossible", async () => {
    h.rpcQueue = [{ data: [], error: null }];

    await processEmailDeliveries({ limit: 1 });

    expect(h.rpcCalls[0].name).toBe("claim_next_email_delivery");
    expect(h.rpcCalls[0].args.p_max_attempts).toBe(EMAIL_DELIVERY_MAX_ATTEMPTS);
  });

  it("does not send when the claim RPC returns no eligible row (not due, or cap reached)", async () => {
    h.rpcQueue = [{ data: [], error: null }];
    const sender = vi.fn();

    const result = await processEmailDeliveries({ sender, limit: 5 });

    expect(result.claimed).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });
});
