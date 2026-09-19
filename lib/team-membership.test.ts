import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  TEAM_MEMBERSHIP_STATUS,
  isMembershipForTeam,
  isMembershipForPlayer,
  isActiveMembership,
  filterActiveMemberships,
  canAccessMembershipForTeam,
} from "@/lib/team-membership";
import type { TeamMembership } from "@/types";

// ─── Test fixtures ──────────────────────────────────────────────

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0013_team_memberships.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

/**
 * Extract only the CREATE TABLE statement from the migration and strip
 * `--` comment lines. Schema assertions are scoped to this block so that
 * comments in the migration (which reference future constraints and
 * player_profiles fields for documentation purposes) cannot cause false
 * negatives.
 */
function getCreateTableBlock(sql: string): string {
  const start = sql.indexOf("CREATE TABLE IF NOT EXISTS team_memberships");
  const end = sql.indexOf(");", start);
  const block = sql.slice(start, end);
  return block
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function createMembership(overrides: Partial<TeamMembership> = {}): TeamMembership {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    team_profile_id: "22222222-2222-4222-8222-222222222222",
    player_profile_id: "33333333-3333-4333-8333-333333333333",
    position: "Goalkeeper",
    role: "Starting Goalkeeper",
    status: "active",
    joined_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── Database / schema expectations ─────────────────────────────

describe("TEAM-001: team_memberships migration", () => {
  const sql = readMigration();

  it("creates the team_memberships table", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS team_memberships");
  });

  it("uses a UUID primary key consistent with the existing schema", () => {
    expect(sql).toContain("id UUID PRIMARY KEY DEFAULT gen_random_uuid()");
  });

  it("references team_profiles via team_profile_id with ON DELETE CASCADE", () => {
    expect(sql).toContain(
      "team_profile_id UUID NOT NULL REFERENCES team_profiles(id) ON DELETE CASCADE",
    );
  });

  it("references player_profiles via player_profile_id with ON DELETE CASCADE", () => {
    expect(sql).toContain(
      "player_profile_id UUID NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE",
    );
  });

  it("does NOT put team_id directly on player_profiles", () => {
    const tableBlock = getCreateTableBlock(sql);
    // The FK column is team_profile_id, not a team_id column on player_profiles.
    expect(tableBlock).toContain("team_profile_id UUID NOT NULL REFERENCES team_profiles(id)");
    expect(tableBlock).not.toContain("team_id");
    // The migration must not alter player_profiles at all.
    expect(sql).not.toContain("ALTER TABLE player_profiles");
    expect(sql).not.toContain("ADD COLUMN");
  });

  it("does NOT modify profiles.role to represent membership", () => {
    expect(sql).not.toContain("ALTER TABLE profiles");
  });

  it("enforces the MVP one-player-one-team constraint via a named unique index on player_profile_id", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS team_memberships_player_profile_id_key",
    );
    expect(sql).toContain("ON team_memberships (player_profile_id)");
  });

  it("is designed so the future multi-team constraint can replace the MVP constraint", () => {
    const tableBlock = getCreateTableBlock(sql);
    // The future model (player → many teams) is UNIQUE(team_profile_id, player_profile_id).
    // The CREATE TABLE block must not add any constraint that would prevent it —
    // e.g. no UNIQUE(team_profile_id) (which would block a team from having many players).
    expect(tableBlock).not.toMatch(/UNIQUE\s*\(\s*team_profile_id\s*\)/);
    // The composite constraint is NOT created today (we only need it once multi-team
    // membership lands), but nothing in the schema blocks it later.
    expect(tableBlock).not.toMatch(/UNIQUE\s*\(\s*team_profile_id\s*,\s*player_profile_id\s*\)/);
    // The migration documents the future replacement path.
    expect(sql).toContain("UNIQUE (team_profile_id, player_profile_id)");
  });

  it("adds an index for 'all members of a team'", () => {
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS team_memberships_team_profile_id_idx");
    expect(sql).toContain("ON team_memberships (team_profile_id)");
  });

  it("includes position and role independent of the player's general profile fields", () => {
    const tableBlock = getCreateTableBlock(sql);
    expect(tableBlock).toContain("position TEXT");
    expect(tableBlock).toContain("role TEXT");
    // No column in the table is derived from player_profiles.positions / preferred_role.
    expect(tableBlock).not.toContain("preferred_role");
  });

  it("includes status with an MVP-friendly CHECK supporting 'active'", () => {
    expect(sql).toContain("status TEXT NOT NULL DEFAULT 'active'");
    expect(sql).toContain("CHECK (status IN ('active'))");
  });

  it("includes joined_at, created_at, and updated_at timestamps with defaults", () => {
    expect(sql).toContain("joined_at TIMESTAMPTZ DEFAULT now()");
    expect(sql).toContain("created_at TIMESTAMPTZ DEFAULT now()");
    expect(sql).toContain("updated_at TIMESTAMPTZ DEFAULT now()");
  });

  it("enables row level security", () => {
    expect(sql).toContain("ALTER TABLE team_memberships ENABLE ROW LEVEL SECURITY");
  });

  it("scopes team RLS policies to the specific team_profile_id (multi-team safe)", () => {
    // The ownership check must resolve through team_profiles.user_id
    // for the SPECIFIC team_profile_id, never assume one team per user.
    const teamPolicyChecks = sql.match(
      /tp\.id = team_memberships\.team_profile_id\s+AND\s+tp\.user_id::text = auth\.uid\(\)::text/g,
    );
    // SELECT + INSERT + UPDATE + DELETE policies
    expect(teamPolicyChecks).toHaveLength(4);
  });

  it("adds a player policy allowing players to view their own memberships", () => {
    expect(sql).toContain("CREATE POLICY \"Player can view own team memberships\"");
  });

  it("adds an updated_at trigger", () => {
    expect(sql).toContain("CREATE TRIGGER set_team_memberships_updated_at");
    expect(sql).toContain("EXECUTE FUNCTION update_updated_at_column()");
  });
});

// ─── Helper behavior ────────────────────────────────────────────

describe("TEAM-001: team-membership helper", () => {
  describe("isMembershipForTeam", () => {
    it("returns true when team_profile_id matches", () => {
      expect(
        isMembershipForTeam(createMembership(), "22222222-2222-4222-8222-222222222222"),
      ).toBe(true);
    });

    it("returns false for a different team (multi-team scoping)", () => {
      const membership = createMembership();
      expect(isMembershipForTeam(membership, "99999999-9999-4999-8999-999999999999")).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(isMembershipForTeam(null, "team-1")).toBe(false);
      expect(isMembershipForTeam(undefined, "team-1")).toBe(false);
    });
  });

  describe("isMembershipForPlayer", () => {
    it("returns true when player_profile_id matches", () => {
      expect(
        isMembershipForPlayer(createMembership(), "33333333-3333-4333-8333-333333333333"),
      ).toBe(true);
    });

    it("returns false for a different player", () => {
      const membership = createMembership();
      expect(isMembershipForPlayer(membership, "player-2")).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(isMembershipForPlayer(null, "player-1")).toBe(false);
    });
  });

  describe("isActiveMembership", () => {
    it("returns true for status 'active'", () => {
      expect(isActiveMembership(createMembership())).toBe(true);
    });

    it("returns false when status is null/undefined", () => {
      expect(isActiveMembership(null)).toBe(false);
      expect(isActiveMembership(undefined)).toBe(false);
    });
  });

  describe("filterActiveMemberships", () => {
    it("returns only active memberships", () => {
      const memberships = [
        createMembership({ id: "m-1", status: "active" }),
        createMembership({ id: "m-2", status: "active" }),
      ];
      const result = filterActiveMemberships(memberships);
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(["m-1", "m-2"]);
    });

    it("excludes non-active memberships", () => {
      const memberships = [
        createMembership({ id: "m-1", status: "active" }),
        // Simulate a future non-active status (e.g. 'inactive') — the
        // type only allows 'active' today, but the helper must still
        // defensively exclude anything that isn't active.
        { ...createMembership({ id: "m-2" }), status: "inactive" as const },
      ] as unknown as TeamMembership[];
      const result = filterActiveMemberships(memberships);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("m-1");
    });

    it("returns an empty array for null/undefined", () => {
      expect(filterActiveMemberships(null)).toEqual([]);
      expect(filterActiveMemberships(undefined)).toEqual([]);
    });

    it("returns an empty array for an empty list", () => {
      expect(filterActiveMemberships([])).toEqual([]);
    });

    it("preserves the original order of active memberships", () => {
      const memberships = [
        createMembership({ id: "m-1", status: "active" }),
        createMembership({ id: "m-2", status: "active" }),
        createMembership({ id: "m-3", status: "active" }),
      ];
      expect(filterActiveMemberships(memberships).map((m) => m.id)).toEqual([
        "m-1",
        "m-2",
        "m-3",
      ]);
    });
  });

  describe("canAccessMembershipForTeam (multi-team authorization)", () => {
    it("allows access when the manager owns the membership's team", () => {
      const membership = createMembership({ team_profile_id: "team-a" });
      expect(canAccessMembershipForTeam(membership, ["team-a", "team-b"])).toBe(true);
    });

    it("denies access when the manager owns other teams only", () => {
      const membership = createMembership({ team_profile_id: "team-a" });
      // Manager owns Team B and Team C, but NOT Team A.
      expect(canAccessMembershipForTeam(membership, ["team-b", "team-c"])).toBe(false);
    });

    it("does NOT collapse a multi-team manager's teams", () => {
      // One manager, two teams, two players each — the membership for
      // Team A must not be accessible via Team B, and vice versa.
      const teamAMemberships = [
        createMembership({ id: "m-1", team_profile_id: "team-a", player_profile_id: "p1" }),
        createMembership({ id: "m-2", team_profile_id: "team-a", player_profile_id: "p2" }),
      ];
      const teamBMemberships = [
        createMembership({ id: "m-3", team_profile_id: "team-b", player_profile_id: "p3" }),
        createMembership({ id: "m-4", team_profile_id: "team-b", player_profile_id: "p4" }),
      ];
      const ownedTeamIds = ["team-a", "team-b"];

      for (const m of [...teamAMemberships, ...teamBMemberships]) {
        expect(canAccessMembershipForTeam(m, ownedTeamIds)).toBe(m.team_profile_id === "team-a" || m.team_profile_id === "team-b");
      }

      // Membership referencing Team A is not accessible through Team B's scope alone.
      expect(canAccessMembershipForTeam(teamAMemberships[0], ["team-b"])).toBe(false);
      expect(canAccessMembershipForTeam(teamBMemberships[0], ["team-a"])).toBe(false);
    });

    it("returns false for null/undefined membership or empty team list", () => {
      expect(canAccessMembershipForTeam(null, ["team-a"])).toBe(false);
      expect(canAccessMembershipForTeam(createMembership(), [])).toBe(false);
    });
  });

  describe("MVP status constant", () => {
    it("is 'active' and typed as the canonical status", () => {
      expect(TEAM_MEMBERSHIP_STATUS).toBe("active");
      // It matches the DB CHECK constraint's only allowed value.
      const sql = readMigration();
      expect(sql).toContain(`CHECK (status IN ('${TEAM_MEMBERSHIP_STATUS}'))`);
    });
  });
});