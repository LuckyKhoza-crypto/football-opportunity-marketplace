import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { getSelectedTeamId, withTeamParam } from "@/lib/team-context";

describe("getSelectedTeamId", () => {
  it("returns null when no team param", () => {
    expect(getSelectedTeamId(new URLSearchParams())).toBeNull();
  });

  it("returns the team ID from URLSearchParams", () => {
    const params = new URLSearchParams("team=123e4567-e89b-12d3-a456-426614174000");
    expect(getSelectedTeamId(params)).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("returns null for invalid UUID format", () => {
    expect(getSelectedTeamId(new URLSearchParams("team=not-a-uuid"))).toBeNull();
  });

  it("returns the team ID from a plain object", () => {
    expect(getSelectedTeamId({ team: "123e4567-e89b-12d3-a456-426614174000" })).toBe(
      "123e4567-e89b-12d3-a456-426614174000",
    );
  });

  it("returns null when team is an array", () => {
    expect(getSelectedTeamId({ team: ["123e4567-e89b-12d3-a456-426614174000"] })).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getSelectedTeamId({ team: "" })).toBeNull();
  });
});

describe("withTeamParam", () => {
  it("returns path unchanged when no teamId", () => {
    expect(withTeamParam("/team", null)).toBe("/team");
    expect(withTeamParam("/team", undefined)).toBe("/team");
  });

  it("appends team param to path without query", () => {
    expect(withTeamParam("/team", "team-123")).toBe("/team?team=team-123");
  });

  it("appends team param to path with existing query", () => {
    expect(withTeamParam("/team?tab=active", "team-123")).toBe(
      "/team?tab=active&team=team-123",
    );
  });

  it("encodes the team ID", () => {
    expect(withTeamParam("/team", "team 123")).toBe("/team?team=team%20123");
  });
});