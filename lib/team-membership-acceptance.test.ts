import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATION_FILE = "0016_accept_application_membership.sql";

function readMigration(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
}

describe("TEAM-005: accept_application RPC migration (0016)", () => {
  const sql = readMigration();

  it("creates the accept_application RPC", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION accept_application");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public");
  });

  it("takes application_id and user_id as parameters", () => {
    expect(sql).toContain("p_application_id UUID");
    expect(sql).toContain("p_user_id UUID");
  });

  it("returns JSONB for machine-readable results", () => {
    expect(sql).toContain("RETURNS JSONB");
  });

  it("locks the application row to serialize concurrent acceptances", () => {
    expect(sql).toContain("FOR UPDATE");
  });

  it("resolves the opportunity as the authoritative source for team/position/role", () => {
    expect(sql).toContain("SELECT o.id, o.team_id, o.position, o.role");
    expect(sql).toContain("FROM opportunities o");
    expect(sql).toContain("WHERE o.id = v_application.opportunity_id");
  });

  it("verifies the authenticated user owns the opportunity's team (multi-team safe)", () => {
    expect(sql).toContain("SELECT tp.user_id INTO v_team_user_id");
    expect(sql).toContain("FROM team_profiles tp");
    expect(sql).toContain("WHERE tp.id = v_opportunity.team_id");
    expect(sql).toContain("UNAUTHORIZED");
  });

  it("rejects ineligible applications (rejected/withdrawn → accepted)", () => {
    expect(sql).toContain("APPLICATION_NOT_ELIGIBLE");
    expect(sql).toContain("v_application.status NOT IN ('pending', 'reviewing')");
  });

  it("returns idempotent success for already-accepted applications", () => {
    expect(sql).toContain("already_accepted");
    expect(sql).toContain("v_application.status = 'accepted'");
  });

  it("handles same-team existing membership by updating position/role (no duplicate)", () => {
    expect(sql).toContain("already_member");
    expect(sql).toContain("UPDATE team_memberships");
    expect(sql).toContain("SET position = v_position");
    expect(sql).toContain("role = v_role");
    const sameTeamBlock = sql.slice(
      sql.indexOf("IF v_existing_membership.team_profile_id = v_opportunity.team_id THEN"),
      sql.indexOf("ELSE"),
    );
    expect(sameTeamBlock).toContain("UPDATE team_memberships");
    expect(sameTeamBlock).not.toContain("INSERT INTO team_memberships");
  });

  it("rejects players already on a different team with PLAYER_ALREADY_ON_TEAM", () => {
    expect(sql).toContain("PLAYER_ALREADY_ON_TEAM");
  });

  it("never deletes or transfers an existing membership", () => {
    expect(sql).not.toContain("DELETE FROM team_memberships");
  });

  it("creates the membership with the opportunity's team/position/role", () => {
    expect(sql).toContain(
      "INSERT INTO team_memberships (team_profile_id, player_profile_id, position, role)",
    );
    expect(sql).toContain(
      "VALUES (v_opportunity.team_id, v_application.player_profile_id, v_position, v_role)",
    );
  });

  it("marks the application accepted only after membership creation/update", () => {
    // The main flow (new membership path) must INSERT the membership BEFORE
    // updating the application status. The same-team path has its own
    // UPDATE applications earlier in the function, so scope the check to
    // the main flow section after the same-team branch.
    const insertPos = sql.indexOf("INSERT INTO team_memberships");
    const mainFlowUpdatePos = sql.indexOf("UPDATE applications", insertPos);
    expect(insertPos).toBeGreaterThan(-1);
    expect(mainFlowUpdatePos).toBeGreaterThan(insertPos);
  });

  it("handles unique_violation for concurrent acceptance", () => {
    expect(sql).toContain("WHEN unique_violation");
  });

  it("re-resolves state in the unique_violation handler", () => {
    const exceptionBlock = sql.slice(sql.indexOf("WHEN unique_violation"));
    expect(exceptionBlock).toContain("SELECT a.id, a.opportunity_id, a.player_profile_id, a.status");
    expect(exceptionBlock).toContain("FROM applications a");
    expect(exceptionBlock).toContain("SELECT * INTO v_existing_membership");
  });

  it("returns a machine-readable error shape", () => {
    expect(sql).toContain("jsonb_build_object('success', false, 'error'");
  });

  it("does not alter the schema of existing tables", () => {
    expect(sql).not.toContain("ALTER TABLE applications");
    expect(sql).not.toContain("ALTER TABLE team_memberships");
    expect(sql).not.toContain("ALTER TABLE opportunities");
    expect(sql).not.toContain("ALTER TABLE player_profiles");
  });

  it("does not modify the team invite flow's RPC", () => {
    expect(sql).not.toContain("accept_team_invite");
  });

  it("does not trigger player_joined_team notifications", () => {
    expect(sql).not.toContain("player_joined_team");
  });

  it("does not create conversations or outreach records", () => {
    expect(sql).not.toContain("conversations");
    expect(sql).not.toContain("outreach");
  });
});