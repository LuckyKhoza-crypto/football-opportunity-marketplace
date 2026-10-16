import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const NEW_MIGRATION = "0029_competition_drawing_active_eligibility.sql";
const ORIGINAL_MIGRATION = "0020_competition_drawings.sql";

function read(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
}

/**
 * T-REM-4 (remaining drawing limitation) — migration 0029.
 *
 * The authoritative, database-side winner selection must exclude soft-removed
 * participants. The fix is a strictly additive `CREATE OR REPLACE FUNCTION`
 * whose signature, return shape, authorization, locking, transaction and
 * selection behaviour are otherwise unchanged — so existing callers and
 * historical data are unaffected.
 */
describe("T-REM-4: drawing eligibility excludes removed participants (0029)", () => {
  const sql = read(NEW_MIGRATION);

  it("replaces the existing function with the SAME signature and return shape", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION start_competition_drawing(");
    expect(sql).toContain("p_event_id UUID");
    expect(sql).toContain("p_user_id UUID");
    expect(sql).toContain("RETURNS JSONB");
    expect(sql).toContain("LANGUAGE plpgsql");
    // Never recreated with DROP — a drop would break dependent callers/grants.
    expect(sql).not.toMatch(/DROP FUNCTION/i);
  });

  it("filters active-registration eligibility in the DATABASE, not just in TS", () => {
    // Both the eligibility count AND the winner selection must exclude removed
    // participants — an application pre-check is not sufficient.
    const body = sql.slice(sql.indexOf("AS $func_start_competition_drawing$"));
    expect((body.match(/AND removed_at IS NULL/g) ?? []).length).toBe(2);
    expect(body).toMatch(
      /AND status = 'qualified'\s+AND removed_at IS NULL;/,
    );
    expect(sql).toContain("AND removed_at IS NULL");
  });

  it("counts only active qualified participants", () => {
    expect(sql).toContain("SELECT count(*) INTO v_qualified_count");
    expect(sql).toContain("AND status = 'qualified'");
    expect(sql).toContain("AND removed_at IS NULL");
    expect(sql).toContain("NO_QUALIFIED_PARTICIPANTS");
  });

  it("selects exactly one ACTIVE qualified winner at random", () => {
    expect(sql).toContain("ORDER BY random()");
    expect(sql).toContain("LIMIT 1");
    expect(sql).toMatch(
      /FROM competition_participants\s+WHERE event_id = p_event_id\s+AND status = 'qualified'\s+AND removed_at IS NULL\s+ORDER BY random\(\)/,
    );
  });

  it("preserves the event lock and the whole transaction shape", () => {
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("SELECT id, status, created_by");
    expect(sql).toContain("INSERT INTO competition_drawings");
    expect(sql).toContain("UPDATE competition_events");
    expect(sql).toContain("SET status = 'completed'");
  });

  it("preserves authorization: creator OR assigned ambassador (never profiles.role)", () => {
    expect(sql).toContain("v_event.created_by::text = p_user_id::text");
    expect(sql).toContain("FROM competition_ambassadors ca");
    expect(sql).toContain("'UNAUTHORIZED'");
    expect(sql).not.toMatch(/SELECT[^;]*role[^;]*FROM profiles/i);
  });

  it("preserves every existing error outcome and concurrency guarantee", () => {
    expect(sql).toContain("EVENT_NOT_FOUND");
    expect(sql).toContain("DRAWING_ALREADY_EXISTS");
    expect(sql).toContain("v_existing_id");
    expect(sql).toContain("EVENT_NOT_DRAWABLE");
    expect(sql).toContain("v_event.status NOT IN ('active', 'drawing')");
    expect(sql).toContain("WHEN unique_violation THEN");
    expect(sql).toContain("'success', true");
  });

  it("never mutates history: no drawing/attempt/participant write paths added", () => {
    expect(sql).not.toMatch(/DELETE FROM competition_drawings/i);
    expect(sql).not.toMatch(/UPDATE competition_drawings/i);
    expect(sql).not.toMatch(/DELETE FROM competition_attempts/i);
    expect(sql).not.toMatch(/UPDATE competition_participants/i);
    expect(sql).not.toMatch(/UPDATE competition_attempts/i);
  });

  it("is additive: the drawing table, its RLS, indexes and columns are untouched", () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
    expect(sql).not.toMatch(/DROP INDEX/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    expect(sql).not.toMatch(/ALTER TABLE competition_drawings/i);
    expect(sql).not.toMatch(/ALTER TABLE competition_participants/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("does not edit the already-applied 0020 migration", () => {
    const original = read(ORIGINAL_MIGRATION);
    // The original definition is unchanged: the filter exists ONLY in 0029.
    expect(original).not.toContain("removed_at IS NULL");
    expect(original).toContain("AND status = 'qualified';");
  });
});
