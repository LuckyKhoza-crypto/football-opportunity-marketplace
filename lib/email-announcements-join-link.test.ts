import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

interface Query {
  table: string;
  filters: Array<[string, unknown]>;
}

const h = vi.hoisted(() => ({
  selectQueues: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
  selects: [] as Query[],
  inserts: [] as Array<{ table: string; payload: unknown }>,
  insertResults: {} as Record<string, { data: unknown; error: unknown }>,
  updates: [] as Array<{
    table: string;
    payload: unknown;
    eq: [string, unknown];
  }>,
  upserts: [] as Array<{ table: string; payload: unknown; options: unknown }>,
  upsertResults: {} as Record<string, { data: unknown; error: unknown }>,
  deletes: [] as Array<{ table: string; eq: [string, unknown] }>,
}));

vi.mock("@/lib/supabase-admin", () => {
  const makeChain = (
    table: string,
    result: { data: unknown; error: unknown },
  ) => {
    const entry: Query = { table, filters: [] };
    const chain: Record<string, unknown> = {
      eq: (column: string, value: unknown) => {
        entry.filters.push([column, value]);
        return chain;
      },
      is: (column: string, value: unknown) => {
        entry.filters.push([column, value]);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => result,
      single: async () => result,
      then: (resolve: (value: unknown) => unknown) => resolve(result),
    };
    return chain;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => ({
        select: (columns?: string) => {
          void columns;
          const queue = h.selectQueues[table];
          const result =
            queue && queue.length > 0
              ? queue.shift()!
              : { data: null, error: null };
          h.selects.push({ table, filters: [] });
          return makeChain(table, result);
        },
        insert: (payload: unknown) => {
          h.inserts.push({ table, payload });
          const result = h.insertResults[table] ?? {
            data: { id: "inserted-id" },
            error: null,
          };
          return {
            select: () => ({ single: async () => result }),
            then: (resolve: (value: unknown) => unknown) => resolve(result),
          };
        },
        update: (payload: unknown) => ({
          eq: async (column: string, value: unknown) => {
            h.updates.push({ table, payload, eq: [column, value] });
            return { data: null, error: null };
          },
        }),
        upsert: (payload: unknown, options: unknown) => {
          h.upserts.push({ table, payload, options });
          const result =
            h.upsertResults[table] ?? { data: [payload], error: null };
          const chain = {
            select: () => chain,
            then: (resolve: (value: unknown) => unknown) => resolve(result),
          };
          return chain;
        },
        delete: () => ({
          eq: async (column: string, value: unknown) => {
            h.deletes.push({ table, eq: [column, value] });
            return { data: null, error: null };
          },
        }),
      }),
    },
  };
});

vi.mock("@/lib/competition-server", () => ({
  isCompetitionCreationAdmin: (profileId: string | null | undefined) =>
    profileId === ADMIN,
  getCompetitionEvent: vi.fn(),
}));

import { resolvePromotionJoinLink } from "@/lib/email-announcements-join-link";
import { getCompetitionEvent } from "@/lib/competition-server";
import { hashJoinToken } from "@/lib/competition-join";
import { resolvePublicAppOrigin } from "@/lib/competition-public-origin";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — hybrid promotion registration-link tests.
 *
 * Verifies: admin-only authorization, closed/unknown competition handling, reuse
 * of an already-resolved active link, creation when none exists (with an
 * ambassador), the actionable no-ambassador error, regeneration after
 * revocation, and concurrency-safe cleanup of a losing duplicate link.
 */

const ADMIN = "admin-1111-4111-8111-111111111111";
const EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AMBASSADOR = "amb-2222-4222-8222-222222222222";
const LINK_ONE = "11111111-aaaa-4aaa-8aaa-111111111111";
const LINK_WINNER = "22222222-bbbb-4bbb-8bbb-222222222222";
const ORIGIN = "https://fom.example.com";
const CACHE = "email_announcement_promotion_links";
const JOIN_LINKS = "competition_join_links";
const AMBASSADORS = "competition_ambassadors";

function queueSelect(table: string, result: { data: unknown; error: unknown }) {
  const queue = h.selectQueues[table] ?? [];
  queue.push(result);
  h.selectQueues[table] = queue;
}

beforeEach(() => {
  h.selectQueues = {};
  h.selects = [];
  h.inserts = [];
  h.insertResults = {};
  h.updates = [];
  h.upserts = [];
  h.upsertResults = {};
  h.deletes = [];
  vi.mocked(getCompetitionEvent).mockReset();
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: promotion join link", () => {
  it("rejects a caller who is not the administrator", async () => {
    const result = await resolvePromotionJoinLink(EVENT, "someone-else", ORIGIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(h.inserts).toHaveLength(0);
  });

  it("returns 404 for an unknown competition", async () => {
    vi.mocked(getCompetitionEvent).mockResolvedValue(null);
    const result = await resolvePromotionJoinLink(EVENT, ADMIN, ORIGIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("returns 409 when the competition is not open for registration", async () => {
    vi.mocked(getCompetitionEvent).mockResolvedValue({
      id: EVENT,
      name: "Draft Cup",
      status: "draft",
    } as never);

    const result = await resolvePromotionJoinLink(EVENT, ADMIN, ORIGIN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/not currently accepting registrations/i);
    }
    expect(h.inserts).toHaveLength(0);
  });

  it("creates and caches a new link when none has been resolved yet", async () => {
    vi.mocked(getCompetitionEvent).mockResolvedValue({
      id: EVENT,
      name: "Spring Cup",
      status: "active",
    } as never);

    queueSelect(CACHE, { data: null, error: null });
    queueSelect(AMBASSADORS, { data: { id: AMBASSADOR }, error: null });
    h.insertResults[JOIN_LINKS] = { data: { id: LINK_ONE }, error: null };

    const result = await resolvePromotionJoinLink(EVENT, ADMIN, ORIGIN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created).toBe(true);
    expect(result.data.joinLinkId).toBe(LINK_ONE);
    expect(result.data.url).toMatch(
      /^https:\/\/fom\.example\.com\/competitions\/join\/[A-Za-z0-9_-]+$/,
    );

    // The link is owned by the competition's ambassador and only the SHA-256
    // digest is persisted.
    const insert = h.inserts.find((call) => call.table === JOIN_LINKS);
    const payload = insert?.payload as {
      event_id: string;
      ambassador_id: string;
      token_hash: string;
    };
    expect(payload.event_id).toBe(EVENT);
    expect(payload.ambassador_id).toBe(AMBASSADOR);
    const token = result.data.url.split("/competitions/join/")[1];
    expect(payload.token_hash).toBe(hashJoinToken(token));
    expect(JSON.stringify(payload)).not.toContain(token);

    // The resolved URL is cached for reuse (first caller wins).
    const upsert = h.upserts.find((call) => call.table === CACHE);
    expect(upsert).toBeDefined();
    expect(
      (upsert?.options as { onConflict?: string; ignoreDuplicates?: boolean })
        .ignoreDuplicates,
    ).toBe(true);
  });

  it("returns an actionable error when the competition has no ambassador", async () => {
    vi.mocked(getCompetitionEvent).mockResolvedValue({
      id: EVENT,
      name: "Spring Cup",
      status: "active",
    } as never);

    queueSelect(CACHE, { data: null, error: null });
    queueSelect(AMBASSADORS, { data: null, error: null });

    const result = await resolvePromotionJoinLink(EVENT, ADMIN, ORIGIN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/ambassador/i);
    }
    expect(h.inserts).toHaveLength(0);
  });


  it("reuses an already-resolved active link without creating another", async () => {
    vi.mocked(getCompetitionEvent).mockResolvedValue({
      id: EVENT,
      name: "Spring Cup",
      status: "active",
    } as never);

    const existingUrl = `${ORIGIN}/competitions/join/existing-token`;
    queueSelect(CACHE, {
      data: {
        event_id: EVENT,
        join_link_id: LINK_ONE,
        raw_url: existingUrl,
        link: { id: LINK_ONE, revoked_at: null },
      },
      error: null,
    });

    const result = await resolvePromotionJoinLink(EVENT, ADMIN, ORIGIN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created).toBe(false);
    expect(result.data.url).toBe(existingUrl);
    expect(result.data.joinLinkId).toBe(LINK_ONE);
    expect(h.inserts).toHaveLength(0);
    expect(h.upserts).toHaveLength(0);
  });

  it("regenerates and re-caches after the cached link is revoked", async () => {
    vi.mocked(getCompetitionEvent).mockResolvedValue({
      id: EVENT,
      name: "Spring Cup",
      status: "active",
    } as never);

    queueSelect(CACHE, {
      data: {
        event_id: EVENT,
        join_link_id: LINK_ONE,
        raw_url: `${ORIGIN}/competitions/join/revoked-token`,
        link: { id: LINK_ONE, revoked_at: "2020-01-01T00:00:00.000Z" },
      },
      error: null,
    });
    queueSelect(AMBASSADORS, { data: { id: AMBASSADOR }, error: null });
    h.insertResults[JOIN_LINKS] = { data: { id: LINK_WINNER }, error: null };

    const result = await resolvePromotionJoinLink(EVENT, ADMIN, ORIGIN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created).toBe(true);
    expect(result.data.joinLinkId).toBe(LINK_WINNER);
    expect(result.data.url).not.toContain("revoked-token");

    const update = h.updates.find((call) => call.table === CACHE);
    expect(update).toBeDefined();
    expect(update?.eq).toEqual(["event_id", EVENT]);
  });

  it("discards its own link when a concurrent caller wins the cache race", async () => {
    vi.mocked(getCompetitionEvent).mockResolvedValue({
      id: EVENT,
      name: "Spring Cup",
      status: "active",
    } as never);

    queueSelect(CACHE, { data: null, error: null });
    queueSelect(AMBASSADORS, { data: { id: AMBASSADOR }, error: null });
    h.insertResults[JOIN_LINKS] = { data: { id: LINK_ONE }, error: null };

    const winnerUrl = `${ORIGIN}/competitions/join/winner-token`;
    h.upsertResults[CACHE] = {
      data: [
        { event_id: EVENT, join_link_id: LINK_WINNER, raw_url: winnerUrl },
      ],
      error: null,
    };

    const result = await resolvePromotionJoinLink(EVENT, ADMIN, ORIGIN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created).toBe(false);
    expect(result.data.url).toBe(winnerUrl);
    expect(result.data.joinLinkId).toBe(LINK_WINNER);
    expect(h.deletes).toEqual([{ table: JOIN_LINKS, eq: ["id", LINK_ONE] }]);
  });
});


describe("FOM-EMAIL-ANNOUNCEMENTS-001: public origin safety (no localhost links)", () => {
  const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const prevNextUrl = process.env.NEXTAUTH_URL;

  afterEach(() => {
    if (prevAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
    if (prevNextUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = prevNextUrl;
  });

  it("resolves the configured public origin instead of a localhost request origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.fom-sports.com";
    delete process.env.NEXTAUTH_URL;
    expect(resolvePublicAppOrigin("http://localhost:3000")).toBe(
      "https://www.fom-sports.com",
    );
  });

  it("refuses to build a link from a loopback origin when no public URL is configured", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXTAUTH_URL;

    const result = await resolvePromotionJoinLink(
      EVENT,
      ADMIN,
      "http://localhost:3000",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/public URL is not configured/i);
    }
    // Nothing is created and nothing is cached.
    expect(h.inserts).toHaveLength(0);
    expect(h.upserts).toHaveLength(0);
  });

  it("still allows an explicitly configured localhost URL (local dev)", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    vi.mocked(getCompetitionEvent).mockResolvedValue({
      id: EVENT,
      name: "Spring Cup",
      status: "active",
    } as never);

    queueSelect(CACHE, { data: null, error: null });
    queueSelect(AMBASSADORS, { data: { id: AMBASSADOR }, error: null });
    h.insertResults[JOIN_LINKS] = { data: { id: LINK_ONE }, error: null };

    const result = await resolvePromotionJoinLink(
      EVENT,
      ADMIN,
      "http://localhost:3000",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.url).toMatch(
        /^http:\/\/localhost:3000\/competitions\/join\//,
      );
    }
  });
});

