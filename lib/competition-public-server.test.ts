import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { getPublicCompetitionResults } from "@/lib/competition-public-server";

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROFILE_1 = "11111111-1111-4111-8111-111111111111";
const PROFILE_2 = "22222222-2222-4222-8222-222222222222";
const PROFILE_3 = "33333333-3333-4333-8333-333333333333";
const PLAYER_PROFILE_1 = "pppppppp-pppp-4ppp-8ppp-pppppppppppp";

type MockFn = ReturnType<typeof vi.fn>;

/**
 * A thenable Supabase query-chain stub. Every builder method returns the same
 * handler and the handler itself is awaitable, so a chain may end at .order(),
 * .in() or .eq() and still resolve to `result`. This lets the public query
 * helper — which awaits different terminal calls per table — be exercised.
 */
function createChain(result: { data: unknown; error: unknown }) {
  const handler: Record<string, unknown> = {};
  const methods = [
    "select",
    "eq",
    "in",
    "order",
    "maybeSingle",
    "single",
    "insert",
    "update",
    "delete",
  ];
  for (const method of methods) {
    handler[method] = vi.fn(() => handler);
  }
  handler.then = (onFulfilled: (value: unknown) => unknown) =>
    Promise.resolve(onFulfilled ? onFulfilled(result) : result);
  return handler as Record<string, MockFn> & { then: unknown };
}

interface TableResponses {
  competition_events?: { data: unknown; error: unknown };
  competition_participants?: { data: unknown; error: unknown };
  player_profiles?: { data: unknown; error: unknown };
  competition_drawings?: { data: unknown; error: unknown };
}

function mockTables(responses: TableResponses) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    const response =
      responses[table as keyof TableResponses] ?? { data: [], error: null };
    return createChain(response) as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("COMP-007: getPublicCompetitionResults — public access", () => {
  it("returns public results without requiring any session", async () => {
    mockTables({
      competition_events: {
        data: [
          {
            id: EVENT_A,
            name: "Downtown Juggle Cup",
            description: "A juggling cup",
            location: "Lagos",
            event_date: "2026-01-01T10:00:00.000Z",
            status: "completed",
            challenge_name: "Juggle Challenge",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        error: null,
      },
      competition_participants: {
        data: [
          {
            event_id: EVENT_A,
            profile_id: PROFILE_1,
            profile: { full_name: "Ada", avatar_url: null },
          },
        ],
        error: null,
      },
      player_profiles: { data: [], error: null },
      competition_drawings: { data: [], error: null },
    });

    const results = await getPublicCompetitionResults();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Downtown Juggle Cup");
  });

  it("returns an empty list when there are no competitions", async () => {
    mockTables({ competition_events: { data: [], error: null } });
    expect(await getPublicCompetitionResults()).toEqual([]);
  });

  it("returns an empty list when the events query errors (no throw)", async () => {
    mockTables({
      competition_events: { data: null, error: { message: "boom" } },
    });
    expect(await getPublicCompetitionResults()).toEqual([]);
  });
});

describe("COMP-007: qualified participants", () => {
  const events = [
    {
      id: EVENT_A,
      name: "Cup",
      description: null,
      location: null,
      event_date: null,
      status: "active",
      challenge_name: "Juggle Challenge",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("includes ONLY qualified participants (server filters by status)", async () => {
    const participantsChain = createChain({
      data: [
        {
          event_id: EVENT_A,
          profile_id: PROFILE_1,
          profile: { full_name: "Qualified One", avatar_url: null },
        },
        {
          event_id: EVENT_A,
          profile_id: PROFILE_2,
          profile: { full_name: "Qualified Two", avatar_url: null },
        },
      ],
      error: null,
    });

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "competition_events") return createChain({ data: events, error: null }) as never;
      if (table === "competition_participants") return participantsChain as never;
      return createChain({ data: [], error: null }) as never;
    });

    const results = await getPublicCompetitionResults();
    expect(results[0].qualifiedCount).toBe(2);
    expect(results[0].qualifiedParticipants.map((p) => p.displayName)).toEqual([
      "Qualified One",
      "Qualified Two",
    ]);

    // The query explicitly filters on the authoritative qualification status.
    expect(participantsChain.eq).toHaveBeenCalledWith("status", "qualified");
  });

  it("shows a placeholder message scenario when nobody qualified (empty list)", async () => {
    mockTables({
      competition_events: { data: events, error: null },
      competition_participants: { data: [], error: null },
      player_profiles: { data: [], error: null },
      competition_drawings: { data: [], error: null },
    });

    const results = await getPublicCompetitionResults();
    expect(results[0].qualifiedCount).toBe(0);
    expect(results[0].qualifiedParticipants).toEqual([]);
  });
});

describe("COMP-007: winner comes from the persisted drawing", () => {
  const events = [
    {
      id: EVENT_A,
      name: "Cup",
      description: null,
      location: null,
      event_date: null,
      status: "completed",
      challenge_name: "Juggle Challenge",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("shows no winner before a drawing exists", async () => {
    mockTables({
      competition_events: { data: events, error: null },
      competition_participants: {
        data: [
          {
            event_id: EVENT_A,
            profile_id: PROFILE_1,
            profile: { full_name: "Ada", avatar_url: null },
          },
        ],
        error: null,
      },
      player_profiles: { data: [], error: null },
      competition_drawings: { data: [], error: null },
    });

    const results = await getPublicCompetitionResults();
    expect(results[0].drawn).toBe(false);
    expect(results[0].winner).toBeNull();
  });

  it("shows the persisted winner when a drawing exists", async () => {
    mockTables({
      competition_events: { data: events, error: null },
      competition_participants: {
        data: [
          {
            event_id: EVENT_A,
            profile_id: PROFILE_1,
            profile: { full_name: "Ada", avatar_url: null },
          },
          {
            event_id: EVENT_A,
            profile_id: PROFILE_2,
            profile: { full_name: "Bola", avatar_url: null },
          },
        ],
        error: null,
      },
      player_profiles: { data: [], error: null },
      competition_drawings: {
        data: [{ event_id: EVENT_A, winner_profile_id: PROFILE_2 }],
        error: null,
      },
    });

    const results = await getPublicCompetitionResults();
    expect(results[0].drawn).toBe(true);
    expect(results[0].winner?.displayName).toBe("Bola");
    // The winner must also be flagged inside the qualified list.
    const flagged = results[0].qualifiedParticipants.filter((p) => p.isWinner);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].displayName).toBe("Bola");
  });

  it("only reads the persisted drawing (never re-selects a random winner)", async () => {
    mockTables({
      competition_events: { data: events, error: null },
      competition_participants: {
        data: [
          {
            event_id: EVENT_A,
            profile_id: PROFILE_1,
            profile: { full_name: "Ada", avatar_url: null },
          },
        ],
        error: null,
      },
      player_profiles: { data: [], error: null },
      competition_drawings: {
        data: [{ event_id: EVENT_A, winner_profile_id: PROFILE_1 }],
        error: null,
      },
    });

    const results = await getPublicCompetitionResults();
    expect(results[0].winner?.displayName).toBe("Ada");
    // No RPC / no random selection is ever invoked by the public helper.
    expect(
      (supabaseAdmin as unknown as { rpc?: unknown }).rpc,
    ).toBeUndefined();
  });
});

describe("COMP-007: player profile linking", () => {
  // A profile with no player_profiles row.
  const PROFILE_NO_MARKETPLACE = PROFILE_3;

  const events = [
    {
      id: EVENT_A,
      name: "Cup",
      description: null,
      location: null,
      event_date: null,
      status: "completed",
      challenge_name: "Juggle Challenge",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("links a participant with a player profile and leaves others unlinked", async () => {
    mockTables({
      competition_events: { data: events, error: null },
      competition_participants: {
        data: [
          {
            event_id: EVENT_A,
            profile_id: PROFILE_1,
            profile: { full_name: "With Profile", avatar_url: null },
          },
          {
            event_id: EVENT_A,
            profile_id: PROFILE_NO_MARKETPLACE,
            profile: { full_name: "No Profile", avatar_url: null },
          },
        ],
        error: null,
      },
      player_profiles: {
        data: [{ id: PLAYER_PROFILE_1, user_id: PROFILE_1 }],
        error: null,
      },
      competition_drawings: { data: [], error: null },
    });

    const results = await getPublicCompetitionResults();
    const withProfile = results[0].qualifiedParticipants.find(
      (p) => p.displayName === "With Profile",
    );
    const withoutProfile = results[0].qualifiedParticipants.find(
      (p) => p.displayName === "No Profile",
    );

    expect(withProfile?.playerProfileId).toBe(PLAYER_PROFILE_1);
    expect(withoutProfile?.playerProfileId).toBeNull();
    // The non-marketplace participant is still visible.
    expect(withoutProfile?.displayName).toBe("No Profile");
  });
});

describe("COMP-007: privacy — no sensitive fields are exposed", () => {
  it("only projects public-safe participant fields", async () => {
    mockTables({
      competition_events: {
        data: [
          {
            id: EVENT_A,
            name: "Cup",
            description: null,
            location: null,
            event_date: null,
            status: "completed",
            challenge_name: "Juggle Challenge",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        error: null,
      },
      competition_participants: {
        data: [
          {
            event_id: EVENT_A,
            profile_id: PROFILE_1,
            profile: { full_name: "Ada", avatar_url: null },
          },
        ],
        error: null,
      },
      player_profiles: { data: [], error: null },
      competition_drawings: {
        data: [{ event_id: EVENT_A, winner_profile_id: PROFILE_1 }],
        error: null,
      },
    });

    const results = await getPublicCompetitionResults();
    const participant = results[0].qualifiedParticipants[0];

    // Exactly the public-safe fields — nothing else.
    expect(Object.keys(participant).sort()).toEqual(
      ["avatarUrl", "displayName", "isWinner", "playerProfileId"].sort(),
    );
    const serialized = JSON.stringify(results);
    // No profiles.id, emails, tokens, codes or internal ids leak through.
    expect(serialized).not.toContain(PROFILE_1);
    expect(serialized).not.toContain(EVENT_A);
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("verification");
  });
});

describe("COMP-007: multiple competitions and ordering", () => {
  it("returns each competition's own participants and drawing", async () => {
    mockTables({
      competition_events: {
        data: [
          {
            id: EVENT_A,
            name: "Newer Cup",
            description: null,
            location: null,
            event_date: null,
            status: "completed",
            challenge_name: "Juggle Challenge",
            created_at: "2026-02-01T00:00:00.000Z",
          },
          {
            id: EVENT_B,
            name: "Older Cup",
            description: null,
            location: null,
            event_date: null,
            status: "active",
            challenge_name: "Sprint Challenge",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        error: null,
      },
      competition_participants: {
        data: [
          {
            event_id: EVENT_A,
            profile_id: PROFILE_1,
            profile: { full_name: "Ada", avatar_url: null },
          },
          {
            event_id: EVENT_B,
            profile_id: PROFILE_2,
            profile: { full_name: "Bola", avatar_url: null },
          },
        ],
        error: null,
      },
      player_profiles: { data: [], error: null },
      competition_drawings: {
        data: [{ event_id: EVENT_A, winner_profile_id: PROFILE_1 }],
        error: null,
      },
    });

    const results = await getPublicCompetitionResults();
    expect(results).toHaveLength(2);

    const newer = results.find((r) => r.name === "Newer Cup")!;
    const older = results.find((r) => r.name === "Older Cup")!;

    expect(newer.winner?.displayName).toBe("Ada");
    expect(newer.drawn).toBe(true);

    expect(older.qualifiedParticipants.map((p) => p.displayName)).toEqual([
      "Bola",
    ]);
    expect(older.winner).toBeNull();
    expect(older.drawn).toBe(false);
  });
});