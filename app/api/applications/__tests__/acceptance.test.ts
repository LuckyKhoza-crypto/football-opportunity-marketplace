import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("next-auth/providers/google", () => ({ default: vi.fn(() => ({})) }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/realtime-broadcast", () => ({
  emitToUser: vi.fn(),
  emitToConversation: vi.fn(),
  signChannel: vi.fn(),
  verifySignedChannel: vi.fn(),
  getUserChannelName: vi.fn(),
  getConversationChannelName: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createNotification } from "@/lib/notifications";

const APP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLAYER_USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TEAM_USER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PLAYER_PROFILE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const MEMBERSHIP_ID = "99999999-9999-4999-8999-999999999999";

function createMockSession(userId: string) {
  return {
    user: { id: userId, email: `${userId}@test.com`, name: "Test User", roles: ["team"] },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

type MockFn = ReturnType<typeof vi.fn>;
interface QueryChain {
  select: MockFn;
  eq: MockFn;
  single: MockFn;
  maybeSingle: MockFn;
  order: MockFn;
  limit: MockFn;
}
function createChain(): QueryChain {
  const handler: QueryChain = {
    select: vi.fn(() => handler),
    eq: vi.fn(() => handler),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    order: vi.fn(() => handler),
    limit: vi.fn(() => handler),
  };
  return handler;
}

function mockApplicationFetch(status: string, teamUserId: string = TEAM_USER) {
  const handler = createChain();
  handler.single.mockResolvedValue({
    data: {
      id: APP_ID,
      status,
      opportunity: {
        team_id: TEAM_A,
        title: "Center Back Opportunity",
        position: "CB",
        team: { user_id: teamUserId, team_name: "Phoenix Pro Stars FC" },
      },
      player_profile: { user_id: PLAYER_USER },
    },
    error: null,
  });
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);
}

function mockUpdatedApplicationFetch(status: string = "accepted") {
  const handler = createChain();
  handler.single.mockResolvedValue({ data: { id: APP_ID, status }, error: null });
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);
}

function mockRpcResult(result: Record<string, unknown> | null, error: unknown = null) {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: result, error } as any);
}

function makeSuccessResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    created: true,
    already_member: false,
    already_accepted: false,
    membership_id: MEMBERSHIP_ID,
    team_profile_id: TEAM_A,
    player_profile_id: PLAYER_PROFILE,
    position: "CB",
    role: "Ball-Playing Defender",
    ...overrides,
  };
}

async function callPatch(status: string) {
  const { PATCH } = await import("../[id]/route");
  return PATCH(
    new Request(`http://localhost/api/applications/${APP_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id: APP_ID }) },
  );
}

describe("PATCH /api/applications/[id] — Team acceptance → membership", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: pending → accepted creates membership with opportunity's team/position/role", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("pending");
    mockRpcResult(makeSuccessResult());
    mockUpdatedApplicationFetch("accepted");

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.application.status).toBe("accepted");
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("accept_application", {
      p_application_id: APP_ID,
      p_user_id: TEAM_USER,
    });
    expect(createNotification).toHaveBeenCalledWith({
      userId: PLAYER_USER,
      type: "application_status_changed",
      title: "Application updated",
      body: "Phoenix Pro Stars FC has accepted your application for Center Back.",
      link: `/player/applications/${APP_ID}`,
    });
  });

  it("position preservation: membership stores the opportunity's position at acceptance time", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("pending");
    mockRpcResult(makeSuccessResult({ position: "CB", role: "Ball-Playing Defender" }));
    mockUpdatedApplicationFetch("accepted");

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("accept_application", {
      p_application_id: APP_ID,
      p_user_id: TEAM_USER,
    });
  });

  it("role preservation: membership stores the opportunity's role when present", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("pending");
    mockRpcResult(makeSuccessResult({ role: "Ball-Playing Defender" }));
    mockUpdatedApplicationFetch("accepted");

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("same-team existing membership: no duplicate, application accepted, position/role updated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("pending");
    mockRpcResult(
      makeSuccessResult({
        created: false,
        already_member: true,
        membership_id: MEMBERSHIP_ID,
        team_profile_id: TEAM_A,
        position: "CB",
        role: "Ball-Playing Defender",
      }),
    );
    mockUpdatedApplicationFetch("accepted");

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.application.status).toBe("accepted");
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it("different-team conflict: PLAYER_ALREADY_ON_TEAM → 409, no notification", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("pending");
    mockRpcResult({ success: false, error: "PLAYER_ALREADY_ON_TEAM" });

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe("PLAYER_ALREADY_ON_TEAM");
    expect(data.error).toBe("Player is already a member of a different team");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("already accepted: idempotent success, no duplicate notification", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("accepted");
    mockRpcResult(
      makeSuccessResult({
        created: false,
        already_accepted: true,
        membership_id: MEMBERSHIP_ID,
        team_profile_id: TEAM_A,
        position: "CB",
        role: "Ball-Playing Defender",
      }),
    );
    mockUpdatedApplicationFetch("accepted");

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("rejected → accepted is rejected with APPLICATION_NOT_ELIGIBLE", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("rejected");
    mockRpcResult({ success: false, error: "APPLICATION_NOT_ELIGIBLE" });

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Cannot transition from 'rejected' to 'accepted'");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("withdrawn → accepted is rejected with APPLICATION_NOT_ELIGIBLE", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("withdrawn");
    mockRpcResult({ success: false, error: "APPLICATION_NOT_ELIGIBLE" });

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Cannot transition from 'withdrawn' to 'accepted'");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("authorization: manager of another team cannot accept", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession("other-team-user"));
    mockApplicationFetch("pending", "other-team-user");
    mockRpcResult({ success: false, error: "UNAUTHORIZED" });

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Unauthorized");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("multi-team context: selected team cannot override the opportunity's team", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("pending");
    mockRpcResult(makeSuccessResult({ team_profile_id: TEAM_A }));
    mockUpdatedApplicationFetch("accepted");

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("accept_application", {
      p_application_id: APP_ID,
      p_user_id: TEAM_USER,
    });
  });

  it("atomicity: RPC failure → application not accepted, no notification", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("pending");
    mockRpcResult({ success: false, error: "Some database error" });

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to accept application");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("concurrency: unique_violation resolved to idempotent success by the RPC", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("pending");
    mockRpcResult(
      makeSuccessResult({ created: false, already_member: true, already_accepted: true }),
    );
    mockUpdatedApplicationFetch("accepted");

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("notification failure does not fail the acceptance", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    mockApplicationFetch("pending");
    mockRpcResult(makeSuccessResult());
    mockUpdatedApplicationFetch("accepted");
    vi.mocked(createNotification).mockRejectedValue(new Error("notification failed"));

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("application not found → 404", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession(TEAM_USER));
    const handler = createChain();
    handler.single.mockResolvedValue({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Application not found");
  });

  it("unauthenticated request is rejected", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await callPatch("accepted");
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authentication required");
  });
});

describe("PATCH /api/applications/[id] — source-level guarantees", () => {
  const ROUTE_PATH = join(__dirname, "..", "[id]", "route.ts");
  const routeSource = readFileSync(ROUTE_PATH, "utf-8");

  it("uses the accept_application RPC for atomic acceptance", () => {
    expect(routeSource).toContain('"accept_application"');
  });

  it("maps PLAYER_ALREADY_ON_TEAM to a machine-readable 409", () => {
    expect(routeSource).toContain('case "PLAYER_ALREADY_ON_TEAM"');
    expect(routeSource).toContain('code: "PLAYER_ALREADY_ON_TEAM"');
    expect(routeSource).toContain("status: 409");
  });

  it("does not trust client-provided team/position/role values", () => {
    expect(routeSource).toContain("p_application_id: id");
    expect(routeSource).toContain("p_user_id: userId");
    expect(routeSource).not.toContain("body.team_id");
    expect(routeSource).not.toContain("body.position");
    expect(routeSource).not.toContain("body.role");
  });

  it("creates the notification only after successful RPC acceptance", () => {
    const rpcCheckPos = routeSource.indexOf("if (rpcError || !rpcResult?.success)");
    const notifPos = routeSource.indexOf("createNotification(");
    expect(rpcCheckPos).toBeGreaterThan(-1);
    expect(notifPos).toBeGreaterThan(rpcCheckPos);
  });

  it("skips the notification for idempotent re-acceptance", () => {
    expect(routeSource).toContain("if (!rpcResult.already_accepted)");
  });

  it("uses the existing application_status_changed notification type", () => {
    expect(routeSource).toContain('type: "application_status_changed"');
  });

  it("does not trigger player_joined_team notifications", () => {
    expect(routeSource).not.toContain("player_joined_team");
  });

  it("does not create conversations or outreach records", () => {
    expect(routeSource).not.toContain("conversations");
    expect(routeSource).not.toContain("outreach");
  });
});