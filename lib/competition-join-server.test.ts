import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { hashJoinToken } from "@/lib/competition-join";
import {
  getCompetitionJoinByToken,
  createCompetitionJoinLink,
  revokeCompetitionJoinLink,
  registerForCompetition,
  getCompetitionPass,
  isRegisteredForEvent,
} from "@/lib/competition-join-server";

type MockFn = ReturnType<typeof vi.fn>;

interface QueryChain {
  select: MockFn;
  eq: MockFn;
  order: MockFn;
  maybeSingle: MockFn;
  single: MockFn;
  insert: MockFn;
  update: MockFn;
  delete: MockFn;
}

function createChain(): QueryChain {
  const handler = {} as QueryChain;
  handler.select = vi.fn(() => handler);
  handler.eq = vi.fn(() => handler);
  handler.order = vi.fn(() => handler);
  handler.maybeSingle = vi.fn();
  handler.single = vi.fn();
  handler.insert = vi.fn(() => handler);
  handler.update = vi.fn(() => handler);
  handler.delete = vi.fn(() => handler);
  return handler;
}

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_DRAFT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROFILE_1 = "11111111-1111-4111-8111-111111111111";
const PROFILE_2 = "22222222-2222-4222-8222-222222222222";
const PROFILE_NO_MARKETPLACE = "33333333-3333-4333-8333-333333333333";
const AMBASSADOR_A = "amb-aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOIN_TOKEN = "TestJoinToken_AbC123";
const TOKEN_HASH = hashJoinToken(JOIN_TOKEN);

/** Queue a chain whose terminal maybeSingle resolves the result. */
function mockMaybeSingle(result: { data: unknown; error: unknown }) {
  const chain = createChain();
  chain.maybeSingle.mockResolvedValue(result);
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => chain as never);
  return chain;
}

/** Queue a chain whose terminal single resolves the result. */
function mockSingle(result: { data: unknown; error: unknown }) {
  const chain = createChain();
  chain.single.mockResolvedValue(result);
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => chain as never);
  return chain;
}

function activeLinkRow() {
  return {
    id: "link-1",
    event_id: EVENT_A,
    ambassador_id: AMBASSADOR_A,
    revoked_at: null,
    event: {
      id: EVENT_A,
      name: "Juggle Challenge",
      description: null,
      location: "Gilbert, AZ",
      event_date: null,
      status: "active",
      challenge_name: "Juggle Challenge",
      challenge_threshold: 30,
      max_attempts: 3,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("COMP-003: getCompetitionJoinByToken", () => {
  it("hashes the raw token before lookup (never queries with the raw token)", async () => {
    mockMaybeSingle({ data: activeLinkRow(), error: null });
    // ambassador display-name lookup
    mockMaybeSingle({ data: { profile: { full_name: "John Smith" } }, error: null });

    await getCompetitionJoinByToken(JOIN_TOKEN);

    const chain = vi.mocked(supabaseAdmin.from).mock.results[0].value as QueryChain;
    expect(supabaseAdmin.from).toHaveBeenCalledWith("competition_join_links");
    expect(chain.eq).toHaveBeenCalledWith("token_hash", TOKEN_HASH);
    expect(chain.eq).not.toHaveBeenCalledWith("token_hash", JOIN_TOKEN);
  });

  it("resolves the correct event and marks it open for an active event", async () => {
    mockMaybeSingle({ data: activeLinkRow(), error: null });
    mockMaybeSingle({ data: { profile: { full_name: null } }, error: null });

    const join = await getCompetitionJoinByToken(JOIN_TOKEN);
    expect(join?.event.id).toBe(EVENT_A);
    expect(join?.eventOpen).toBe(true);
    expect(join?.state).toBe("active");
  });

  it("resolves the correct ambassador display name", async () => {
    mockMaybeSingle({ data: activeLinkRow(), error: null });
    mockMaybeSingle({ data: { profile: { full_name: "John Smith" } }, error: null });

    const join = await getCompetitionJoinByToken(JOIN_TOKEN);
    expect(join?.ambassador?.full_name).toBe("John Smith");
  });

  it("returns null for an invalid token (no row)", async () => {
    mockMaybeSingle({ data: null, error: null });
    expect(await getCompetitionJoinByToken("nope")).toBeNull();
  });

  it("returns null without querying for an empty token", async () => {
    expect(await getCompetitionJoinByToken("")).toBeNull();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("exposes no token hash, event status, ids, or participant data in the public payload", async () => {
    mockMaybeSingle({ data: activeLinkRow(), error: null });
    mockMaybeSingle({ data: { profile: { full_name: "John Smith" } }, error: null });

    const join = await getCompetitionJoinByToken(JOIN_TOKEN);
    const serialized = JSON.stringify(join);
    expect(serialized).not.toContain("token_hash");
    expect(serialized).not.toContain(TOKEN_HASH);
    expect(serialized).not.toContain("status");
    expect(serialized).not.toContain("created_by");
    expect(serialized).not.toContain("@");
  });

  it("marks a draft event as not open", async () => {
    mockMaybeSingle({
      data: {
        ...activeLinkRow(),
        event: { ...activeLinkRow().event, status: "draft" },
      },
      error: null,
    });
    mockMaybeSingle({ data: { profile: { full_name: null } }, error: null });

    const join = await getCompetitionJoinByToken(JOIN_TOKEN);
    expect(join?.eventOpen).toBe(false);
  });
});

describe("COMP-003: createCompetitionJoinLink", () => {
  it("stores only the token hash and returns the raw token once", async () => {
    // isEventManager → match
    mockMaybeSingle({ data: { id: EVENT_A }, error: null });
    // ambassador belongs to event
    mockMaybeSingle({ data: { id: AMBASSADOR_A, event_id: EVENT_A }, error: null });
    // insert
    const insertChain = mockSingle({
      data: {
        id: "link-1",
        event_id: EVENT_A,
        ambassador_id: AMBASSADOR_A,
        revoked_at: null,
      },
      error: null,
    });

    const result = await createCompetitionJoinLink(EVENT_A, PROFILE_1, AMBASSADOR_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.token).toBeTruthy();
    const inserted = insertChain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.token_hash).toBe(hashJoinToken(result.data.token));
    // The raw token is NEVER written to the database.
    expect(JSON.stringify(inserted)).not.toContain(result.data.token);
    expect(inserted.event_id).toBe(EVENT_A);
    expect(inserted.ambassador_id).toBe(AMBASSADOR_A);
  });

  it("rejects a non-manager (unrelated user cannot create a link)", async () => {
    // isEventManager → no match
    mockMaybeSingle({ data: null, error: null });

    const result = await createCompetitionJoinLink(EVENT_A, PROFILE_2, AMBASSADOR_A);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });

  it("rejects an ambassador that does not belong to the event", async () => {
    mockMaybeSingle({ data: { id: EVENT_A }, error: null });
    mockMaybeSingle({ data: null, error: null });

    const result = await createCompetitionJoinLink(EVENT_A, PROFILE_1, "foreign-amb");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  it("returns 400 when arguments are missing", async () => {
    const result = await createCompetitionJoinLink("", PROFILE_1, AMBASSADOR_A);
    expect(result.ok).toBe(false);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe("COMP-003: revokeCompetitionJoinLink", () => {
  it("sets revoked_at for a manager", async () => {
    mockMaybeSingle({ data: { id: EVENT_A }, error: null });
    const updateChain = mockMaybeSingle({
      data: { id: "link-1", revoked_at: new Date().toISOString() },
      error: null,
    });

    const result = await revokeCompetitionJoinLink(EVENT_A, PROFILE_1, "link-1");
    expect(result.ok).toBe(true);
    const patch = updateChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.revoked_at).toBeTruthy();
  });

  it("rejects a non-manager", async () => {
    mockMaybeSingle({ data: null, error: null });
    const result = await revokeCompetitionJoinLink(EVENT_A, PROFILE_2, "link-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });
});

describe("COMP-003: registerForCompetition", () => {
  it("creates a participant linked to profiles.id (no player_profiles required)", async () => {
    // link lookup (active)
    mockMaybeSingle({
      data: {
        id: "link-1",
        event_id: EVENT_A,
        ambassador_id: AMBASSADOR_A,
        revoked_at: null,
        event: { id: EVENT_A, status: "active" },
        ambassador: { id: AMBASSADOR_A, event_id: EVENT_A },
      },
      error: null,
    });
    // no existing participant
    mockMaybeSingle({ data: null, error: null });
    // insert participant
    const insertChain = mockSingle({
      data: {
        id: "part-1",
        event_id: EVENT_A,
        status: "registered",
        verification_code: "ABCD2345",
      },
      error: null,
    });

    const result = await registerForCompetition(JOIN_TOKEN, PROFILE_NO_MARKETPLACE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const inserted = insertChain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.profile_id).toBe(PROFILE_NO_MARKETPLACE);
    expect(inserted.event_id).toBe(EVENT_A);
    expect(inserted.status).toBe("registered");
    expect(inserted.verification_code).toBeTruthy();
    expect(result.data.alreadyRegistered).toBe(false);
  });

  it("returns 404 for an invalid token", async () => {
    mockMaybeSingle({ data: null, error: null });
    const result = await registerForCompetition("bad", PROFILE_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  it("rejects a revoked link", async () => {
    mockMaybeSingle({
      data: {
        id: "link-1",
        event_id: EVENT_A,
        ambassador_id: AMBASSADOR_A,
        revoked_at: new Date().toISOString(),
        event: { id: EVENT_A, status: "active" },
        ambassador: { id: AMBASSADOR_A, event_id: EVENT_A },
      },
      error: null,
    });

    const result = await registerForCompetition(JOIN_TOKEN, PROFILE_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(410);
  });

  it("rejects a draft event (not accepting registration)", async () => {
    mockMaybeSingle({
      data: {
        id: "link-1",
        event_id: EVENT_DRAFT,
        ambassador_id: AMBASSADOR_A,
        revoked_at: null,
        event: { id: EVENT_DRAFT, status: "draft" },
        ambassador: { id: AMBASSADOR_A, event_id: EVENT_DRAFT },
      },
      error: null,
    });

    const result = await registerForCompetition(JOIN_TOKEN, PROFILE_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
  });

  it.each(["drawing", "completed", "cancelled"] as const)(
    "rejects a %s event",
    async (status) => {
      mockMaybeSingle({
        data: {
          id: "link-1",
          event_id: EVENT_A,
          ambassador_id: AMBASSADOR_A,
          revoked_at: null,
          event: { id: EVENT_A, status },
          ambassador: { id: AMBASSADOR_A, event_id: EVENT_A },
        },
        error: null,
      });

      const result = await registerForCompetition(JOIN_TOKEN, PROFILE_1);
      expect(result.ok).toBe(false);
    },
  );

  it("is idempotent — returns the existing participant without inserting", async () => {
    mockMaybeSingle({
      data: {
        id: "link-1",
        event_id: EVENT_A,
        ambassador_id: AMBASSADOR_A,
        revoked_at: null,
        event: { id: EVENT_A, status: "active" },
        ambassador: { id: AMBASSADOR_A, event_id: EVENT_A },
      },
      error: null,
    });
    // existing participant
    mockMaybeSingle({
      data: {
        id: "part-1",
        event_id: EVENT_A,
        status: "registered",
        verification_code: "ZZZZ2222",
      },
      error: null,
    });

    const result = await registerForCompetition(JOIN_TOKEN, PROFILE_1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.alreadyRegistered).toBe(true);
    expect(result.data.participantId).toBe("part-1");
    // Only the two lookup chains ran — no insert chain was created.
    expect(vi.mocked(supabaseAdmin.from).mock.results).toHaveLength(2);
  });

  it("returns 400 when token or profile is missing", async () => {
    expect((await registerForCompetition("", PROFILE_1)).ok).toBe(false);
    expect((await registerForCompetition(JOIN_TOKEN, "")).ok).toBe(false);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("rejects a link whose ambassador belongs to a different event (defense-in-depth)", async () => {
    mockMaybeSingle({
      data: {
        id: "link-1",
        event_id: EVENT_A,
        ambassador_id: AMBASSADOR_A,
        revoked_at: null,
        event: { id: EVENT_A, status: "active" },
        // Ambassador is attached to a DIFFERENT event than the link.
        ambassador: { id: AMBASSADOR_A, event_id: EVENT_DRAFT },
      },
      error: null,
    });

    const result = await registerForCompetition(JOIN_TOKEN, PROFILE_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });
});

describe("COMP-003: participant pass", () => {
  it("returns the pass for the owning participant", async () => {
    mockMaybeSingle({
      data: {
        id: "part-1",
        event_id: EVENT_A,
        status: "registered",
        verification_code: "ABCD2345",
        checked_in_at: null,
        created_at: new Date().toISOString(),
      },
      error: null,
    });

    const pass = await getCompetitionPass(EVENT_A, PROFILE_NO_MARKETPLACE);
    expect(pass?.participantId).toBe("part-1");
    expect(pass?.verificationCode).toBe("ABCD2345");
  });

  it("returns null when the profile is not registered", async () => {
    mockMaybeSingle({ data: null, error: null });
    expect(await getCompetitionPass(EVENT_A, PROFILE_1)).toBeNull();
  });

  it("does not query when event or profile is missing", async () => {
    expect(await getCompetitionPass("", PROFILE_1)).toBeNull();
    expect(await getCompetitionPass(EVENT_A, "")).toBeNull();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("isRegisteredForEvent is true when a row exists", async () => {
    mockMaybeSingle({ data: { id: "part-1" }, error: null });
    expect(await isRegisteredForEvent(EVENT_A, PROFILE_1)).toBe(true);
  });

  it("isRegisteredForEvent is false when no row exists", async () => {
    mockMaybeSingle({ data: null, error: null });
    expect(await isRegisteredForEvent(EVENT_A, PROFILE_1)).toBe(false);
  });
});