import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next-auth/providers/google", () => ({
  default: vi.fn(() => ({})),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createNotification } from "@/lib/notifications";
import { hashInviteToken } from "@/lib/team-invite";

const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBERSHIP_1 = "99999999-9999-4999-8999-999999999999";
const PLAYER_1 = "55555555-5555-4555-8555-555555555555";
const PLAYER_2 = "66666666-6666-4666-8666-666666666666";
const TEAM_OWNER = "33333333-3333-4333-8333-333333333333";
const RAW_TOKEN = "raw-token-abc-123";

function createMockSession(userId: string, roles: string[] = ["player"]) {
  return {
    user: {
      id: userId,
      email: `${userId}@test.com`,
      name: "Test Player",
      roles,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

type MockFn = ReturnType<typeof vi.fn>;

interface QueryChain {
  select: MockFn;
  eq: MockFn;
  single: MockFn;
  maybeSingle: MockFn;
}

function createChain(): QueryChain {
  const handler: QueryChain = {
    select: vi.fn(() => handler),
    eq: vi.fn(() => handler),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  return handler;
}

function mockProfileLookup(profile: { id: string } | null) {
  const handler = createChain();
  handler.single.mockResolvedValue(
    profile ? { data: profile, error: null } : { data: null, error: null },
  );
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);
}

function mockPlayerProfileLookup(playerProfile: { id: string } | null) {
  const handler = createChain();
  handler.single.mockResolvedValue(
    playerProfile ? { data: playerProfile, error: null } : { data: null, error: null },
  );
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);
}

function mockPlayerNameLookup(fullName: string | null) {
  const handler = createChain();
  handler.single.mockResolvedValue({
    data: { full_name: fullName },
    error: null,
  });
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);
}

function mockRpcResult(result: Record<string, unknown> | null, error: unknown = null) {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
    data: result,
    error,
  } as any);
}

function makeSuccessResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    created: true,
    already_member: false,
    membership_id: MEMBERSHIP_1,
    team_profile_id: TEAM_A,
    team_user_id: TEAM_OWNER,
    team_name: "Phoenix Pro Stars FC",
    ...overrides,
  };
}

describe("POST /api/team/join — Shared invite link acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unauthenticated request is rejected", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authentication required");
  });

  it("token is required", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("token is required");
  });

  it("player without a player profile is rejected", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup(null);

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Player profile not found");
  });

  it("hashes the raw token before calling the RPC", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup({ id: "player-profile-1" });
    mockRpcResult(makeSuccessResult());

    const { POST } = await import("../route");
    await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("accept_team_invite", {
      p_token_hash: hashInviteToken(RAW_TOKEN),
      p_player_profile_id: "player-profile-1",
      p_user_id: PLAYER_1,
    });
  });

  it("Player A accepts the invite → membership created + team notified", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup({ id: "player-profile-1" });
    mockRpcResult(makeSuccessResult());
    mockPlayerNameLookup("Alice");

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.created).toBe(true);
    expect(data.membership_id).toBe(MEMBERSHIP_1);
    expect(data.team_profile_id).toBe(TEAM_A);

    // Team must receive a notification identifying the player, team, and invite link.
    expect(createNotification).toHaveBeenCalledWith({
      userId: TEAM_OWNER,
      type: "player_joined_team",
      title: "New player joined your team",
      body: "Alice joined Phoenix Pro Stars FC through your team's invite link.",
      link: "/team/players",
      sourceId: MEMBERSHIP_1,
    });
  });

  it("Player B accepts the same invite → second membership created + team notified", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_2));
    mockProfileLookup({ id: PLAYER_2 });
    mockPlayerProfileLookup({ id: "player-profile-2" });
    mockRpcResult(
      makeSuccessResult({
        membership_id: "88888888-8888-4888-8888-888888888888",
      }),
    );
    mockPlayerNameLookup("Bob");

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.created).toBe(true);
    expect(data.membership_id).toBe("88888888-8888-4888-8888-888888888888");

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEAM_OWNER,
        type: "player_joined_team",
        body: "Bob joined Phoenix Pro Stars FC through your team's invite link.",
        sourceId: "88888888-8888-4888-8888-888888888888",
      }),
    );
  });

  it("same player accepts twice → idempotent success, no duplicate membership, no duplicate notification", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup({ id: "player-profile-1" });
    mockRpcResult(
      makeSuccessResult({
        created: false,
        already_member: true,
      }),
    );

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.created).toBe(false);
    expect(data.already_member).toBe(true);

    // No notification for idempotent re-acceptance.
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("player already on a different team → rejected with PLAYER_ALREADY_ON_TEAM", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup({ id: "player-profile-1" });
    mockRpcResult({
      success: false,
      error: "PLAYER_ALREADY_ON_TEAM",
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe("You are already a member of a different team");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("revoked invite → rejected for everyone", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup({ id: "player-profile-1" });
    mockRpcResult({
      success: false,
      error: "INVITE_REVOKED",
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("This invitation has been revoked");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("expired invite → rejected for everyone", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup({ id: "player-profile-1" });
    mockRpcResult({
      success: false,
      error: "INVITE_EXPIRED",
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("This invitation has expired");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("unknown invite → 404", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup({ id: "player-profile-1" });
    mockRpcResult({
      success: false,
      error: "INVITE_NOT_FOUND",
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Invitation not found");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("failed acceptance → no membership and no notification", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup({ id: "player-profile-1" });
    mockRpcResult({
      success: false,
      error: "Some database error",
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Some database error");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("concurrent duplicate acceptance by the same player → only one membership (RPC unique_violation path)", async () => {
    // The RPC handles unique_violation by re-checking and returning
    // idempotent success. The route must not create a duplicate notification.
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup({ id: "player-profile-1" });
    mockRpcResult(
      makeSuccessResult({
        created: false,
        already_member: true,
      }),
    );

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.created).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("concurrent acceptance by multiple different players → each eligible player can join", async () => {
    // Simulate two different players accepting the same invite concurrently.
    // Each RPC call returns a distinct membership for its own player.
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup({ id: "player-profile-1" });
    mockRpcResult(
      makeSuccessResult({
        membership_id: MEMBERSHIP_1,
      }),
    );
    mockPlayerNameLookup("Alice");

    const { POST } = await import("../route");
    const response1 = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data1 = await response1.json();

    expect(response1.status).toBe(201);
    expect(data1.created).toBe(true);
    expect(data1.membership_id).toBe(MEMBERSHIP_1);

    // Player 2 accepts the same invite.
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_2));
    mockProfileLookup({ id: PLAYER_2 });
    mockPlayerProfileLookup({ id: "player-profile-2" });
    mockRpcResult(
      makeSuccessResult({
        membership_id: "88888888-8888-4888-8888-888888888888",
      }),
    );
    mockPlayerNameLookup("Bob");

    const response2 = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data2 = await response2.json();

    expect(response2.status).toBe(201);
    expect(data2.created).toBe(true);
    expect(data2.membership_id).toBe("88888888-8888-4888-8888-888888888888");

    // Two separate notifications, one per membership.
    expect(createNotification).toHaveBeenCalledTimes(2);
  });

  it("notification failure does not fail the membership creation", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(PLAYER_1));
    mockProfileLookup({ id: PLAYER_1 });
    mockPlayerProfileLookup({ id: "player-profile-1" });
    mockRpcResult(makeSuccessResult());
    mockPlayerNameLookup("Alice");
    vi.mocked(createNotification).mockRejectedValue(new Error("notification failed"));

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: RAW_TOKEN }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.created).toBe(true);
  });
});

describe("POST /api/team/join — source-level guarantees", () => {
  const ROUTE_PATH = join(__dirname, "..", "route.ts");
  const routeSource = readFileSync(ROUTE_PATH, "utf-8");

  it("route never mutates the invite (shared link remains usable)", () => {
    expect(routeSource).not.toContain('from("team_invites")');
    expect(routeSource).not.toContain("accepted_at");
    expect(routeSource).not.toContain("accepted_by");
  });

  it("route creates the notification only after a successful membership creation", () => {
    // The notification block must be guarded by result.created.
    expect(routeSource).toContain("if (result.created && result.team_user_id)");
  });

  it("route uses the existing notification system (createNotification)", () => {
    expect(routeSource).toContain('from "@/lib/notifications"');
    expect(routeSource).toContain("createNotification(");
  });

  it("route uses the existing accept_team_invite RPC for atomicity", () => {
    expect(routeSource).toContain('"accept_team_invite"');
  });

  it("route maps PLAYER_ALREADY_ON_TEAM to a 409", () => {
    expect(routeSource).toContain('case "PLAYER_ALREADY_ON_TEAM"');
    expect(routeSource).toContain("status: 409");
  });
});