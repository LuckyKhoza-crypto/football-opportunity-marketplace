import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTeamInviteByToken } from "@/lib/team-invite-server";
import { hashInviteToken } from "@/lib/team-invite";

const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INVITE_1 = "11111111-1111-4111-8111-111111111111";
const RAW_TOKEN = "raw-token-abc-123";

type MockFn = ReturnType<typeof vi.fn>;

interface QueryChain {
  select: MockFn;
  eq: MockFn;
  maybeSingle: MockFn;
}

function createChain(): QueryChain {
  const handler: QueryChain = {
    select: vi.fn(() => handler),
    eq: vi.fn(() => handler),
    maybeSingle: vi.fn(),
  };
  return handler;
}

function mockLookupResult(invite: Record<string, unknown> | null) {
  const handler = createChain();
  handler.maybeSingle.mockResolvedValue(
    invite ? { data: invite, error: null } : { data: null, error: null },
  );
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);
}

function makeInviteRow(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: INVITE_1,
    team_profile_id: TEAM_A,
    expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    revoked_at: null,
    created_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    team: {
      id: TEAM_A,
      team_name: "Phoenix Pro Stars FC",
      logo_url: "https://example.com/logo.png",
      location: "Phoenix, AZ",
      league: "Premier League",
    },
    ...overrides,
  };
}

describe("TEAM-002: getTeamInviteByToken (public-safe lookup)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("valid pending token resolves successfully with public-safe team info", async () => {
    mockLookupResult(makeInviteRow());

    const result = await getTeamInviteByToken(RAW_TOKEN);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(INVITE_1);
    expect(result?.team.team_name).toBe("Phoenix Pro Stars FC");
    expect(result?.team.logo_url).toBe("https://example.com/logo.png");
    expect(result?.team.location).toBe("Phoenix, AZ");
    expect(result?.team.league).toBe("Premier League");
    expect(result?.state).toBe("pending");
    expect(result?.expires_at).toBeTruthy();
    expect(result?.created_at).toBeTruthy();
  });

  it("looks up by the SHA-256 hash of the provided token, never the raw token", async () => {
    mockLookupResult(makeInviteRow());

    await getTeamInviteByToken(RAW_TOKEN);

    // The query must filter by token_hash = SHA256(raw token).
    const handler = vi.mocked(supabaseAdmin.from).mock.results[0].value as QueryChain;
    expect(handler.eq).toHaveBeenCalledWith("token_hash", hashInviteToken(RAW_TOKEN));
  });

  it("invalid token is rejected/not found safely (returns null)", async () => {
    mockLookupResult(null);

    const result = await getTeamInviteByToken("nonexistent-token");

    expect(result).toBeNull();
  });

  it("empty token returns null without querying", async () => {
    const result = await getTeamInviteByToken("");

    expect(result).toBeNull();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("expired invite is recognized as expired/invalid", async () => {
    mockLookupResult(
      makeInviteRow({
        expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      }),
    );

    const result = await getTeamInviteByToken(RAW_TOKEN);

    expect(result?.state).toBe("expired");
  });

  it("revoked invite is recognized as revoked/invalid", async () => {
    mockLookupResult(
      makeInviteRow({
        revoked_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      }),
    );

    const result = await getTeamInviteByToken(RAW_TOKEN);

    expect(result?.state).toBe("revoked");
  });

  it("a pending invite remains usable (shared link — never consumed by acceptance)", async () => {
    mockLookupResult(makeInviteRow());

    const result = await getTeamInviteByToken(RAW_TOKEN);

    expect(result?.state).toBe("pending");
  });

  it("lookup exposes only public-safe team/invite information", async () => {
    mockLookupResult(
      makeInviteRow({
        // These sensitive fields exist in the DB row but must never leak.
        token_hash: hashInviteToken(RAW_TOKEN),
        created_by: "33333333-3333-4333-8333-333333333333",
        team: {
          id: TEAM_A,
          team_name: "Phoenix Pro Stars FC",
          logo_url: null,
          location: null,
          league: null,
          // Internal ownership data that must not leak.
          user_id: "33333333-3333-4333-8333-333333333333",
        },
      }),
    );

    const result = await getTeamInviteByToken(RAW_TOKEN);

    expect(result).not.toBeNull();
    // No raw token, no token hash, no creator, no internal ownership data.
    expect(JSON.stringify(result)).not.toContain("token");
    expect(JSON.stringify(result)).not.toContain("created_by");
    expect(JSON.stringify(result)).not.toContain("accepted_by");
    expect(JSON.stringify(result)).not.toContain("user_id");
    expect(JSON.stringify(result)).not.toContain("33333333-3333-4333-8333-333333333333");
  });

  it("lookup errors do not leak sensitive database information", async () => {
    const handler = createChain();
    handler.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "connection refused (sensitive internal detail)" },
    });
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as any);

    const result = await getTeamInviteByToken(RAW_TOKEN);

    expect(result).toBeNull();
  });
});