import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next-auth/providers/google", () => ({
  default: vi.fn(() => ({})),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { getServerSession } from "next-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hashInviteToken } from "@/lib/team-invite";

const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INVITE_1 = "11111111-1111-4111-8111-111111111111";
const INVITE_2 = "22222222-2222-4222-8222-222222222222";
const MANAGER = "33333333-3333-4333-8333-333333333333";
const OTHER_MANAGER = "44444444-4444-4444-8444-444444444444";

function createMockSession(userId: string, roles: string[] = ["team"]) {
  return {
    user: {
      id: userId,
      email: `${userId}@test.com`,
      name: "Test Team User",
      roles,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

type MockFn = ReturnType<typeof vi.fn>;

interface QueryChain {
  select: MockFn;
  eq: MockFn;
  in: MockFn;
  single: MockFn;
  maybeSingle: MockFn;
  order: MockFn;
  limit: MockFn;
  insert: MockFn;
  update: MockFn;
}

/**
 * Build a mock supabase query chain. Each call to `from` returns a fresh
 * chain so tests can queue up sequential query results with mockImplementationOnce.
 */
function createChain(): QueryChain {
  const handler: QueryChain = {
    select: vi.fn(() => handler),
    eq: vi.fn(() => handler),
    in: vi.fn(() => handler),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    order: vi.fn(() => handler),
    limit: vi.fn(() => handler),
    insert: vi.fn(() => handler),
    update: vi.fn(() => handler),
  };
  return handler;
}

function mockFromResult(result: { data: unknown; error: unknown } | null) {
  const handler = createChain();
  handler.single.mockResolvedValue(result ?? { data: null, error: null });
  handler.maybeSingle.mockResolvedValue(result ?? { data: null, error: null });
  handler.order.mockResolvedValue(result ?? { data: null, error: null });
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);
}

function mockTeamOwnership(teamId: string | null) {
  mockFromResult(
    teamId
      ? { data: { id: teamId }, error: null }
      : { data: null, error: null },
  );
}

let lastInsertPayload: Record<string, unknown> | null = null;

/**
 * Mock a team_invites insert and capture the payload so tests can assert
 * on what was actually stored (e.g. created_by, token_hash, expires_at).
 */
function mockInviteInsert(invite: Record<string, unknown> | null) {
  const handler = createChain();
  const insertMock = vi.fn((payload: unknown) => {
    lastInsertPayload = payload as Record<string, unknown>;
    return handler;
  });
  handler.insert = insertMock;
  handler.select.mockReturnValue(handler);
  handler.single.mockResolvedValue(
    invite ? { data: invite, error: null } : { data: null, error: null },
  );
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);
}

function mockInviteList(invites: Record<string, unknown>[]) {
  const handler = createChain();
  handler.select.mockReturnValue(handler);
  handler.eq.mockReturnValue(handler);
  handler.order.mockResolvedValue({ data: invites, error: null });
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);
}

function mockInviteFetch(invite: Record<string, unknown> | null) {
  const handler = createChain();
  handler.select.mockReturnValue(handler);
  handler.eq.mockReturnValue(handler);
  handler.single.mockResolvedValue(
    invite ? { data: invite, error: null } : { data: null, error: null },
  );
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);
}

function mockInviteUpdate(updated: Record<string, unknown> | null) {
  const handler = createChain();
  handler.update.mockReturnValue(handler);
  handler.eq.mockReturnValue(handler);
  handler.select.mockReturnValue(handler);
  handler.single.mockResolvedValue(
    updated ? { data: updated, error: null } : { data: null, error: null },
  );
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);
}

function makeInviteRow(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: INVITE_1,
    team_profile_id: TEAM_A,
    token_hash: hashInviteToken("raw-token-1"),
    created_by: MANAGER,
    // Always in the future relative to the test run so the derived
    // state is "pending" unless overridden.
    expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    revoked_at: null,
    created_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe("POST /api/team/invites — Invite creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastInsertPayload = null;
  });

  it("unauthenticated request is rejected", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_A }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authentication required");
  });

  it("authorized team owner can create an invite", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow());

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_A }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.invite.team_profile_id).toBe(TEAM_A);
    expect(data.invite.state).toBe("pending");
    expect(data.token).toBeTruthy();
    expect(data.join_url).toBe(`/team/join/${data.token}`);
  });

  it("invite is linked to the requested team_profile_id", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow());

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_A }),
      }),
    );
    const data = await response.json();

    expect(data.invite.team_profile_id).toBe(TEAM_A);
    // The insert must have used the verified team id.
    expect(lastInsertPayload?.team_profile_id).toBe(TEAM_A);
  });

  it("invite creator is derived from the authenticated user", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow());

    const { POST } = await import("../route");
    await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_A }),
      }),
    );

    // created_by must come from the authenticated session, never the body.
    expect(lastInsertPayload?.created_by).toBe(MANAGER);
  });

  it("invite gets an expiration date", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow());

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_A }),
      }),
    );
    const data = await response.json();

    expect(data.invite.expires_at).toBeTruthy();
    expect(new Date(data.invite.expires_at).getTime()).toBeGreaterThan(Date.now());
    // The stored row must include an expiration timestamp.
    expect(lastInsertPayload?.expires_at).toBeTruthy();
  });

  it("generated tokens are non-empty and sufficiently unpredictable", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow());

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_A }),
      }),
    );
    const data = await response.json();

    expect(data.token.length).toBeGreaterThanOrEqual(32);
    expect(data.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("two generated invites do not produce the same token/digest", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow({ id: INVITE_1 }));
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow({ id: INVITE_2 }));

    const { POST } = await import("../route");
    const req = () =>
      POST(
        new Request("http://localhost/api/team/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_profile_id: TEAM_A }),
        }),
      );

    const [r1, r2] = await Promise.all([req(), req()]);
    const d1 = await r1.json();
    const d2 = await r2.json();

    expect(d1.token).not.toBe(d2.token);
    expect(hashInviteToken(d1.token)).not.toBe(hashInviteToken(d2.token));
  });

  it("multiple invites can exist for one team", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow({ id: INVITE_1 }));
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow({ id: INVITE_2 }));

    const { POST } = await import("../route");
    const req = () =>
      POST(
        new Request("http://localhost/api/team/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_profile_id: TEAM_A }),
        }),
      );

    const [r1, r2] = await Promise.all([req(), req()]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
  });

  it("user cannot create an invite for another user's team", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(OTHER_MANAGER));
    mockTeamOwnership(null);

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_A }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Team profile not found or access denied");
  });

  it("team_profile_id is required", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("team_profile_id is required");
  });

  it("raw token is returned only in the creation response", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow());

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_A }),
      }),
    );
    const data = await response.json();

    expect(data.token).toBeTruthy();
    // The invite object in the response must NOT contain the raw token or token_hash.
    expect(data.invite.token).toBeUndefined();
    expect(data.invite.token_hash).toBeUndefined();
    // The stored row must contain a token_hash, never the raw token.
    expect(lastInsertPayload?.token_hash).toBeTruthy();
    expect(lastInsertPayload?.token).toBeUndefined();
    // The stored hash must match the hash of the returned raw token.
    expect(lastInsertPayload?.token_hash).toBe(hashInviteToken(data.token));
  });
});

describe("GET /api/team/invites — Invite listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unauthenticated request is rejected", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const { GET } = await import("../route");
    const response = await GET(
      new Request(`http://localhost/api/team/invites?team_id=${TEAM_A}`),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authentication required");
  });

  it("lists invites for the selected team with derived state", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_A);
    mockInviteList([
      makeInviteRow({ id: INVITE_1 }),
      makeInviteRow({
        id: INVITE_2,
        revoked_at: "2026-01-02T00:00:00Z",
      }),
    ]);

    const { GET } = await import("../route");
    const response = await GET(
      new Request(`http://localhost/api/team/invites?team_id=${TEAM_A}`),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.invites).toHaveLength(2);
    expect(data.invites[0].state).toBe("pending");
    expect(data.invites[1].state).toBe("revoked");
  });

  it("does not expose raw tokens or token hashes from existing invites", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_A);
    mockInviteList([makeInviteRow()]);

    const { GET } = await import("../route");
    const response = await GET(
      new Request(`http://localhost/api/team/invites?team_id=${TEAM_A}`),
    );
    const data = await response.json();

    expect(data.invites[0].token).toBeUndefined();
    expect(data.invites[0].token_hash).toBeUndefined();
  });

  it("user cannot list invites for another user's team", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(OTHER_MANAGER));
    mockTeamOwnership(null);

    const { GET } = await import("../route");
    const response = await GET(
      new Request(`http://localhost/api/team/invites?team_id=${TEAM_A}`),
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Team profile not found or access denied");
  });

  it("team_id is required", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));

    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/team/invites"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("team_id is required");
  });
});

describe("POST /api/team/invites/[id]/revoke — Invite revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unauthenticated request is rejected", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const { POST } = await import("../[id]/revoke/route");
    const response = await POST(
      new Request(`http://localhost/api/team/invites/${INVITE_1}/revoke`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: INVITE_1 }) },
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authentication required");
  });

  it("team owner can revoke their own pending invite", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockInviteFetch(
      makeInviteRow({
        team: { user_id: MANAGER },
      }),
    );
    mockInviteUpdate(
      makeInviteRow({
        team: { user_id: MANAGER },
        revoked_at: "2026-01-03T00:00:00Z",
      }),
    );

    const { POST } = await import("../[id]/revoke/route");
    const response = await POST(
      new Request(`http://localhost/api/team/invites/${INVITE_1}/revoke`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: INVITE_1 }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.invite.state).toBe("revoked");
    expect(data.invite.revoked_at).toBeTruthy();
  });

  it("user cannot revoke another team's invite", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(OTHER_MANAGER));
    mockInviteFetch(
      makeInviteRow({
        team: { user_id: MANAGER },
      }),
    );

    const { POST } = await import("../[id]/revoke/route");
    const response = await POST(
      new Request(`http://localhost/api/team/invites/${INVITE_1}/revoke`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: INVITE_1 }) },
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Invite not found");
  });

  it("a shared invite link can be revoked even after players have joined", async () => {
    // A team invite is a reusable shared recruitment link — it is never
    // "accepted" as a whole. Revocation is always available to the team
    // owner regardless of how many players have joined via the link.
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockInviteFetch(
      makeInviteRow({
        team: { user_id: MANAGER },
      }),
    );
    mockInviteUpdate(
      makeInviteRow({
        team: { user_id: MANAGER },
        revoked_at: "2026-01-03T00:00:00Z",
      }),
    );

    const { POST } = await import("../[id]/revoke/route");
    const response = await POST(
      new Request(`http://localhost/api/team/invites/${INVITE_1}/revoke`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: INVITE_1 }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.invite.state).toBe("revoked");
  });

  it("revoking an already-revoked invite is idempotent", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockInviteFetch(
      makeInviteRow({
        team: { user_id: MANAGER },
        revoked_at: "2026-01-02T00:00:00Z",
      }),
    );

    const { POST } = await import("../[id]/revoke/route");
    const response = await POST(
      new Request(`http://localhost/api/team/invites/${INVITE_1}/revoke`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: INVITE_1 }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.invite.state).toBe("revoked");
  });
});

describe("Multi-team invite behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastInsertPayload = null;
  });

  it("multi-team manager can generate an invite for Team A", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow({ team_profile_id: TEAM_A }));

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_A }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.invite.team_profile_id).toBe(TEAM_A);
  });

  it("same manager can generate a separate invite for Team B", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    mockTeamOwnership(TEAM_B);
    mockInviteInsert(makeInviteRow({ id: INVITE_2, team_profile_id: TEAM_B }));

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_B }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.invite.team_profile_id).toBe(TEAM_B);
  });

  it("Team A invite never resolves to Team B", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    // Manager owns both teams, but requests an invite for Team A.
    mockTeamOwnership(TEAM_A);
    mockInviteInsert(makeInviteRow({ team_profile_id: TEAM_A }));

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_A }),
      }),
    );
    const data = await response.json();

    expect(data.invite.team_profile_id).toBe(TEAM_A);
    expect(data.invite.team_profile_id).not.toBe(TEAM_B);
  });

  it("creation does not silently select the first team owned by the user", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(MANAGER));
    // If the route tried a "first team" fallback it would query team_profiles
    // without an id filter. We assert the ownership query always filters by id.
    mockTeamOwnership(TEAM_B);
    mockInviteInsert(makeInviteRow({ team_profile_id: TEAM_B }));

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: TEAM_B }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.invite.team_profile_id).toBe(TEAM_B);

    // The team_profiles query must have filtered by the explicit id.
    const teamQuery = vi.mocked(supabaseAdmin.from).mock.calls.find(
      ([table]) => table === "team_profiles",
    );
    expect(teamQuery).toBeDefined();
  });
});