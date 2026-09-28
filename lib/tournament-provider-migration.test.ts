import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0023_competition_tournament_provider.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

/**
 * TOURN-001 — migration 0023.
 *
 * The integration stores ONLY the identifiers needed to connect FOM to an
 * external tournament engine. Challonge remains the source of truth for the
 * bracket, matches, scores and advancement, so no provider-specific tables are
 * created and no existing table/column is modified.
 */

describe("TOURN-001: tournament provider mapping migration (0023)", () => {
  const sql = readMigration();

  it("adds the provider mapping to the existing competition event", () => {
    expect(sql).toContain("ALTER TABLE competition_events");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS provider TEXT");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS provider_tournament_id TEXT");
  });

  it("adds the provider participant mapping to the existing participant row", () => {
    expect(sql).toContain("ALTER TABLE competition_participants");
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS provider_participant_id TEXT",
    );
  });

  it("keeps provider and provider_tournament_id set together", () => {
    expect(sql).toContain("competition_events_provider_pair_check");
    expect(sql).toContain("CHECK ((provider IS NULL) = (provider_tournament_id IS NULL))");
  });

  it("prevents one external tournament from being linked twice", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS competition_events_provider_tournament_key",
    );
    expect(sql).toContain("ON competition_events (provider, provider_tournament_id)");
    expect(sql).toContain("WHERE provider_tournament_id IS NOT NULL");
  });

  it("prevents two FOM participants from claiming one bracket entry", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS competition_participants_provider_participant_key",
    );
    expect(sql).toContain(
      "ON competition_participants (event_id, provider_participant_id)",
    );
  });

  it("does NOT duplicate tournament-engine state into Supabase", () => {
    // No provider-shaped tables for matches, rounds, brackets or standings.
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/provider_match_id/i);
    expect(sql).not.toMatch(/scores_csv/i);
    // The provider column stays free-form text (not an enum limited to one
    // provider), so a second provider needs no migration.
    expect(sql).not.toMatch(/provider TEXT[^;]*CHECK/i);
  });
});
