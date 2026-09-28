import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0024_competition_tournament_format.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

/**
 * TOURN-002A — migration 0024.
 *
 * The selected tournament format is FOM's own configuration: it is stored on the
 * existing competition event (never on a provider-specific table), it is
 * constrained to the formats FOM models, and existing (pre-TOURN-002A)
 * tournaments are backfilled to the only format they could have been created
 * with. No provider request/response shape is stored.
 */

describe("TOURN-002A: tournament format migration (0024)", () => {
  const sql = readMigration();

  it("records the format on the existing competition event", () => {
    expect(sql).toContain("ALTER TABLE competition_events");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS tournament_format TEXT");
  });

  it("backfills existing linked tournaments as single elimination", () => {
    expect(sql).toMatch(
      /UPDATE competition_events\s+SET tournament_format = 'single_elimination'/,
    );
    expect(sql).toContain("WHERE provider_tournament_id IS NOT NULL");
    expect(sql).toContain("AND tournament_format IS NULL");
  });

  it("defaults nothing: a competition without a tournament records no format", () => {
    // A column DEFAULT would also apply to unlinked competitions and would claim
    // a format for a tournament that does not exist.
    expect(sql).not.toMatch(/tournament_format TEXT NOT NULL DEFAULT/i);
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS tournament_format TEXT DEFAULT/i);
  });

  it("constrains the stored value to the formats FOM models", () => {
    expect(sql).toContain("competition_events_tournament_format_check");
    for (const format of [
      "single_elimination",
      "double_elimination",
      "round_robin",
      "swiss",
      "group_stage_knockout",
    ]) {
      expect(sql).toContain(`'${format}'`);
    }
    // NULL stays allowed (a competition with no external tournament).
    expect(sql).toMatch(/tournament_format IS NULL\s+OR tournament_format IN/);
  });

  it("keeps the format and the tournament link set together", () => {
    expect(sql).toContain("competition_events_tournament_format_pair_check");
    expect(sql).toContain(
      "CHECK ((tournament_format IS NULL) = (provider_tournament_id IS NULL))",
    );
  });

  it("backfills BEFORE adding the constraints, so existing rows stay valid", () => {
    const backfill = sql.indexOf("UPDATE competition_events");
    const formatCheck = sql.indexOf(
      "competition_events_tournament_format_check",
    );
    const pairCheck = sql.indexOf(
      "competition_events_tournament_format_pair_check",
    );

    expect(backfill).toBeGreaterThan(-1);
    expect(backfill).toBeLessThan(formatCheck);
    expect(backfill).toBeLessThan(pairCheck);
  });

  it("adds no provider-specific table, column or provider configuration", () => {
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/tournament_type|scores_csv|api_key/i);
    // Exactly one column is added, and it is the neutral FOM format.
    expect(sql.match(/ADD COLUMN/gi)).toHaveLength(1);
  });
});
