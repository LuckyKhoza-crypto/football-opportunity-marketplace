import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the auth module
vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

// Mock getServerSession
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

import { canManageMultipleTeams, getMultiTeamAdminUserId } from "@/lib/multi-team";
import { getServerSession } from "next-auth";

describe("canManageMultipleTeams", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns false when MULTI_TEAM_ADMIN_USER_ID is not set", () => {
    delete process.env.MULTI_TEAM_ADMIN_USER_ID;
    expect(canManageMultipleTeams("user-1")).toBe(false);
  });

  it("returns true for the configured admin user", () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = "admin-user-123";
    expect(canManageMultipleTeams("admin-user-123")).toBe(true);
  });

  it("returns false for non-admin users", () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = "admin-user-123";
    expect(canManageMultipleTeams("regular-user-456")).toBe(false);
  });

  it("returns false for empty user ID", () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = "admin-user-123";
    expect(canManageMultipleTeams("")).toBe(false);
  });

  it("getMultiTeamAdminUserId returns the configured value", () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = "admin-user-123";
    expect(getMultiTeamAdminUserId()).toBe("admin-user-123");
  });

  it("getMultiTeamAdminUserId returns null when not set", () => {
    delete process.env.MULTI_TEAM_ADMIN_USER_ID;
    expect(getMultiTeamAdminUserId()).toBeNull();
  });
});

describe("isMultiTeamAdmin (server-side session check)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns false when no session", async () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = "admin-user-123";
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { isMultiTeamAdmin } = await import("@/lib/multi-team");
    expect(await isMultiTeamAdmin()).toBe(false);
  });

  it("returns false when session has no user ID", async () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = "admin-user-123";
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { email: "test@example.com" },
    });

    const { isMultiTeamAdmin } = await import("@/lib/multi-team");
    expect(await isMultiTeamAdmin()).toBe(false);
  });

  it("returns true when session user is the admin", async () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = "admin-user-123";
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "admin-user-123", email: "admin@example.com" },
    });

    const { isMultiTeamAdmin } = await import("@/lib/multi-team");
    expect(await isMultiTeamAdmin()).toBe(true);
  });

  it("returns false when session user is not the admin", async () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = "admin-user-123";
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "regular-user-456", email: "user@example.com" },
    });

    const { isMultiTeamAdmin } = await import("@/lib/multi-team");
    expect(await isMultiTeamAdmin()).toBe(false);
  });
});