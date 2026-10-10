import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0027_competition_participant_bans.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

/**
 * T-REM-3 — migration 0027.
 *
 * Adds the durable, competition-specific `competition_bans` table and ONE atomic
 * SECURITY DEFINER RPC that performs the host removal and optional ban in a
 * single transaction. The migration is additive: it creates a new table and a
 * new function only — it never drops/rewrites existing data or relaxes the
 * existing UNIQUE(event_id, profile_id) constraint on competition_participants.
 */

describe("T-REM-3: participant ban migration (0027)", () => {
  const sql = readMigration();

  it("creates the durable competition_bans table keyed by competition + player", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS competition_bans");
    expect(sql).toContain("event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE");
    expect(sql).toContain("profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE");
    expect(sql).toContain("banned_at TIMESTAMPTZ NOT NULL DEFAULT now()");
    expect(sql).toContain("banned_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL");
    expect(sql).toMatch(/\breason TEXT/);
  });

  it("enforces one ban per (competition, player)", () => {
    expect(sql).toMatch(
      /CONSTRAINT competition_bans_event_profile_key UNIQUE \(event_id, profile_id\)/,
    );
  });

  it("indexes the foreign-key columns the unique key does not lead with", () => {
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS competition_bans_profile_id_idx");
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS competition_bans_banned_by_profile_id_idx",
    );
  });

  it("never exposes bans publicly: RLS enabled with manager/ambassador SELECT only", () => {
    expect(sql).toContain("ALTER TABLE competition_bans ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('CREATE POLICY "Event creator can read bans"');
    expect(sql).toContain('CREATE POLICY "Event ambassador can read bans"');
    // Exactly two policies, both read-only: no public insert/update/delete path
    // (all writes go through the SECURITY DEFINER RPC).
    expect(sql.match(/CREATE POLICY/g)?.length).toBe(2);
    expect(sql.match(/FOR SELECT/gi)?.length).toBe(2);
    expect(sql).not.toMatch(/FOR INSERT/i);
    expect(sql).not.toMatch(/FOR DELETE/i);
  });

  it("adds the atomic remove/ban RPC", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION remove_competition_participant(",
    );
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public");
    // Serializes concurrent remove/ban requests on the same participant.
    expect(sql).toContain("FOR UPDATE");
    // Duplicate ban requests are idempotent, not a second row.
    expect(sql).toContain("ON CONFLICT (event_id, profile_id) DO NOTHING");
    // Defense-in-depth: the RPC re-checks the creator-or-ambassador rule.
    expect(sql).toContain("ce.created_by = p_actor_profile_id");
    expect(sql).toContain("FROM competition_ambassadors ca");
  });

  it("enforces the shared lifecycle + provider-safety checks before removing", () => {
    expect(sql).toContain("v_event_status IS DISTINCT FROM 'active'");
    expect(sql).toContain("PARTICIPANT_CHECKED_IN");
    expect(sql).toContain("PARTICIPANT_PROVIDER_MAPPED");
    expect(sql).toContain("competition_attempts");
    expect(sql).toContain("PARTICIPANT_HAS_ATTEMPTS");
    // The participant MUST belong to the event.
    expect(sql).toContain("PARTICIPANT_NOT_FOUND");
    // Self-removal/self-ban is refused.
    expect(sql).toContain("CANNOT_TARGET_SELF");
  });

  it("soft-removes the registration (never deletes the participant or its history)", () => {
    expect(sql).toMatch(
      /UPDATE competition_participants\s+SET removed_at = now\(\)/,
    );
    expect(sql).not.toMatch(/DELETE FROM competition_participants/i);
    // It never cascades a delete of historical records.
    expect(sql).not.toMatch(/DELETE FROM competition_attempts/i);
    expect(sql).not.toMatch(/DELETE FROM competition_drawings/i);
  });

  it("is additive: no existing table/column/constraint is dropped or relaxed", () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/ALTER TABLE competition_participants/i);
    expect(sql).not.toMatch(/ALTER TABLE competition_events/i);
  });
});
