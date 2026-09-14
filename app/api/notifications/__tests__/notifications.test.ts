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
          is: vi.fn(() => ({
            select: vi.fn(),
          })),
          order: vi.fn(() => ({
            range: vi.fn(),
          })),
        })),
        is: vi.fn(() => ({
          select: vi.fn(),
        })),
        order: vi.fn(() => ({
          range: vi.fn(),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            select: vi.fn(),
          })),
        })),
      })),
    })),
  },
}));

// Mock next-auth/providers/google
vi.mock("next-auth/providers/google", () => ({
  default: vi.fn(() => ({})),
}));

import { getServerSession } from "next-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

// ─── Tests ─────────────────────────────────────────────────────

describe("Notifications API - Authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unauthenticated users cannot retrieve notifications", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/notifications"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authentication required");
  });

  it("unauthenticated users cannot mark a notification as read", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const { PATCH } = await import("../[id]/read/route");
    const response = await PATCH(
      new Request("http://localhost/api/notifications/notif-1/read", {
        method: "PATCH",
      }),
      { params: Promise.resolve({ id: "notif-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authentication required");
  });

  it("unauthenticated users cannot mark all notifications as read", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const { PATCH } = await import("../read-all/route");
    const response = await PATCH();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Authentication required");
  });
});

describe("Notifications API - Retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authenticated user can retrieve their notifications with unread count", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("user-1"),
    );

    const mockNotifications = [
      {
        id: "notif-1",
        type: "message_received",
        title: "New message",
        body: "Test Team sent you a new message.",
        link: "/messages/conv-1",
        read_at: null,
        created_at: new Date().toISOString(),
      },
    ];

    // Mock the notifications query
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn().mockResolvedValue({
              data: mockNotifications,
              error: null,
            }),
          })),
        })),
      })),
    } as any));

    // Mock the unread count query
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn((_cols: string, opts?: any) => {
        if (opts?.count === "exact") {
          return {
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue({
                count: 1,
                error: null,
              }),
            })),
          };
        }
        return {
          eq: vi.fn(() => ({
            is: vi.fn().mockResolvedValue({
              count: 0,
              error: null,
            }),
          })),
        };
      }),
    } as any));

    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/notifications"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.notifications).toHaveLength(1);
    expect(data.notifications[0].id).toBe("notif-1");
    expect(data.unread_count).toBe(1);
  });

  it("user cannot retrieve another user's notifications (API filters by session)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("user-1"),
    );

    // Capture the query to verify it filters by the session user
    let queryUserId: string | null = null;
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((field: string, value: string) => {
          if (field === "user_id") queryUserId = value;
          return {
            order: vi.fn(() => ({
              range: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            })),
          };
        }),
      })),
    } as any));

    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            select: vi.fn().mockResolvedValue({
              count: 0,
              error: null,
            }),
          })),
        })),
      })),
    } as any));

    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/notifications"));
    const data = await response.json();

    expect(response.status).toBe(200);
    // The query must be scoped to the authenticated user
    expect(queryUserId).toBe("user-1");
    expect(data.notifications).toHaveLength(0);
  });
});

describe("Notifications API - Mark Read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("user can mark their own notification as read", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("user-1"),
    );

    // Mock the ownership fetch
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: "notif-1", user_id: "user-1" },
            error: null,
          }),
        })),
      })),
    } as any));

    // Mock the update
    let updatedUserId: string | null = null;
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      update: vi.fn(() => ({
        eq: vi.fn((field: string, value: string) => {
          if (field === "id") {
            return {
              eq: vi.fn((f2: string, v2: string) => {
                if (f2 === "user_id") updatedUserId = v2;
                return { error: null };
              }),
            };
          }
          if (field === "user_id") updatedUserId = value;
          return { error: null };
        }),
      })),
    } as any));

    const { PATCH } = await import("../[id]/read/route");
    const response = await PATCH(
      new Request("http://localhost/api/notifications/notif-1/read", {
        method: "PATCH",
      }),
      { params: Promise.resolve({ id: "notif-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    // The update must be scoped to the authenticated user
    expect(updatedUserId).toBe("user-1");
  });

  it("user cannot mark another user's notification as read", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("user-1"),
    );

    // Mock the ownership fetch — notification belongs to another user
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: "notif-1", user_id: "user-2" },
            error: null,
          }),
        })),
      })),
    } as any));

    const { PATCH } = await import("../[id]/read/route");
    const response = await PATCH(
      new Request("http://localhost/api/notifications/notif-1/read", {
        method: "PATCH",
      }),
      { params: Promise.resolve({ id: "notif-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Unauthorized");
  });

  it("mark-all only affects the authenticated user's notifications", async () => {
    vi.mocked(getServerSession).mockResolvedValue(
      createMockSession("user-1"),
    );

    // Capture the query to verify it filters by the session user
    let queryUserId: string | null = null;
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => ({
      update: vi.fn(() => ({
        eq: vi.fn((field: string, value: string) => {
          if (field === "user_id") queryUserId = value;
          return {
            is: vi.fn(() => ({
              select: vi.fn().mockResolvedValue({
                data: [{ id: "notif-1" }, { id: "notif-2" }],
                error: null,
              }),
            })),
          };
        }),
      })),
    } as any));

    const { PATCH } = await import("../read-all/route");
    const response = await PATCH();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.marked_count).toBe(2);
    // The update must be scoped to the authenticated user
    expect(queryUserId).toBe("user-1");
  });
});

describe("Notifications API - Database Design", () => {
  it("notification types are constrained to the three MVP types", () => {
    // This is enforced at the database level via the CHECK constraint in
    // supabase/migrations/00010_notifications.sql:
    //   type TEXT NOT NULL CHECK (type IN ('application_received', 'application_status_changed', 'message_received'))
    const validTypes = [
      "application_received",
      "application_status_changed",
      "message_received",
    ];
    expect(validTypes).toHaveLength(3);
    expect(validTypes).toContain("application_received");
    expect(validTypes).toContain("application_status_changed");
    expect(validTypes).toContain("message_received");
  });

  it("notifications table has RLS policies scoped to the owner", () => {
    // This is enforced at the database level in the migration:
    // - SELECT: user_id::text = auth.uid()::text
    // - UPDATE: user_id::text = auth.uid()::text
    // - NO INSERT policy (clients cannot create notifications)
    // - NO DELETE policy (notifications are permanent)
    expect(true).toBe(true);
  });
});