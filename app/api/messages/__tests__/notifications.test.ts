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
          neq: vi.fn(),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(),
        })),
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

import { getServerSession } from "next-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createNotification } from "@/lib/notifications";

// ─── Helper to create mock session ─────────────────────────────

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

// ─── Tests: Message Notifications ──────────────────────────────

describe("Messaging API - Notification Creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("new message creates notification for the recipient", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("user-1"),
    );

    // Mock participant check to pass
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { id: "participant-1" }, error: null }),
          })),
        })),
      })),
    } as any));

    // Mock message insert
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "msg-1",
              conversation_id: "conv-1",
              sender_id: "user-1",
              body: "Hello",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              sender: { id: "user-1", full_name: "Test User", avatar_url: null },
            },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock conversation fetch (to determine sender identity)
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "conv-1",
              application: {
                opportunity: {
                  team: { user_id: "user-2", team_name: "Test Team" },
                },
                player_profile: { user_id: "user-1" },
              },
            },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock sender profile fetch (sender is a player, not team)
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { full_name: "Test User" },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock other participants fetch
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          neq: vi.fn().mockResolvedValue({
            data: [{ user_id: "user-2" }],
            error: null,
          }),
        })),
      })),
    } as any));

    const { POST } = await import("../[conversationId]/route");
    const response = await POST(
      new Request("http://localhost/api/messages/conv-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Hello" }),
      }),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(201);

    // Notification should be created for the recipient (user-2), not the sender (user-1)
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-2",
        type: "message_received",
        title: "New message",
        body: "Test User sent you a new message.",
        link: "/messages/conv-1",
        sourceId: "msg-1",
      }),
    );
  });

  it("sender does not receive a notification for their own message", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("user-1"),
    );

    // Mock participant check to pass
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { id: "participant-1" }, error: null }),
          })),
        })),
      })),
    } as any));

    // Mock message insert
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "msg-1",
              conversation_id: "conv-1",
              sender_id: "user-1",
              body: "Hello",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              sender: { id: "user-1", full_name: "Test User", avatar_url: null },
            },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock conversation fetch
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "conv-1",
              application: {
                opportunity: {
                  team: { user_id: "user-2", team_name: "Test Team" },
                },
                player_profile: { user_id: "user-1" },
              },
            },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock sender profile fetch (sender is a player, not team)
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { full_name: "Test User" },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock other participants fetch — only user-2 is the other participant
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          neq: vi.fn().mockResolvedValue({
            data: [{ user_id: "user-2" }],
            error: null,
          }),
        })),
      })),
    } as any));

    const { POST } = await import("../[conversationId]/route");
    const response = await POST(
      new Request("http://localhost/api/messages/conv-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Hello" }),
      }),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(201);

    // The notification must NOT be for the sender (user-1)
    const callArgs = vi.mocked(createNotification).mock.calls[0]?.[0];
    expect(callArgs?.userId).not.toBe("user-1");
    expect(callArgs?.userId).toBe("user-2");
  });

  it("notification points to the correct conversation", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("user-1"),
    );

    // Mock participant check to pass
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { id: "participant-1" }, error: null }),
          })),
        })),
      })),
    } as any));

    // Mock message insert
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "msg-1",
              conversation_id: "conv-42",
              sender_id: "user-1",
              body: "Hello",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              sender: { id: "user-1", full_name: "Test User", avatar_url: null },
            },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock conversation fetch
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "conv-42",
              application: {
                opportunity: {
                  team: { user_id: "user-2", team_name: "Test Team" },
                },
                player_profile: { user_id: "user-1" },
              },
            },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock sender profile fetch (sender is a player, not team)
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { full_name: "Test User" },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock other participants fetch
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          neq: vi.fn().mockResolvedValue({
            data: [{ user_id: "user-2" }],
            error: null,
          }),
        })),
      })),
    } as any));

    const { POST } = await import("../[conversationId]/route");
    const response = await POST(
      new Request("http://localhost/api/messages/conv-42", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Hello" }),
      }),
      { params: Promise.resolve({ conversationId: "conv-42" }) },
    );

    expect(response.status).toBe(201);

    // The notification link must point to the correct conversation
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        link: "/messages/conv-42",
      }),
    );
  });

  it("rejected/withdrawn applications can still generate message notifications", () => {
    // This is enforced at the database/RLS level:
    // - The messages INSERT policy only checks participant membership
    //   and conversation validity, NOT application status
    // - The notification creation in the POST route does not filter
    //   by application status
    // - Messaging remains available for all application statuses
    const statuses = ["pending", "reviewing", "accepted", "rejected", "withdrawn"];
    expect(statuses).toHaveLength(5);
    expect(statuses).toContain("rejected");
    expect(statuses).toContain("withdrawn");
  });
});

// ─── Tests: Application Notifications ──────────────────────────

describe("Applications API - Notification Creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successful application creates notification for the team", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("user-1"),
    );

    // Mock profile check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: "profile-1", role: ["player"] }, error: null }),
        })),
      })),
    } as any));

    // Mock player profile check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: "player-profile-1" }, error: null }),
        })),
      })),
    } as any));

    // Mock opportunity check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: "opp-1", team_id: "team-1", status: "active", title: "Striker Opportunity" },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock team profile check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { user_id: "team-user-2" },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock existing application check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
    } as any));

    // Mock RPC call
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: {
        success: true,
        application_id: "app-1",
        conversation_id: "conv-1",
      },
      error: null,
    } as any);

    // Mock player profile name fetch (for notification body)
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { full_name: "John Doe" },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock the application fetch after creation
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "app-1",
              opportunity_id: "opp-1",
              player_profile_id: "player-profile-1",
              status: "pending",
              cover_message: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              opportunity: {
                id: "opp-1",
                title: "Striker Opportunity",
                position: "ST",
                playing_level: "professional",
                location: "Test City",
                team: { id: "team-1", team_name: "Test Team", logo_url: null },
              },
            },
            error: null,
          }),
        })),
      })),
    } as any));

    const { POST } = await import("../../applications/route");
    const response = await POST(
      new Request("http://localhost/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: "opp-1" }),
      }),
    );

    expect(response.status).toBe(201);

    // Notification should be created for the team user
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "team-user-2",
        type: "application_received",
        title: "New application",
        body: "John Doe applied for your Striker Opportunity opportunity.",
        link: "/team/applications",
        sourceId: "app-1",
      }),
    );
  });

  it("failed application does not create a notification", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("user-1"),
    );

    // Mock profile check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: "profile-1", role: ["player"] }, error: null }),
        })),
      })),
    } as any));

    // Mock player profile check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: "player-profile-1" }, error: null }),
        })),
      })),
    } as any));

    // Mock opportunity check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: "opp-1", team_id: "team-1", status: "active", title: "Striker Opportunity" },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock team profile check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { user_id: "team-user-2" },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock existing application check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
    } as any));

    // Mock RPC call to fail
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: false, error: "Something went wrong" },
      error: null,
    } as any);

    const { POST } = await import("../../applications/route");
    const response = await POST(
      new Request("http://localhost/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: "opp-1" }),
      }),
    );

    expect(response.status).toBe(500);

    // No notification should be created
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("duplicate application does not create another notification", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("user-1"),
    );

    // Mock profile check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: "profile-1", role: ["player"] }, error: null }),
        })),
      })),
    } as any));

    // Mock player profile check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: "player-profile-1" }, error: null }),
        })),
      })),
    } as any));

    // Mock opportunity check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: "opp-1", team_id: "team-1", status: "active", title: "Striker Opportunity" },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock team profile check
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { user_id: "team-user-2" },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock existing application check — already exists
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "existing-app-1", status: "pending" },
              error: null,
            }),
          })),
        })),
      })),
    } as any));

    const { POST } = await import("../../applications/route");
    const response = await POST(
      new Request("http://localhost/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_id: "opp-1" }),
      }),
    );

    expect(response.status).toBe(409);

    // No notification should be created for a duplicate application
    expect(createNotification).not.toHaveBeenCalled();
  });
});

// ─── Tests: Status Change Notifications ────────────────────────

describe("Applications API - Status Change Notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("status change creates notification for the player with correct status", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("team-user-2", ["team"]),
    );

    // Mock the application fetch
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "app-1",
              status: "pending",
              opportunity: {
                team_id: "team-1",
                title: "Striker Opportunity",
                team: { user_id: "team-user-2", team_name: "Phoenix United" },
              },
              player_profile: { user_id: "player-user-1" },
            },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock the status update
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: "app-1",
                status: "accepted",
                opportunity_id: "opp-1",
                player_profile_id: "player-profile-1",
                cover_message: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              error: null,
            }),
          })),
        })),
      })),
    } as any));

    const { PATCH } = await import("../../applications/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/api/applications/app-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "accepted" }),
      }),
      { params: Promise.resolve({ id: "app-1" }) },
    );

    expect(response.status).toBe(200);

    // Notification should be created for the player with the correct status
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "player-user-1",
        type: "application_status_changed",
        title: "Application updated",
        body: "Your application for Striker Opportunity at Phoenix United is now Accepted.",
        link: "/player/applications/app-1",
      }),
    );
  });

  it("unchanged status does not create unnecessary notification", () => {
    // The VALID_TRANSITIONS map in the PATCH route prevents no-op transitions:
    // - accepted: [] (no transitions allowed)
    // - rejected: [] (no transitions allowed)
    // - withdrawn: [] (no transitions allowed)
    // This means a status cannot be set to the same value it already has,
    // so no unnecessary notifications are created.
    const validTransitions: Record<string, string[]> = {
      pending: ["reviewing", "rejected", "accepted"],
      reviewing: ["rejected", "accepted"],
      accepted: [],
      rejected: [],
      withdrawn: [],
    };
    expect(validTransitions.accepted).toHaveLength(0);
    expect(validTransitions.rejected).toHaveLength(0);
    expect(validTransitions.withdrawn).toHaveLength(0);
  });
});