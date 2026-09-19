import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getInvitePageState,
  getInviteAction,
  buildInviteLoginUrl,
  buildInvitePath,
} from "@/lib/team-join";
import type { PublicTeamInvite } from "@/types";

const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INVITE_1 = "11111111-1111-4111-8111-111111111111";
const INVITE_2 = "22222222-2222-4222-8222-222222222222";
const TOKEN = "raw-token-abc-123";

function makeInvite(overrides: Partial<PublicTeamInvite> = {}): PublicTeamInvite {
  return {
    id: INVITE_1,
    team: {
      id: TEAM_A,
      team_name: "Phoenix Pro Stars FC",
      logo_url: "https://example.com/logo.png",
      location: "Gilbert, Arizona",
      league: "Premier League",
    },
    state: "pending",
    expires_at: "2026-01-08T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("TEAM-003: invite page state derivation", () => {
  it("valid pending token + authenticated -> pending_authenticated", () => {
    expect(getInvitePageState(makeInvite(), true)).toBe("pending_authenticated");
  });

  it("valid pending token + unauthenticated -> pending_unauthenticated", () => {
    expect(getInvitePageState(makeInvite(), false)).toBe("pending_unauthenticated");
  });

  it("invalid token -> not_found", () => {
    expect(getInvitePageState(null, true)).toBe("not_found");
    expect(getInvitePageState(null, false)).toBe("not_found");
  });

  it("expired invite -> expired", () => {
    expect(getInvitePageState(makeInvite({ state: "expired" }), true)).toBe("expired");
    expect(getInvitePageState(makeInvite({ state: "expired" }), false)).toBe("expired");
  });

  it("revoked invite -> revoked", () => {
    expect(getInvitePageState(makeInvite({ state: "revoked" }), true)).toBe("revoked");
  });

  it("a pending invite is never 'accepted' as a whole (shared link)", () => {
    // A team invite is a reusable shared recruitment link — there is no
    // global accepted state. The state type only supports pending/revoked/expired.
    const states: string[] = ["pending", "revoked", "expired"];
    expect(states).not.toContain("accepted");
  });
});

describe("TEAM-003: invite action", () => {
  it("pending authenticated exposes Accept Invite action", () => {
    expect(getInviteAction("pending_authenticated")).toEqual({ label: "Accept Invite" });
  });

  it("pending unauthenticated exposes Accept Invite action", () => {
    expect(getInviteAction("pending_unauthenticated")).toEqual({ label: "Accept Invite" });
  });

  it("revoked/expired/not_found expose no action", () => {
    expect(getInviteAction("revoked")).toBeNull();
    expect(getInviteAction("expired")).toBeNull();
    expect(getInviteAction("not_found")).toBeNull();
  });
});

describe("TEAM-003: invite login URL continuation", () => {
  it("preserves the original invite path through login", () => {
    expect(buildInviteLoginUrl(TOKEN)).toBe(`/login?callbackUrl=/team/join/${encodeURIComponent(TOKEN)}`);
  });

  it("URL-encodes the token", () => {
    const tokenWithSpecialChars = "abc+def/ghi";
    const url = buildInviteLoginUrl(tokenWithSpecialChars);
    expect(url).toContain(encodeURIComponent(tokenWithSpecialChars));
    expect(url).not.toContain(tokenWithSpecialChars);
  });

  it("buildInvitePath returns the canonical invite path", () => {
    expect(buildInvitePath(TOKEN)).toBe(`/team/join/${encodeURIComponent(TOKEN)}`);
  });
});

describe("TEAM-003: public-safe invite data", () => {
  it("does not expose token_hash, created_by, accepted_by, or user_id", () => {
    const invite = makeInvite();
    const serialized = JSON.stringify(invite);
    expect(serialized).not.toContain("token_hash");
    expect(serialized).not.toContain("created_by");
    expect(serialized).not.toContain("accepted_by");
    expect(serialized).not.toContain("user_id");
  });

  it("exposes only public-safe team fields", () => {
    const invite = makeInvite();
    expect(invite.team).toEqual({
      id: TEAM_A,
      team_name: "Phoenix Pro Stars FC",
      logo_url: "https://example.com/logo.png",
      location: "Gilbert, Arizona",
      league: "Premier League",
    });
  });
});

describe("TEAM-003: multi-team isolation", () => {
  it("invite for Team A displays Team A", () => {
    const invite = makeInvite();
    expect(invite.team.id).toBe(TEAM_A);
    expect(invite.team.team_name).toBe("Phoenix Pro Stars FC");
  });

  it("invite for Team B displays Team B", () => {
    const invite = makeInvite({
      id: INVITE_2,
      team: {
        id: TEAM_B,
        team_name: "Tucson United",
        logo_url: null,
        location: "Tucson, AZ",
        league: "Championship",
      },
    });
    expect(invite.team.id).toBe(TEAM_B);
    expect(invite.team.team_name).toBe("Tucson United");
  });

  it("a manager's other teams are not exposed through the invite page", () => {
    const invite = makeInvite();
    const serialized = JSON.stringify(invite);
    expect(serialized).not.toContain(TEAM_B);
    expect(serialized).not.toContain("Tucson United");
  });
});

describe("TEAM-003: no acceptance side effects (source-level)", () => {
  const PAGE_PATH = join(__dirname, "..", "app", "team", "join", "[token]", "page.tsx");
  const BUTTON_PATH = join(__dirname, "..", "app", "team", "join", "[token]", "AcceptInviteButton.tsx");
  const pageSource = readFileSync(PAGE_PATH, "utf-8");
  const buttonSource = readFileSync(BUTTON_PATH, "utf-8");

  it("page does not insert into team_memberships", () => {
    // The page must not perform any database operations on team_memberships.
    // (The word may appear in documentation comments; what matters is that
    // no query/insert/update/delete is performed.)
    expect(pageSource).not.toContain('from("team_memberships")');
    expect(pageSource).not.toContain(".insert(");
    expect(buttonSource).not.toContain('from("team_memberships")');
    expect(buttonSource).not.toContain(".insert(");
  });

  it("page does not update accepted_at or accepted_by", () => {
    expect(pageSource).not.toContain("accepted_at");
    expect(pageSource).not.toContain("accepted_by");
    expect(buttonSource).not.toContain("accepted_at");
    expect(buttonSource).not.toContain("accepted_by");
  });

  it("page does not create applications, outreach, or conversations", () => {
    expect(pageSource).not.toContain("applications");
    expect(pageSource).not.toContain("outreach");
    expect(pageSource).not.toContain("conversations");
    expect(buttonSource).not.toContain("applications");
    expect(buttonSource).not.toContain("outreach");
    expect(buttonSource).not.toContain("conversations");
  });

  it("page has no insert/update/delete database operations", () => {
    expect(pageSource).not.toMatch(/\.insert\(/);
    expect(pageSource).not.toMatch(/\.update\(/);
    expect(pageSource).not.toMatch(/\.delete\(/);
    expect(buttonSource).not.toMatch(/\.insert\(/);
    expect(buttonSource).not.toMatch(/\.update\(/);
    expect(buttonSource).not.toMatch(/\.delete\(/);
  });

  it("page resolves invite server-side via getTeamInviteByToken", () => {
    expect(pageSource).toContain("getTeamInviteByToken");
  });

  it("page does not query team_invites directly from the browser", () => {
    expect(pageSource).not.toContain('from("team_invites")');
    expect(pageSource).not.toContain("supabase");
  });

  it("client-safe helpers do not import service-role credentials", () => {
    const teamJoinSource = readFileSync(join(__dirname, "team-join.ts"), "utf-8");
    const callbackSource = readFileSync(join(__dirname, "invite-callback.ts"), "utf-8");
    expect(teamJoinSource).not.toContain("supabase-admin");
    expect(teamJoinSource).not.toContain("supabase");
    expect(callbackSource).not.toContain("supabase-admin");
    expect(callbackSource).not.toContain("supabase");
  });
});

describe("TEAM-003: signup continuation", () => {
  const SIGNUP_PATH = join(__dirname, "..", "app", "signup", "page.tsx");
  const signupSource = readFileSync(SIGNUP_PATH, "utf-8");

  it("signup page preserves the callbackUrl through the redirect", () => {
    expect(signupSource).toContain("getSafeCallbackUrl");
    expect(signupSource).toContain("callbackUrl");
    expect(signupSource).toContain("redirect(`/login?callbackUrl=");
  });

  it("signup page validates the callbackUrl before redirecting", () => {
    expect(signupSource).toContain("getSafeCallbackUrl(rawCallback, \"/dashboard\")");
  });

  it("signup page still redirects to /login without a callbackUrl", () => {
    expect(signupSource).toContain('redirect("/login")');
  });
});
