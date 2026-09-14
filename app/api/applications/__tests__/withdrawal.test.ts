import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next-auth
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

// Mock supabase-admin
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
          order: vi.fn(),
        })),
        in: vi.fn(),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(),
          })),
        })),
      })),
      rpc: vi.fn(),
    })),
    rpc: vi.fn(),
  },
}));

// Mock next-auth/providers/google
vi.mock("next-auth/providers/google", () => ({
  default: vi.fn(() => ({})),
}));

// Mock notifications utility
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
}));

// Mock realtime broadcast
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

function createMockSession(userId: string, roles: string[] = ["player"]) {
  return {
    user: {
      id: userId,
      email: `${userId}@test.com`,
      name: "Test User",
      roles,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

function mockApplicationFetch(status: string, playerUserId: string, teamUserId: string) {
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: "app-1",
            status,
            opportunity: {
              team_id: "team-1",
              title: "Test Opportunity",
              team: { user_id: teamUserId, team_name: "Test Team" },
            },
            player_profile: { user_id: playerUserId },
          },
          error: null,
        }),
      })),
    })),
  } as any));
}

function mockUpdateSuccess() {
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: "app-1", status: "withdrawn" },
            error: null,
          }),
        })),
      })),
    })),
  } as any));
}

describe("Application Withdrawal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pending → withdrawn succeeds", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession("player-user"));
    mockApplicationFetch("pending", "player-user", "team-user");
    mockUpdateSuccess();

    const { PATCH } = await import("../[id]/route");
    const response = await PATCH(
      new Request("http://localhost/api/applications/app-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      }),
      { params: Promise.resolve({ id: "app-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("reviewing → withdrawn succeeds", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession("player-user"));
    mockApplicationFetch("reviewing", "player-user", "team-user");
    mockUpdateSuccess();

    const { PATCH } = await import("../[id]/route");
    const response = await PATCH(
      new Request("http://localhost/api/applications/app-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      }),
      { params: Promise.resolve({ id: "app-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("accepted → withdrawn is rejected", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession("player-user"));
    mockApplicationFetch("accepted", "player-user", "team-user");

    const { PATCH } = await import("../[id]/route");
    const response = await PATCH(
      new Request("http://localhost/api/applications/app-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      }),
      { params: Promise.resolve({ id: "app-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Cannot transition");
  });

  it("rejected → withdrawn is rejected", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession("player-user"));
    mockApplicationFetch("rejected", "player-user", "team-user");

    const { PATCH } = await import("../[id]/route");
    const response = await PATCH(
      new Request("http://localhost/api/applications/app-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      }),
      { params: Promise.resolve({ id: "app-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Cannot transition");
  });

  it("withdrawn → withdrawn is rejected", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession("player-user"));
    mockApplicationFetch("withdrawn", "player-user", "team-user");

    const { PATCH } = await import("../[id]/route");
    const response = await PATCH(
      new Request("http://localhost/api/applications/app-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      }),
      { params: Promise.resolve({ id: "app-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Cannot transition");
  });

  it("only the application owner can withdraw", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession("other-user"));
    mockApplicationFetch("pending", "player-user", "team-user");

    const { PATCH } = await import("../[id]/route");
    const response = await PATCH(
      new Request("http://localhost/api/applications/app-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      }),
      { params: Promise.resolve({ id: "app-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Unauthorized");
  });

  it("teams cannot withdraw applications", async () => {
    vi.mocked(getServerSession).mockResolvedValue(createMockSession("team-user"));
    mockApplicationFetch("pending", "player-user", "team-user");

    const { PATCH } = await import("../[id]/route");
    const response = await PATCH(
      new Request("http://localhost/api/applications/app-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      }),
      { params: Promise.resolve({ id: "app-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Teams cannot withdraw applications");
  });
});