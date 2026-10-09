import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Capture Next.js `after()` callbacks so the scheduled path is testable.
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

vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/competition-join-server", () => ({ getCompetitionPass: vi.fn() }));
vi.mock("@/lib/email/notification-delivery", () => ({
  sanitizeDeliveryError: (e: unknown) =>
    e instanceof Error ? e.message : "delivery error",
}));

const supabaseState = vi.hoisted(() => ({
  rows: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () =>
          supabaseState.rows[table] ?? { data: null, error: null },
      };
      return chain;
    },
  },
}));

import { createNotification } from "@/lib/notifications";
import { getCompetitionPass } from "@/lib/competition-join-server";
import {
  sendCompetitionRegistrationConfirmation,
  scheduleCompetitionRegistrationConfirmation,
  COMPETITION_REGISTRATION_NOTIFICATION_TYPE,
} from "@/lib/competition-registration-notify";

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_1 = "11111111-1111-4111-8111-111111111111";
const PARTICIPANT_1 = "p1111111-1111-4111-8111-111111111111";
const VERIFY_URL = "https://fom-sports.com/competitions/verify/opaque-token-123";
const QR_IMAGE_URL =
  "https://fom-sports.com/api/competitions/verify-qr/opaque-token-123";

function passRow() {
  return {
    participantId: PARTICIPANT_1,
    eventId: EVENT_A,
    status: "registered",
    verificationCode: "ABCD2345",
    checkedInAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseState.rows = {
    competition_events: {
      data: {
        name: "City Finals",
        description: "Bring water.",
        location: "Riverside",
        event_date: "2026-10-03T18:30:00.000Z",
        challenge_name: "Juggle Challenge",
      },
      error: null,
    },
    profiles: {
      data: { email: "player@example.com", full_name: "Alex" },
      error: null,
    },
  };
  afterState.callbacks = [];
  afterState.shouldThrow = false;

  vi.mocked(getCompetitionPass).mockResolvedValue(passRow() as never);
  vi.mocked(createNotification).mockResolvedValue({
    data: { id: "notif-1" },
    error: null,
    deduplicated: false,
  } as never);
});

describe("COMP-EMAIL-001: competition registration confirmation", () => {
  it("references the hosted QR derived from the EXACT pass verify URL and sends once", async () => {
    const sent: Array<{ to: { email: string }; html: string; subject: string }> = [];
    const sender = vi.fn(
      async (email: { to: { email: string }; html: string; subject: string }) => {
        sent.push(email);
        return { messageId: "brevo-1" };
      },
    );

    const result = await sendCompetitionRegistrationConfirmation(
      { eventId: EVENT_A, profileId: PROFILE_1, verifyUrl: VERIFY_URL },
      { sender },
    );

    expect(result.sent).toBe(true);

    // Dedup gate uses the participant id as the source (one email/registration).
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: PROFILE_1,
        type: COMPETITION_REGISTRATION_NOTIFICATION_TYPE,
        sourceId: PARTICIPANT_1,
      }),
    );

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    const email = sent[0];
    expect(email.to.email).toBe("player@example.com");
    // REGRESSION: the hosted QR URL is derived from the SAME origin+token as the
    // pass verify URL — same payload, different transport.
    expect(email.html).toContain(`<img src="${QR_IMAGE_URL}"`);
    expect(email.html).not.toContain("data:image");
    expect(email.html).toContain("ABCD-2345");
    expect(email.subject).toBe("You're registered for City Finals");
  });

  it("does not send a second email when the registration is deduplicated", async () => {
    vi.mocked(createNotification).mockResolvedValue({
      data: null,
      error: null,
      deduplicated: true,
    } as never);
    const sender = vi.fn(async () => ({ messageId: "brevo-1" }));

    const result = await sendCompetitionRegistrationConfirmation(
      { eventId: EVENT_A, profileId: PROFILE_1, verifyUrl: VERIFY_URL },
      { sender },
    );

    expect(result.deduplicated).toBe(true);
    expect(result.sent).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });

  it("does not send when the profile is not a registered participant", async () => {
    vi.mocked(getCompetitionPass).mockResolvedValue(null);
    const sender = vi.fn(async () => ({ messageId: "brevo-1" }));

    const result = await sendCompetitionRegistrationConfirmation(
      { eventId: EVENT_A, profileId: PROFILE_1, verifyUrl: VERIFY_URL },
      { sender },
    );

    expect(result.sent).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
  });

  it("does not send when the recipient has no usable email", async () => {
    supabaseState.rows.profiles = {
      data: { email: "", full_name: "Alex" },
      error: null,
    };
    const sender = vi.fn(async () => ({ messageId: "brevo-1" }));

    const result = await sendCompetitionRegistrationConfirmation(
      { eventId: EVENT_A, profileId: PROFILE_1, verifyUrl: VERIFY_URL },
      { sender },
    );

    expect(result.sent).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });

  it("never throws (and never undoes registration) when the provider fails", async () => {
    const sender = vi.fn(async () => {
      throw new Error("brevo down");
    });

    await expect(
      sendCompetitionRegistrationConfirmation(
        { eventId: EVENT_A, profileId: PROFILE_1, verifyUrl: VERIFY_URL },
        { sender },
      ),
    ).resolves.toEqual({ sent: false, deduplicated: false });
    expect(sender).toHaveBeenCalledTimes(1);
  });
});

describe("COMP-EMAIL-001: scheduling", () => {
  it("schedules the send after the response (after())", async () => {
    const sender = vi.fn(async () => ({ messageId: "brevo-1" }));

    scheduleCompetitionRegistrationConfirmation(
      { eventId: EVENT_A, profileId: PROFILE_1, verifyUrl: VERIFY_URL },
      { sender },
    );

    expect(afterState.callbacks).toHaveLength(1);
    await afterState.callbacks[0]();
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("never throws into the caller when after() is unavailable", () => {
    afterState.shouldThrow = true;
    expect(() =>
      scheduleCompetitionRegistrationConfirmation({
        eventId: EVENT_A,
        profileId: PROFILE_1,
        verifyUrl: VERIFY_URL,
      }),
    ).not.toThrow();
  });
});
