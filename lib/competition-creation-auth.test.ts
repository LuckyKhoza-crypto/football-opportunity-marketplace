import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  isCompetitionCreationAdmin,
  createCompetitionEvent,
} from "@/lib/competition-server";

type MockFn = ReturnType<typeof vi.fn>;

const ADMIN_ID = "admin-user-123";
const AMBASSADOR_ID = "ambassador-456";
const PLAYER_ID = "player-789";

const ORIGINAL_ADMIN = process.env.MULTI_TEAM_ADMIN_USER_ID;

function createChain() {
  const handler: Record<string, MockFn> & { then?: unknown } = {};
  const methods = ["select", "eq", "order", "maybeSingle", "single", "insert"];
  for (const method of methods) {
    handler[method] = vi.fn(() => handler);
  }
  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MULTI_TEAM_ADMIN_USER_ID;
});

afterEach(() => {
  if (ORIGINAL_ADMIN === undefined) {
    delete process.env.MULTI_TEAM_ADMIN_USER_ID;
  } else {
    process.env.MULTI_TEAM_ADMIN_USER_ID = ORIGINAL_ADMIN;
  }
});

describe("COMP-007: isCompetitionCreationAdmin", () => {
  it("returns true only for the configured admin user id", () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = ADMIN_ID;
    expect(isCompetitionCreationAdmin(ADMIN_ID)).toBe(true);
  });

  it("returns false for an ambassador who is not the admin", () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = ADMIN_ID;
    expect(isCompetitionCreationAdmin(AMBASSADOR_ID)).toBe(false);
  });

  it("returns false for a normal player", () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = ADMIN_ID;
    expect(isCompetitionCreationAdmin(PLAYER_ID)).toBe(false);
  });

  it("returns false for a null/undefined/empty profile id", () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = ADMIN_ID;
    expect(isCompetitionCreationAdmin(null)).toBe(false);
    expect(isCompetitionCreationAdmin(undefined)).toBe(false);
    expect(isCompetitionCreationAdmin("")).toBe(false);
  });

  it("FAILS CLOSED when MULTI_TEAM_ADMIN_USER_ID is missing", () => {
    // Even for a plausible-looking id, no configured admin means no creation.
    expect(isCompetitionCreationAdmin(ADMIN_ID)).toBe(false);
    expect(isCompetitionCreationAdmin("anybody")).toBe(false);
  });
});

describe("COMP-007: createCompetitionEvent authorization", () => {
  it("allows the configured admin to create a competition", async () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = ADMIN_ID;

    const chain = createChain();
    chain.single.mockResolvedValue({
      data: { id: "event-1", created_by: ADMIN_ID, status: "draft" },
      error: null,
    });
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => chain as never);

    const event = await createCompetitionEvent(
      {
        name: "Admin Cup",
        challenge_name: "Juggle Challenge",
        challenge_threshold: 30,
        max_attempts: 3,
      },
      ADMIN_ID,
    );

    expect(event?.created_by).toBe(ADMIN_ID);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("competition_events");
  });

  it("rejects an ambassador — no insert occurs", async () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = ADMIN_ID;

    const event = await createCompetitionEvent(
      {
        name: "Ambassador Cup",
        challenge_name: "Juggle Challenge",
        challenge_threshold: 30,
        max_attempts: 3,
      },
      AMBASSADOR_ID,
    );

    expect(event).toBeNull();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("rejects a normal player — no insert occurs", async () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = ADMIN_ID;

    const event = await createCompetitionEvent(
      {
        name: "Player Cup",
        challenge_name: "Juggle Challenge",
        challenge_threshold: 30,
        max_attempts: 3,
      },
      PLAYER_ID,
    );

    expect(event).toBeNull();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when MULTI_TEAM_ADMIN_USER_ID is missing", async () => {
    // No env var configured → nobody may create, not even a real id.
    const event = await createCompetitionEvent(
      {
        name: "No Admin Cup",
        challenge_name: "Juggle Challenge",
        challenge_threshold: 30,
        max_attempts: 3,
      },
      ADMIN_ID,
    );

    expect(event).toBeNull();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("returns null for an unauthenticated (empty) profile id", async () => {
    process.env.MULTI_TEAM_ADMIN_USER_ID = ADMIN_ID;

    const event = await createCompetitionEvent(
      {
        name: "No Auth Cup",
        challenge_name: "Juggle Challenge",
        challenge_threshold: 30,
        max_attempts: 3,
      },
      "",
    );

    expect(event).toBeNull();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});