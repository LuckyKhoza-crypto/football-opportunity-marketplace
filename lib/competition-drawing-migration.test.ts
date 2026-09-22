import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0020_competition_drawings.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

describe("COMP-006: competition drawings migration (0020)", () => {
  const sql = readMigration();

  it("creates the competition_drawings table", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS competition_drawings");
  });

  it("stores only the winner relationships and an eligible snapshot", () => {
    expect(sql).toContain("event_id UUID NOT NULL REFERENCES competition_events(id)");
    expect(sql).toContain("winner_participant_id UUID NOT NULL");
    expect(sql).toContain("REFERENCES competition_participants(id)");
    expect(sql).toContain("winner_profile_id UUID REFERENCES profiles(id)");
    expect(sql).toContain("qualified_participant_count INTEGER NOT NULL");
    expect(sql).toContain("drawn_by_profile_id UUID REFERENCES profiles(id)");
    expect(sql).toContain("drawn_at TIMESTAMPTZ NOT NULL DEFAULT now()");
  });

  it("does NOT copy personal information into the drawing table", () => {
    expect(sql).not.toMatch(/winner_name/i);
    expect(sql).not.toMatch(/winner_email/i);
    expect(sql).not.toMatch(/full_name TEXT/);
  });

  it("enforces exactly one drawing per event", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS competition_drawings_event_id_key",
    );
    expect(sql).toContain("ON competition_drawings (event_id)");
  });

  it("creates the atomic start_competition_drawing RPC", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION start_competition_drawing");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public");
    expect(sql).toContain("p_event_id UUID");
    expect(sql).toContain("p_user_id UUID");
    expect(sql).toContain("RETURNS JSONB");
  });

  it("locks the event row to serialize concurrent drawings", () => {
    expect(sql).toContain("FOR UPDATE");
  });

  it("authorizes the creator OR an assigned ambassador via competition_ambassadors", () => {
    expect(sql).toContain("v_event.created_by::text = p_user_id::text");
    expect(sql).toContain("FROM competition_ambassadors ca");
    // Authorization must never SELECT a marketplace role from profiles.
    expect(sql).not.toMatch(/SELECT[^;]*role[^;]*FROM profiles/i);
    expect(sql).not.toContain("profiles.role =");
  });

  it("rejects a duplicate drawing and non-drawable states", () => {
    expect(sql).toContain("DRAWING_ALREADY_EXISTS");
    expect(sql).toContain("v_existing_id");
    expect(sql).toContain("EVENT_NOT_DRAWABLE");
    expect(sql).toContain("v_event.status NOT IN ('active', 'drawing')");
  });

  it("counts only qualified participants server-side", () => {
    expect(sql).toContain("SELECT count(*) INTO v_qualified_count");
    expect(sql).toContain("AND status = 'qualified'");
    expect(sql).toContain("NO_QUALIFIED_PARTICIPANTS");
  });

  it("selects exactly one winner at random, server-side", () => {
    expect(sql).toContain("ORDER BY random()");
    expect(sql).toContain("LIMIT 1");
  });

  it("persists the winner, count and initiator", () => {
    expect(sql).toContain("INSERT INTO competition_drawings");
    expect(sql).toContain("winner_participant_id");
    expect(sql).toContain("qualified_participant_count");
    expect(sql).toContain("drawn_by_profile_id");
  });

  it("moves the event to completed after the drawing", () => {
    expect(sql).toContain("UPDATE competition_events");
    expect(sql).toContain("SET status = 'completed'");
  });

  it("handles a concurrent unique_violation safely", () => {
    expect(sql).toContain("WHEN unique_violation");
    expect(sql).toContain("DRAWING_ALREADY_EXISTS");
  });

  it("is immutable (no delete/update path for a drawing)", () => {
    expect(sql).not.toMatch(/DELETE FROM competition_drawings/i);
    expect(sql).not.toMatch(/UPDATE competition_drawings/i);
  });

  it("enables RLS and restricts reads to the creator and ambassadors", () => {
    expect(sql).toContain("ALTER TABLE competition_drawings ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('"Event creator can read drawing"');
    expect(sql).toContain('"Event ambassador can read drawing"');
  });

  it("does not modify any previous competition migration", () => {
    expect(sql).not.toContain("ALTER TABLE competition_events\n  ADD");
    expect(sql).not.toContain("ALTER TABLE competition_participants");
    expect(sql).not.toContain("ALTER TABLE competition_attempts");
    expect(sql).not.toContain("ALTER TABLE competition_join_links");
  });
});