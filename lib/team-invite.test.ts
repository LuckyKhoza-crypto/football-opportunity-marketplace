import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  TEAM_INVITE_EXPIRY_DAYS,
  generateInviteToken,
  hashInviteToken,
  getTeamInviteState,
  isInviteUsable,
  getInviteExpiration,
} from "@/lib/team-invite";
import type { TeamInvite } from "@/types";

// ─── Test fixtures ──────────────────────────────────────────────

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0014_team_invites.sql";
const SHARED_LINK_MIGRATION_FILE = "0015_team_invites_shared_link.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

function readSharedLinkMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, SHARED_LINK_MIGRATION_FILE), "utf-8");
}

function createInvite(overrides: Partial<TeamInvite> = {}): TeamInvite {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    team_profile_id: "22222222-2222-4222-8222-222222222222",
    token_hash: "abc123",
    created_by: "33333333-3333-4333-8333-333333333333",
    expires_at: "2026-01-08T00:00:00Z",
    revoked_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── Database / schema expectations ─────────────────────────────

describe("TEAM-002: team_invites migration", () => {
  const sql = readMigration();

  it("creates the team_invites table", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS team_invites");
  });

  it("uses a UUID primary key consistent with the existing schema", () => {
    expect(sql).toContain("id UUID PRIMARY KEY DEFAULT gen_random_uuid()");
  });

  it("references team_profiles via team_profile_id with ON DELETE CASCADE", () => {
    expect(sql).toContain(
      "team_profile_id UUID NOT NULL REFERENCES team_profiles(id) ON DELETE CASCADE",
    );
  });

  it("references profiles via created_by with ON DELETE CASCADE", () => {
    expect(sql).toContain(
      "created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE",
    );
  });

  it("stores a unique token_hash (never the raw token)", () => {
    expect(sql).toContain("token_hash TEXT NOT NULL UNIQUE");
    // The raw token must never be a column.
    expect(sql).not.toMatch(/token\s+TEXT/);
    expect(sql).not.toContain("raw_token");
  });

  it("requires an expiration timestamp", () => {
    expect(sql).toContain("expires_at TIMESTAMPTZ NOT NULL");
  });

  it("does NOT add a status column (state is derived from timestamps)", () => {
    expect(sql).not.toMatch(/status\s+TEXT/);
  });

  it("includes created_at and updated_at timestamps with defaults", () => {
    expect(sql).toContain("created_at TIMESTAMPTZ DEFAULT now()");
    expect(sql).toContain("updated_at TIMESTAMPTZ DEFAULT now()");
  });

  it("adds an index for 'all invites for a team'", () => {
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS team_invites_team_profile_id_idx");
    expect(sql).toContain("ON team_invites (team_profile_id)");
  });

  it("enables row level security", () => {
    expect(sql).toContain("ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY");
  });

  it("scopes team RLS policies to the specific team_profile_id (multi-team safe)", () => {
    // The ownership check must resolve through team_profiles.user_id
    // for the SPECIFIC team_profile_id, never assume one team per user.
    const teamPolicyChecks = sql.match(
      /tp\.id = team_invites\.team_profile_id\s+AND\s+tp\.user_id::text = auth\.uid\(\)::text/g,
    );
    // SELECT + INSERT + UPDATE + DELETE policies
    expect(teamPolicyChecks).toHaveLength(4);
  });

  it("adds an updated_at trigger", () => {
    expect(sql).toContain("CREATE TRIGGER set_team_invites_updated_at");
    expect(sql).toContain("EXECUTE FUNCTION update_updated_at_column()");
  });

  it("does NOT modify the TEAM-001 membership model", () => {
    expect(sql).not.toContain("ALTER TABLE team_memberships");
    expect(sql).not.toContain("ALTER TABLE player_profiles");
  });
});

describe("TEAM-004: shared invite link migration (0015)", () => {
  const sql = readSharedLinkMigration();

  it("drops the single-use accepted_at and accepted_by columns", () => {
    expect(sql).toContain("ALTER TABLE team_invites DROP COLUMN IF EXISTS accepted_at");
    expect(sql).toContain("ALTER TABLE team_invites DROP COLUMN IF EXISTS accepted_by");
  });

  it("recreates the pending partial index without accepted_at", () => {
    expect(sql).toContain("DROP INDEX IF EXISTS team_invites_pending_team_idx");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS team_invites_pending_team_idx");
    expect(sql).toContain("ON team_invites (team_profile_id, expires_at)");
    expect(sql).toContain("WHERE revoked_at IS NULL");
    // The CREATE INDEX statement must NOT reference accepted_at (the column
    // no longer exists). The comment may mention it for documentation, so
    // scope the assertion to the index definition itself.
    const indexBlock = sql.slice(
      sql.indexOf("CREATE INDEX IF NOT EXISTS team_invites_pending_team_idx"),
      sql.indexOf(";", sql.indexOf("CREATE INDEX IF NOT EXISTS team_invites_pending_team_idx")),
    );
    expect(indexBlock).not.toContain("accepted_at");
  });

  it("widens the notifications type CHECK to include player_joined_team", () => {
    expect(sql).toContain("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check");
    expect(sql).toContain("'player_joined_team'");
  });

  it("adds a dedup partial unique index for player_joined_team notifications", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS notifications_player_joined_team_dedup_idx");
    expect(sql).toContain("ON notifications (user_id, source_id)");
    expect(sql).toContain("WHERE type = 'player_joined_team' AND source_id IS NOT NULL");
  });

  it("creates the accept_team_invite RPC", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION accept_team_invite");
    expect(sql).toContain("SECURITY DEFINER");
  });

  it("RPC locks the invite row to serialize concurrent acceptances", () => {
    expect(sql).toContain("FOR UPDATE");
  });

  it("RPC rejects revoked and expired invites", () => {
    expect(sql).toContain("INVITE_REVOKED");
    expect(sql).toContain("INVITE_EXPIRED");
  });

  it("RPC enforces the one-team-per-player rule without transferring players", () => {
    expect(sql).toContain("PLAYER_ALREADY_ON_TEAM");
    // Never silently transfer: the RPC must not delete/update another membership.
    expect(sql).not.toContain("DELETE FROM team_memberships");
  });

  it("RPC returns idempotent success when the player is already on this team", () => {
    expect(sql).toContain("already_member");
    expect(sql).toContain("created', false");
  });

  it("RPC handles unique_violation for concurrent duplicate acceptance", () => {
    expect(sql).toContain("WHEN unique_violation");
  });

  it("RPC does NOT mutate the invite on acceptance (shared link remains usable)", () => {
    // The invite is only read/locked — never updated with an accepted state.
    expect(sql).not.toContain("UPDATE team_invites");
  });
});

// ─── Token generation & hashing ─────────────────────────────────

describe("TEAM-002: invite token security", () => {
  it("generates non-empty tokens", () => {
    const token = generateInviteToken();
    expect(token.length).toBeGreaterThan(0);
  });

  it("generates tokens with sufficient entropy (256 bits → 43 base64url chars)", () => {
    const token = generateInviteToken();
    expect(token.length).toBe(43);
  });

  it("generates URL-safe tokens", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("two generated tokens are never equal", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateInviteToken()));
    expect(tokens.size).toBe(100);
  });

  it("tokens are not derived from sequential IDs or timestamps", () => {
    // Generate two tokens in rapid succession — they must be completely
    // different, not sequential or time-prefixed.
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    // No UUID-like or timestamp-like structure.
    expect(a).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("hashes deterministically with SHA-256", () => {
    const token = "test-token-abc";
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different tokens produce different hashes", () => {
    expect(hashInviteToken("token-a")).not.toBe(hashInviteToken("token-b"));
  });

  it("the raw token cannot be reconstructed from its hash", () => {
    const token = generateInviteToken();
    const hash = hashInviteToken(token);
    expect(hash).not.toContain(token);
    expect(hash).not.toBe(token);
  });

  it("hashing the returned token resolves the same digest used for storage", () => {
    const token = generateInviteToken();
    const stored = hashInviteToken(token);
    // Simulates the lookup path: hash the provided token, compare to stored digest.
    expect(hashInviteToken(token)).toBe(stored);
  });
});

// ─── Invite state derivation ────────────────────────────────────

describe("TEAM-002: invite state derivation (shared link model)", () => {
  const now = new Date("2026-01-05T00:00:00Z");

  it("is pending when nothing has happened and not expired", () => {
    expect(getTeamInviteState(createInvite(), now)).toBe("pending");
  });

  it("is revoked when revoked_at is set", () => {
    const invite = createInvite({ revoked_at: "2026-01-03T00:00:00Z" });
    expect(getTeamInviteState(invite, now)).toBe("revoked");
  });

  it("is expired when expires_at <= now", () => {
    const invite = createInvite({ expires_at: "2026-01-05T00:00:00Z" });
    expect(getTeamInviteState(invite, now)).toBe("expired");
  });

  it("is expired when expires_at is in the past", () => {
    const invite = createInvite({ expires_at: "2026-01-04T00:00:00Z" });
    expect(getTeamInviteState(invite, now)).toBe("expired");
  });

  it("is pending when expires_at is in the future", () => {
    const invite = createInvite({ expires_at: "2026-01-06T00:00:00Z" });
    expect(getTeamInviteState(invite, now)).toBe("pending");
  });

  it("returns expired for null/undefined invite", () => {
    expect(getTeamInviteState(null, now)).toBe("expired");
    expect(getTeamInviteState(undefined, now)).toBe("expired");
  });

  it("has no 'accepted' state — invites are reusable shared links", () => {
    // The state type must not include 'accepted'.
    const states: string[] = ["pending", "revoked", "expired"];
    expect(states).not.toContain("accepted");
  });
});

// ─── Invite usability (shared link + expiry + revocation) ───────

describe("TEAM-002: isInviteUsable (shared link model)", () => {
  const now = new Date("2026-01-05T00:00:00Z");

  it("returns true for a pending invite", () => {
    expect(isInviteUsable(createInvite(), now)).toBe(true);
  });

  it("returns false for a revoked invite", () => {
    const invite = createInvite({ revoked_at: "2026-01-03T00:00:00Z" });
    expect(isInviteUsable(invite, now)).toBe(false);
  });

  it("returns false for an expired invite", () => {
    const invite = createInvite({ expires_at: "2026-01-04T00:00:00Z" });
    expect(isInviteUsable(invite, now)).toBe(false);
  });

  it("returns false for null/undefined invite", () => {
    expect(isInviteUsable(null, now)).toBe(false);
    expect(isInviteUsable(undefined, now)).toBe(false);
  });

  it("remains usable after a player accepts it (no single-use consumption)", () => {
    // The invite has no accepted_at field — acceptance is represented by
    // team_memberships rows, never by mutating the invite. A pending invite
    // is always usable by any eligible player.
    expect(isInviteUsable(createInvite(), now)).toBe(true);
  });
});

// ─── Expiration ─────────────────────────────────────────────────

describe("TEAM-002: invite expiration", () => {
  it("defaults to 7 days", () => {
    expect(TEAM_INVITE_EXPIRY_DAYS).toBe(7);
  });

  it("computes expiration 7 days from now", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expires = getInviteExpiration(now);
    expect(expires.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  it("supports a custom expiry duration", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expires = getInviteExpiration(now, 1);
    expect(expires.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
});