import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn(() => chain),
        single: vi.fn(),
        maybeSingle: vi.fn(),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        insert: vi.fn(() => chain),
        update: vi.fn(() => chain),
      };
      return chain;
    }),
    rpc: vi.fn(),
  },
}));

vi.mock("next-auth/providers/google", () => ({
  default: vi.fn(() => ({})),
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({}),
}));

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

function mockSingleResult(data: unknown) {
  return vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      single: vi.fn().mockResolvedValue({ data, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn(() => chain),
    } as any;
    return chain;
  });
}

describe("Outreach API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unauthenticated users cannot create outreach", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_profile_id: "player-1",
          opportunity_id: "opp-1",
          message: "Hello",
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authentication required");
  });

  it("team can create outreach for its own opportunity", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession("team-user"));

    // 1. Team profile
    mockSingleResult({
      id: "team-1",
      team_name: "Test Team",
      user_id: "team-user",
    });

    // 2. Player profile
    mockSingleResult({
      id: "player-1",
      user_id: "player-user",
    });

    // 3. Opportunity
    mockSingleResult({
      id: "opp-1",
      team_id: "team-1",
      title: "Test Opp",
      status: "active",
    });

    // 4. Existing outreach check
    mockSingleResult(null);

    // 5. Player name for notification
    mockSingleResult({ full_name: "Test Player" });

    // Mock RPC
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: {
        success: true,
        outreach_id: "outreach-1",
        conversation_id: "conv-1",
        message_id: "msg-1",
      },
      error: null,
    } as any);

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_profile_id: "player-1",
          opportunity_id: "opp-1",
          message: "Hey John, we'd love to talk!",
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.outreach_id).toBe("outreach-1");
    expect(data.conversation_id).toBe("conv-1");

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "create_outreach_with_initial_message",
      expect.objectContaining({
        p_opportunity_id: "opp-1",
        p_player_profile_id: "player-1",
        p_initial_message: "Hey John, we'd love to talk!",
        p_user_id: "team-user",
      }),
    );
  });

  it("team cannot create outreach for another team's opportunity", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession("team-user"));

    mockSingleResult({
      id: "team-1",
      team_name: "Test Team",
      user_id: "team-user",
    });

    mockSingleResult({
      id: "player-1",
      user_id: "player-user",
    });

    mockSingleResult({
      id: "opp-1",
      team_id: "other-team",
      title: "Other Team Opp",
      status: "active",
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_profile_id: "player-1",
          opportunity_id: "opp-1",
          message: "Hello",
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Opportunity does not belong to this team");
  });

  it("blank messages are rejected", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession("team-user"));

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_profile_id: "player-1",
          opportunity_id: "opp-1",
          message: "   ",
        }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Initial message is required");
  });
});