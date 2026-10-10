import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0026_competition_participant_removal.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

/**
 * T-REM-1 — migration 0026.
 *
 * Soft removal is recorded on the EXISTING participant row (`removed_at`), so
 * no historical data is deleted. The migration must be strictly additive: it
 * only adds nullable columns and must not touch the existing uniqueness
 * constraint, foreign keys, RLS, triggers, realtime or the participant
 * lifecycle.
 */

describe("T-REM-1: participant soft-removal migration (0026)", () => {
  const sql = readMigration();

  it("adds the three nullable soft-removal columns to competition_participants", () => {
    expect(sql).toContain("ALTER TABLE competition_participants");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS removed_by_profile_id UUID");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS removal_reason TEXT");
  });

  it("references profiles(id) with ON DELETE SET NULL", () => {
    expect(sql).toMatch(
      /removed_by_profile_id UUID[^;]*REFERENCES profiles\(id\) ON DELETE SET NULL/,
    );
  });

  it("keeps the new columns nullable with no DEFAULT, so existing rows stay active", () => {
    // No NOT NULL and no DEFAULT: every existing participant is
    // `removed_at IS NULL` (active) without a backfill.
    expect(sql).not.toMatch(/removed_at TIMESTAMPTZ[^;]*NOT NULL/i);
    expect(sql).not.toMatch(/removal_reason TEXT[^;]*NOT NULL/i);
    expect(sql).not.toMatch(/removed_at TIMESTAMPTZ[^;]*DEFAULT/i);
    expect(sql).not.toMatch(/removal_reason TEXT[^;]*DEFAULT/i);
    expect(sql).not.toMatch(/removed_by_profile_id UUID[^;]*DEFAULT/i);
  });

  it("is additive: no delete, rewrite, truncate or backfill of existing rows", () => {
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/UPDATE competition_participants/i);
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });

  it("does not add a registration value or modify the participant lifecycle", () => {
    expect(sql).not.toMatch(/CHECK\s*\(/i);
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS status/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
  });

  it("preserves the existing uniqueness constraint and adds no redundant index", () => {
    // The UNIQUE(event_id, profile_id) constraint/index is left untouched.
    expect(sql).not.toMatch(/DROP INDEX/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
    expect(sql).not.toMatch(/CREATE (UNIQUE )?INDEX/i);
  });

  it("does not change RLS policies, grants, triggers or the realtime publication", () => {
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/i);
    expect(sql).not.toMatch(
      /ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY/i,
    );
    expect(sql).not.toMatch(/^\s*GRANT\b/im);
    expect(sql).not.toMatch(/^\s*REVOKE\b/im);
    expect(sql).not.toMatch(/CREATE TRIGGER|DROP TRIGGER|ALTER TRIGGER/i);
    expect(sql).not.toMatch(/ALTER PUBLICATION/i);
  });

  it("only adds columns (three additive ALTER TABLE statements)", () => {
    expect(sql.match(/ALTER TABLE/gi)?.length).toBe(3);
  });
});
