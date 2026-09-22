import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { getServerSession } from "next-auth";
import {
  getAuthenticatedProfileId,
  getCompetitionEvent,
  isEventManager,
  isEventAmbassador,
  canManageEvent,
  getCompetitionParticipant,
  getCompetitionParticipants,
  createCompetitionEvent,
} from "@/lib/competition-server";

type MockFn = ReturnType<typeof vi.fn>;

interface QueryChain {
  select: MockFn;
  eq: MockFn;
  order: MockFn;
  maybeSingle: MockFn;
  single: MockFn;
  insert: MockFn;
}

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROFILE_1 = "11111111-1111-4111-8111-111111111111";
const PROFILE_2 = "22222222-2222-4222-8222-222222222222";
// A profile that has NO player_profiles row — just a profiles account.
const PROFILE_NO_MARKETPLACE = "33333333-3333-4333-8333-333333333333";

function createChain(): QueryChain {
  const handler: QueryChain = {
    select: vi.fn(() => handler),
    eq: vi.fn(() => handler),
    order: vi.fn(() => handler),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    insert: vi.fn(() => handler),
  };
  return handler;
}

function mockMaybeSingle(result: { data: unknown; error: unknown }) {
  const handler = createChain();
  handler.maybeSingle.mockResolvedValue(result);
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as never);
  return handler;
}

function mockArrayResult(result: { data: unknown; error: unknown }) {
  const handler = createChain();
  // getCompetitionParticipants / Ambassadors await the chain directly after
  // .order(); emulate a thenable by resolving order().
  handler.order.mockResolvedValue(result);
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => handler as never);
  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  // COMP-007: competition creation is restricted to MULTI_TEAM_ADMIN_USER_ID.
  // Set the configured admin to PROFILE_1 so the ownership/insert tests pass
  // through the authoritative check (this file verifies ownership, not authz).
  process.env.MULTI_TEAM_ADMIN_USER_ID = PROFILE_1;
});

describe("COMP-001: getAuthenticatedProfileId", () => {
  it("returns the authenticated profiles.id from the session", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: PROFILE_1, email: "player@example.com" },
    } as never);

    expect(await getAuthenticatedProfileId()).toBe(PROFILE_1);
  });

  it("returns null when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    expect(await getAuthenticatedProfileId()).toBeNull();
  });

  it("returns null when the session has no profile id", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: "no-id@example.com" },
    } as never);
    expect(await getAuthenticatedProfileId()).toBeNull();
  });
});

describe("COMP-001: event ownership / authorization foundation", () => {
  it("recognises the event creator as the manager", async () => {
    mockMaybeSingle({ data: { id: EVENT_A }, error: null });

    expect(await isEventManager(EVENT_A, PROFILE_1)).toBe(true);

    const handler = vi.mocked(supabaseAdmin.from).mock.results[0]
      .value as QueryChain;
    expect(handler.eq).toHaveBeenCalledWith("id", EVENT_A);
    expect(handler.eq).toHaveBeenCalledWith("created_by", PROFILE_1);
  });

  it("does not treat a non-creator as the manager", async () => {
    mockMaybeSingle({ data: null, error: null });
    expect(await isEventManager(EVENT_A, PROFILE_2)).toBe(false);
  });

  it("never queries when the event id or profile id is missing", async () => {
    expect(await isEventManager("", PROFILE_1)).toBe(false);
    expect(await isEventManager(EVENT_A, "")).toBe(false);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("recognises an ambassador from competition_ambassadors only", async () => {
    mockMaybeSingle({ data: { id: "amb-1" }, error: null });

    expect(await isEventAmbassador(EVENT_A, PROFILE_NO_MARKETPLACE)).toBe(true);

    const handler = vi.mocked(supabaseAdmin.from).mock.results[0]
      .value as QueryChain;
    expect(handler.eq).toHaveBeenCalledWith("event_id", EVENT_A);
    expect(handler.eq).toHaveBeenCalledWith(
      "profile_id",
      PROFILE_NO_MARKETPLACE,
    );
  });

  it("ambassador authorization is event-specific (different event → not an ambassador)", async () => {
    // First lookup (EVENT_A) finds the association.
    mockMaybeSingle({ data: { id: "amb-1" }, error: null });
    expect(await isEventAmbassador(EVENT_A, PROFILE_1)).toBe(true);

    // Second lookup (EVENT_B) finds nothing.
    mockMaybeSingle({ data: null, error: null });
    expect(await isEventAmbassador(EVENT_B, PROFILE_1)).toBe(false);
  });

  it("canManageEvent is true for a manager and for an ambassador", async () => {
    // Manager path: isEventManager matches.
    mockMaybeSingle({ data: { id: EVENT_A }, error: null });
    expect(await canManageEvent(EVENT_A, PROFILE_1)).toBe(true);
  });

  it("canManageEvent is true for an ambassador who is not the manager", async () => {
    // isEventManager → no match.
    mockMaybeSingle({ data: null, error: null });
    // isEventAmbassador → match.
    mockMaybeSingle({ data: { id: "amb-1" }, error: null });

    expect(await canManageEvent(EVENT_A, PROFILE_2)).toBe(true);
  });

  it("canManageEvent is false for an unrelated user", async () => {
    mockMaybeSingle({ data: null, error: null });
    mockMaybeSingle({ data: null, error: null });

    expect(await canManageEvent(EVENT_A, PROFILE_2)).toBe(false);
  });
});

describe("COMP-001: participants reference profiles (not player_profiles)", () => {
  it("returns a participant whose profile_id is a profiles.id", async () => {
    mockMaybeSingle({
      data: {
        id: "part-1",
        event_id: EVENT_A,
        // profiles.id — this profile has no player_profiles row.
        profile_id: PROFILE_NO_MARKETPLACE,
        status: "registered",
        checked_in_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });

    const participant = await getCompetitionParticipant(
      EVENT_A,
      PROFILE_NO_MARKETPLACE,
    );

    expect(participant).not.toBeNull();
    expect(participant?.profile_id).toBe(PROFILE_NO_MARKETPLACE);
    expect(participant?.event_id).toBe(EVENT_A);
  });

  it("looks the participant up by event_id + profile_id (so a profile can join many events)", async () => {
    mockMaybeSingle({ data: null, error: null });
    await getCompetitionParticipant(EVENT_B, PROFILE_1);

    const handler = vi.mocked(supabaseAdmin.from).mock.results[0]
      .value as QueryChain;
    expect(supabaseAdmin.from).toHaveBeenCalledWith("competition_participants");
    expect(handler.eq).toHaveBeenCalledWith("event_id", EVENT_B);
    expect(handler.eq).toHaveBeenCalledWith("profile_id", PROFILE_1);
  });

  it("returns null when the profile is not registered for the event", async () => {
    mockMaybeSingle({ data: null, error: null });
    expect(await getCompetitionParticipant(EVENT_A, PROFILE_1)).toBeNull();
  });

  it("does not query when event or profile is missing", async () => {
    expect(await getCompetitionParticipant("", PROFILE_1)).toBeNull();
    expect(await getCompetitionParticipant(EVENT_A, "")).toBeNull();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("lists participants for an event", async () => {
    mockArrayResult({
      data: [
        { id: "p1", event_id: EVENT_A, profile_id: PROFILE_1 },
        { id: "p2", event_id: EVENT_A, profile_id: PROFILE_2 },
      ],
      error: null,
    });

    const participants = await getCompetitionParticipants(EVENT_A);
    expect(participants).toHaveLength(2);
    expect(participants[0].event_id).toBe(EVENT_A);
  });

  it("returns an empty list on query error (no throw)", async () => {
    mockArrayResult({ data: null, error: { message: "boom" } });
    expect(await getCompetitionParticipants(EVENT_A)).toEqual([]);
  });
});

describe("COMP-001: createCompetitionEvent ownership", () => {
  it("stores the server-resolved created_by, never a client value", async () => {
    const chain = createChain();
    chain.single.mockResolvedValue({
      data: {
        id: EVENT_A,
        created_by: PROFILE_1,
        challenge_threshold: 30,
        max_attempts: 3,
      },
      error: null,
    });
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => chain as never);

    const event = await createCompetitionEvent(
      {
        name: "Downtown Juggle Cup",
        challenge_name: "Juggle Challenge",
        challenge_threshold: 30,
        max_attempts: 3,
      },
      PROFILE_1,
    );

    expect(event?.created_by).toBe(PROFILE_1);
    const inserted = chain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.created_by).toBe(PROFILE_1);
    expect(inserted.challenge_threshold).toBe(30);
    expect(inserted.max_attempts).toBe(3);
  });

  it("returns null when there is no authenticated profile", async () => {
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

  it("returns null on insert error (no throw)", async () => {
    const chain = createChain();
    chain.single.mockResolvedValue({
      data: null,
      error: { message: "duplicate" },
    });
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => chain as never);

    const event = await createCompetitionEvent(
      {
        name: "Broken Cup",
        challenge_name: "Juggle Challenge",
        challenge_threshold: 30,
        max_attempts: 3,
      },
      PROFILE_1,
    );
    expect(event).toBeNull();
  });
});

describe("COMP-001: getCompetitionEvent", () => {
  it("returns the event when found", async () => {
    mockMaybeSingle({
      data: { id: EVENT_A, status: "draft", challenge_threshold: 30 },
      error: null,
    });
    const event = await getCompetitionEvent(EVENT_A);
    expect(event?.id).toBe(EVENT_A);
  });

  it("returns null for an empty id without querying", async () => {
    expect(await getCompetitionEvent("")).toBeNull();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});