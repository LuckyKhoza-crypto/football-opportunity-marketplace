import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * TEAM-006 — Profile page membership integration tests.
 *
 * These are source-level tests (matching the existing test pattern in
 * this repo) that verify the four profile pages:
 *
 *   1. Derive "Current Team" / "Roster" exclusively from
 *      `team_memberships` via the server-side loaders.
 *   2. Link to the correct public profile routes.
 *   3. Do NOT derive team/roster data from applications, outreach,
 *      notifications, or player profile fields.
 *   4. Filter on `status = 'active'`.
 */

const APP_DIR = join(__dirname, "..", "app");

const PUBLIC_PLAYER_PROFILE = join(APP_DIR, "players", "[id]", "page.tsx");
const OWN_PLAYER_PROFILE = join(APP_DIR, "player", "profile", "page.tsx");
const PUBLIC_TEAM_PROFILE = join(APP_DIR, "teams", "[id]", "page.tsx");
const OWN_TEAM_PROFILE = join(APP_DIR, "team", "profile", "page.tsx");

const LOADER_PATH = join(__dirname, "team-membership-server.ts");

function readPage(path: string): string {
  return readFileSync(path, "utf-8");
}

// ─── Player profile: Current Team ───────────────────────────────

describe("TEAM-006: player profile — current team", () => {
  const publicPage = readPage(PUBLIC_PLAYER_PROFILE);
  const ownPage = readPage(OWN_PLAYER_PROFILE);

  it("public player profile loads memberships via getActiveMembershipsForPlayer", () => {
    expect(publicPage).toContain("getActiveMembershipsForPlayer");
  });

  it("own player profile loads memberships via getActiveMembershipsForPlayer", () => {
    expect(ownPage).toContain("getActiveMembershipsForPlayer");
  });

  it("renders the CurrentTeamCard component", () => {
    expect(publicPage).toContain("CurrentTeamCard");
    expect(ownPage).toContain("CurrentTeamCard");
  });

  it("only renders the current team when an active membership exists", () => {
    // The card is conditionally rendered on memberships.length > 0.
    expect(publicPage).toContain("memberships.length > 0");
    expect(ownPage).toContain("memberships.length > 0");
  });

  it("links the team name to the public team profile route", () => {
    const cardSource = readFileSync(
      join(__dirname, "..", "components", "marketplace", "current-team-card.tsx"),
      "utf-8",
    );
    expect(cardSource).toContain("`/teams/${team.id}`");
  });

  it("displays membership position/role from team_memberships", () => {
    const cardSource = readFileSync(
      join(__dirname, "..", "components", "marketplace", "current-team-card.tsx"),
      "utf-8",
    );
    // The card destructures position/role from the membership object.
    expect(cardSource).toContain("const { team, position, role } = membership;");
    expect(cardSource).toContain("{position}");
    expect(cardSource).toContain("{role}");
  });

  it("does NOT derive the current team from applications or outreach", () => {
    // The page must not query applications/outreach for team data.
    expect(publicPage).not.toContain('from("applications")');
    expect(publicPage).not.toContain('from("outreach")');
    expect(ownPage).not.toContain('from("applications")');
    expect(ownPage).not.toContain('from("outreach")');
  });

  it("does NOT add team_id to player_profiles or infer from profile fields", () => {
    // The page must not query player_profiles for a team_id column.
    expect(publicPage).not.toContain("team_id");
    expect(ownPage).not.toContain("team_id");
  });
});

// ─── Team profile: Roster ───────────────────────────────────────

describe("TEAM-006: team profile — roster", () => {
  const publicPage = readPage(PUBLIC_TEAM_PROFILE);
  const ownPage = readPage(OWN_TEAM_PROFILE);

  it("public team profile loads memberships via getActiveMembershipsForTeam", () => {
    expect(publicPage).toContain("getActiveMembershipsForTeam");
  });

  it("own team profile loads memberships via getActiveMembershipsForTeam", () => {
    expect(ownPage).toContain("getActiveMembershipsForTeam");
  });

  it("renders the RosterPlayerCard component", () => {
    expect(publicPage).toContain("RosterPlayerCard");
    expect(ownPage).toContain("RosterPlayerCard");
  });

  it("links the player name to the public player profile route", () => {
    const cardSource = readFileSync(
      join(__dirname, "..", "components", "marketplace", "roster-player-card.tsx"),
      "utf-8",
    );
    expect(cardSource).toContain("`/players/${playerProfile.id}`");
  });

  it("displays membership position/role from team_memberships", () => {
    const cardSource = readFileSync(
      join(__dirname, "..", "components", "marketplace", "roster-player-card.tsx"),
      "utf-8",
    );
    expect(cardSource).toContain("const { player_profile: playerProfile, position, role } = membership;");
    expect(cardSource).toContain("{position}");
    expect(cardSource).toContain("{role}");
  });

  it("does NOT derive the roster from applications or outreach", () => {
    expect(publicPage).not.toContain('from("applications")');
    expect(publicPage).not.toContain('from("outreach")');
    expect(ownPage).not.toContain('from("applications")');
    expect(ownPage).not.toContain('from("outreach")');
  });

  it("does NOT expose internal membership IDs in the UI", () => {
    const cardSource = readFileSync(
      join(__dirname, "..", "components", "marketplace", "roster-player-card.tsx"),
      "utf-8",
    );
    // The card renders player info, not the membership id.
    expect(cardSource).not.toContain("membership.id");
  });
});

// ─── Server loader: canonical membership queries ────────────────

describe("TEAM-006: team-membership-server loader", () => {
  const loaderSource = readFileSync(LOADER_PATH, "utf-8");

  it("queries team_memberships as the canonical source", () => {
    expect(loaderSource).toContain('.from("team_memberships")');
  });

  it("filters on status = 'active' at the database level", () => {
    expect(loaderSource).toContain('.eq("status", "active")');
  });

  it("applies filterActiveMemberships as a defensive second layer", () => {
    expect(loaderSource).toContain("filterActiveMemberships");
  });

  it("joins team_profiles for the player-side query", () => {
    expect(loaderSource).toContain("team:team_profile_id");
  });

  it("joins player_profiles and profiles for the team-side query", () => {
    expect(loaderSource).toContain("player_profile:player_profile_id");
    expect(loaderSource).toContain("profile:user_id");
  });

  it("does not query applications, outreach, or notifications", () => {
    expect(loaderSource).not.toContain('from("applications")');
    expect(loaderSource).not.toContain('from("outreach")');
    expect(loaderSource).not.toContain('from("notifications")');
  });

  it("uses supabaseAdmin server-side (never the browser client)", () => {
    expect(loaderSource).toContain("supabaseAdmin");
    expect(loaderSource).toContain('import "server-only"');
  });
});

// ─── Integration behavior: invite + application flows ───────────

describe("TEAM-006: integration behavior", () => {
  it("invite acceptance creates a team_memberships row (canonical)", () => {
    const inviteRpc = readFileSync(
      join(__dirname, "..", "supabase", "migrations", "0015_team_invites_shared_link.sql"),
      "utf-8",
    );
    expect(inviteRpc).toContain("INSERT INTO team_memberships");
  });

  it("application acceptance creates a team_memberships row (canonical)", () => {
    const acceptRpc = readFileSync(
      join(__dirname, "..", "supabase", "migrations", "0016_accept_application_membership.sql"),
      "utf-8",
    );
    expect(acceptRpc).toContain("INSERT INTO team_memberships");
  });

  it("profile pages read memberships directly — no sync code needed", () => {
    // The profile pages only READ team_memberships via the loader.
    // They must not perform any insert/update/delete on memberships.
    const publicPlayer = readPage(PUBLIC_PLAYER_PROFILE);
    const ownPlayer = readPage(OWN_PLAYER_PROFILE);
    const publicTeam = readPage(PUBLIC_TEAM_PROFILE);
    const ownTeam = readPage(OWN_TEAM_PROFILE);

    for (const page of [publicPlayer, ownPlayer, publicTeam, ownTeam]) {
      expect(page).not.toMatch(/\.insert\(/);
      expect(page).not.toMatch(/\.update\(/);
      expect(page).not.toMatch(/\.delete\(/);
    }
  });
});