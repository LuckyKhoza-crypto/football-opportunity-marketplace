import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  selectQueues: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
  selects: [] as string[],
  inserts: [] as Array<{ table: string; payload: unknown }>,
  insertResults: {} as Record<string, { data: unknown; error: unknown }>,
  deletes: [] as Array<{ table: string; eq: [string, unknown] }>,
}));

vi.mock("@/lib/supabase-admin", () => {
  const makeChain = (table: string) => {
    const queue = h.selectQueues[table];
    const result =
      queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
    h.selects.push(table);
    const chain = {
      eq: () => chain,
      is: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      range: async () => result,
      maybeSingle: async () => result,
      single: async () => result,
      then: (resolve: (value: unknown) => unknown) => resolve(result),
    };
    return chain;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => ({
        select: () => makeChain(table),
        insert: (payload: unknown) => {
          h.inserts.push({ table, payload });
          const result =
            h.insertResults[table] ?? { data: null, error: null };
          return {
            select: () => ({ single: async () => result }),
            then: (resolve: (value: unknown) => unknown) => resolve(result),
          };
        },
        delete: () => ({
          eq: async (column: string, value: unknown) => {
            h.deletes.push({ table, eq: [column, value] });
            return { data: null, error: null };
          },
        }),
        rpc: async () => ({ data: [], error: null }),
      }),
    },
  };
});

vi.mock("@/lib/competition-server", () => ({
  isCompetitionCreationAdmin: (profileId: string | null | undefined) =>
    profileId === ADMIN,
  getCompetitionEvent: vi.fn(),
}));

vi.mock("@/lib/email/config", () => ({
  isEmailConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/email-announcements-join-link", () => ({
  resolvePromotionJoinLink: vi.fn(),
}));

vi.mock("@/lib/email-announcements-delivery", () => ({
  processAnnouncementBatch: vi.fn(),
  scheduleAnnouncementProcessing: vi.fn(),
}));

import {
  getAnnouncementAudience,
  getEmailAnnouncementBatch,
  isAllowedAnnouncementImageUrl,
  previewEmailAnnouncement,
  processEmailAnnouncementBatch,
  sendEmailAnnouncement,
} from "@/lib/email-announcements-server";
import { getCompetitionEvent } from "@/lib/competition-server";
import { isEmailConfigured } from "@/lib/email/config";
import { resolvePromotionJoinLink } from "@/lib/email-announcements-join-link";
import { scheduleAnnouncementProcessing } from "@/lib/email-announcements-delivery";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — server helper tests.
 *
 * Covers administrator-only authorization, server-authoritative audience
 * resolution (all users, historical previous-competition participants, and the
 * promotion exclusion), preview rendering, send idempotency and the empty
 * audience, plus image-URL validation.
 */

const ADMIN = "admin-1111-4111-8111-111111111111";
const OUTSIDER = "user-9999-4999-8999-999999999999";
const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROFILE_1 = "11111111-1111-4111-8111-111111111111";
const PROFILE_2 = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const PROMO_URL = "https://fom.example.com/competitions/join/promo-token";

function queueSelect(table: string, data: unknown, error: unknown = null) {
  const queue = h.selectQueues[table] ?? [];
  queue.push({ data, error });
  h.selectQueues[table] = queue;
}

beforeEach(() => {
  h.selectQueues = {};
  h.selects = [];
  h.inserts = [];
  h.insertResults = {};
  h.deletes = [];
  vi.mocked(getCompetitionEvent).mockReset();
  vi.mocked(isEmailConfigured).mockReturnValue(true);
  vi.mocked(resolvePromotionJoinLink).mockReset();
  vi.mocked(scheduleAnnouncementProcessing).mockReset();
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: authorization", () => {
  it("refuses an audience read for a non-administrator", async () => {
    const result = await getAnnouncementAudience({
      actorProfileId: OUTSIDER,
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(h.selects).toHaveLength(0);
  });

  it("refuses a preview for a non-administrator", async () => {
    const result = await previewEmailAnnouncement({
      actorProfileId: OUTSIDER,
      subject: "Hi",
      message: "Body",
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
      imageUrl: null,
      origin: "https://fom.example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("refuses a send for a non-administrator", async () => {
    const result = await sendEmailAnnouncement({
      actorProfileId: OUTSIDER,
      subject: "Hi",
      message: "Body",
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
      imageUrl: null,
      requestId: REQUEST_ID,
      origin: "https://fom.example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(h.inserts).toHaveLength(0);
  });
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: audience resolution", () => {
  it("counts every user with a valid address for the all-users audience", async () => {
    queueSelect("profiles", [
      { id: PROFILE_1, email: "one@example.com", full_name: "One" },
      { id: PROFILE_2, email: null, full_name: null },
    ]);

    const result = await getAnnouncementAudience({
      actorProfileId: ADMIN,
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.audienceType).toBe("all_users");
    expect(result.data.baseCount).toBe(2);
    expect(result.data.eligibleCount).toBe(1);
    expect(result.data.invalidCount).toBe(1);
  });

  it("includes historical previous-competition registrations (removed ones too)", async () => {
    queueSelect("competition_participants", [
      {
        profile_id: PROFILE_1,
        profile: { email: "one@example.com", full_name: "One" },
      },
      {
        profile_id: PROFILE_2,
        profile: { email: "two@example.com", full_name: "Two" },
      },
    ]);

    const result = await getAnnouncementAudience({
      actorProfileId: ADMIN,
      audienceType: "previous_competition",
      previousCompetitionId: EVENT_A,
      promotionCompetitionId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.eligibleCount).toBe(2);
  });

  it("excludes users already registered for the promoted competition", async () => {
    queueSelect("competition_participants", [
      {
        profile_id: PROFILE_1,
        profile: { email: "one@example.com", full_name: "One" },
      },
      {
        profile_id: PROFILE_2,
        profile: { email: "two@example.com", full_name: "Two" },
      },
    ]);
    // The promoted competition's ACTIVE registrations.
    queueSelect("competition_participants", [{ profile_id: PROFILE_1 }]);

    const result = await getAnnouncementAudience({
      actorProfileId: ADMIN,
      audienceType: "previous_competition",
      previousCompetitionId: EVENT_A,
      promotionCompetitionId: EVENT_B,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.eligibleCount).toBe(1);
    expect(result.data.excludedRegisteredCount).toBe(1);
    expect(result.data.promotionEventId).toBe(EVENT_B);
  });

  it("rejects an invalid audience selection", async () => {
    const result = await getAnnouncementAudience({
      actorProfileId: ADMIN,
      audienceType: "everyone",
      previousCompetitionId: null,
      promotionCompetitionId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});


describe("FOM-EMAIL-ANNOUNCEMENTS-001: preview", () => {
  it("renders the message with preserved formatting and the promotion link", async () => {
    queueSelect("profiles", [
      { id: PROFILE_1, email: "one@example.com", full_name: "One" },
    ]);
    vi.mocked(resolvePromotionJoinLink).mockResolvedValue({
      ok: true,
      data: {
        eventId: EVENT_B,
        url: PROMO_URL,
        joinLinkId: "link-1",
        created: true,
      },
    });
    vi.mocked(getCompetitionEvent).mockResolvedValue({
      id: EVENT_B,
      name: "Spring Cup",
      status: "active",
    } as never);

    const result = await previewEmailAnnouncement({
      actorProfileId: ADMIN,
      subject: "Join us",
      message: "Hi there,\n\n- Bring boots\n\n**See you**",
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: EVENT_B,
      imageUrl: null,
      origin: "https://fom.example.com",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.audience.eligibleCount).toBe(1);
    expect(result.data.html).toContain("<ul ");
    expect(result.data.html).toContain("<strong>See you</strong>");
    expect(result.data.html).toContain(PROMO_URL);
    expect(result.data.text).toContain("Bring boots");
    expect(result.data.text).toContain(PROMO_URL);
  });

  it("rejects an image URL that is not an uploaded announcement image", async () => {
    queueSelect("profiles", []);

    const result = await previewEmailAnnouncement({
      actorProfileId: ADMIN,
      subject: "Join us",
      message: "Body",
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
      imageUrl: "https://evil.example.com/pixel.png",
      origin: "https://fom.example.com",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: image URL validation", () => {
  it("accepts only URLs inside the announcement image bucket", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    expect(
      isAllowedAnnouncementImageUrl(
        "https://project.supabase.co/storage/v1/object/public/email-announcement-images/announcements/a.png",
      ),
    ).toBe(true);
    expect(
      isAllowedAnnouncementImageUrl(
        "https://project.supabase.co/storage/v1/object/public/player-profile-photos/a.png",
      ),
    ).toBe(false);
    expect(isAllowedAnnouncementImageUrl("https://evil.example.com/a.png")).toBe(
      false,
    );
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });
});


describe("FOM-EMAIL-ANNOUNCEMENTS-001: send", () => {
  it("requires a valid idempotency request id", async () => {
    const result = await sendEmailAnnouncement({
      actorProfileId: ADMIN,
      subject: "Hi",
      message: "Body",
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
      imageUrl: null,
      requestId: "not-a-uuid",
      origin: "https://fom.example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("fails honestly when email is not configured", async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(false);

    const result = await sendEmailAnnouncement({
      actorProfileId: ADMIN,
      subject: "Hi",
      message: "Body",
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
      imageUrl: null,
      requestId: REQUEST_ID,
      origin: "https://fom.example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it("returns the EXISTING batch for a repeated request id (no duplicate send)", async () => {
    queueSelect("email_announcement_batches", {
      id: "existing-batch",
      audience_type: "all_users",
      previous_event_id: null,
      promotion_event_id: null,
      promotion_url: null,
      image_url: null,
      subject: "Hi",
      created_at: "2026-01-01T00:00:00.000Z",
      eligible_count: 2,
      invalid_count: 0,
      duplicate_count: 0,
      excluded_registered_count: 0,
    });
    queueSelect("email_announcement_recipients", [
      { status: "sent" },
      { status: "pending" },
    ]);

    const result = await sendEmailAnnouncement({
      actorProfileId: ADMIN,
      subject: "Hi",
      message: "Body",
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
      imageUrl: null,
      requestId: REQUEST_ID,
      origin: "https://fom.example.com",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe("existing-batch");
    expect(result.data.acceptedCount).toBe(1);
    expect(result.data.pendingCount).toBe(1);
    expect(result.data.state).toBe("processing");
    expect(h.inserts).toHaveLength(0);
  });

  it("queues one recipient row per deliverable address and schedules processing", async () => {
    queueSelect("email_announcement_batches", null);
    queueSelect("profiles", [
      { id: PROFILE_1, email: "one@example.com", full_name: "One" },
      { id: PROFILE_2, email: "two@example.com", full_name: "Two" },
    ]);

    const result = await sendEmailAnnouncement({
      actorProfileId: ADMIN,
      subject: "Hi",
      message: "Body",
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
      imageUrl: null,
      requestId: REQUEST_ID,
      origin: "https://fom.example.com",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.audience.eligibleCount).toBe(2);
    expect(result.data.pendingCount).toBe(2);
    expect(result.data.state).toBe("processing");

    const batchInsert = h.inserts.find(
      (call) => call.table === "email_announcement_batches",
    );
    expect(batchInsert).toBeDefined();
    const payload = batchInsert?.payload as Record<string, unknown>;
    expect(payload.request_id).toBe(REQUEST_ID);
    expect(payload.eligible_count).toBe(2);
    expect(payload.sent_by_profile_id).toBe(ADMIN);

    const recipientInsert = h.inserts.find(
      (call) => call.table === "email_announcement_recipients",
    );
    expect((recipientInsert?.payload as unknown[]).length).toBe(2);
    expect(scheduleAnnouncementProcessing).toHaveBeenCalledTimes(1);
  });

  it("records an empty audience without queuing or sending anything", async () => {
    queueSelect("email_announcement_batches", null);
    queueSelect("profiles", []);

    const result = await sendEmailAnnouncement({
      actorProfileId: ADMIN,
      subject: "Hi",
      message: "Body",
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
      imageUrl: null,
      requestId: REQUEST_ID,
      origin: "https://fom.example.com",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.state).toBe("empty");
    expect(result.data.pendingCount).toBe(0);
    expect(
      h.inserts.find((call) => call.table === "email_announcement_recipients"),
    ).toBeUndefined();
    expect(scheduleAnnouncementProcessing).not.toHaveBeenCalled();
  });
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: batch reads", () => {
  it("refuses a batch read for a non-administrator", async () => {
    const result = await getEmailAnnouncementBatch("batch-1", OUTSIDER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("returns 404 for an unknown batch", async () => {
    queueSelect("email_announcement_batches", null);
    const result = await getEmailAnnouncementBatch("batch-1", ADMIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("refuses to drain a batch for a non-administrator", async () => {
    const result = await processEmailAnnouncementBatch("batch-1", OUTSIDER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

