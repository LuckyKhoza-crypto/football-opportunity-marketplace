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
import {
  addCompetitionAmbassador,
  changeCompetitionEventStatus,
  getCompetitionStatistics,
  getCompetitionViewerRole,
  listAmbassadorCompetitionEvents,
  listManagedCompetitionEvents,
  removeCompetitionAmbassador,
  updateCompetitionEvent,
} from "@/lib/competition-server";

type MockFn = ReturnType<typeof vi.fn>;

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_MANAGER = "11111111-1111-4111-8111-111111111111";
const PROFILE_AMBASSADOR = "22222222-2222-4222-8222-222222222222";
const PROFILE_UNRELATED = "33333333-3333-4333-8333-333333333333";

interface Builder {
  select: MockFn;
  eq: MockFn;
  order: MockFn;
  maybeSingle: MockFn;
  single: MockFn;
  insert: MockFn;
  update: MockFn;
  delete: MockFn;
  then: (resolve: (value: unknown) => unknown) => unknown;
}

/**
 * Build a flexible, thenable Supabase query-builder mock. Passthrough methods
 * return the builder so arbitrary chains work; terminal methods (and awaiting
 * the builder itself) resolve to the supplied result. Every method is a
 * vi.fn so tests can assert on the exact filters applied.
 */
function makeBuilder(result: { data: unknown; error: unknown }): Builder {
  const builder = {} as Builder;
  const passthrough = () => builder;
  builder.select = vi.fn(passthrough);
  builder.eq = vi.fn(passthrough);
  builder.insert = vi.fn(passthrough);
  builder.update = vi.fn(passthrough);
  builder.delete = vi.fn(passthrough);
  builder.order = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve) => resolve(result);
  return builder;
}

/**
 * Queue of query builders to be handed out, in order, for successive
 * `supabaseAdmin.from(...)` calls within a single test. Using a resettable
 * queue (rather than `mockImplementationOnce`) guarantees that an unused
 * builder from one test never bleeds into the next.
 */
let fromQueue: Builder[] = [];

function mockFromOnce(result: { data: unknown; error: unknown }): Builder {
  const builder = makeBuilder(result);
  fromQueue.push(builder);
  return builder;
}

beforeEach(() => {
  fromQueue = [];
  vi.clearAllMocks();
  vi.mocked(supabaseAdmin.from).mockImplementation(
    () =>
      (fromQueue.shift() ?? makeBuilder({ data: null, error: null })) as never,
  );
});

describe("COMP-002: getCompetitionViewerRole", () => {
  it("identifies the creator as the manager", async () => {
    // isEventManager → match
    mockFromOnce({ data: { id: EVENT_A }, error: null });

    expect(await getCompetitionViewerRole(EVENT_A, PROFILE_MANAGER)).toBe(
      "manager",
    );
  });

  it("identifies a non-creator with an ambassador row as an ambassador", async () => {
    // isEventManager → no match
    mockFromOnce({ data: null, error: null });
    // isEventAmbassador → match
    mockFromOnce({ data: { id: "amb-1" }, error: null });

    expect(await getCompetitionViewerRole(EVENT_A, PROFILE_AMBASSADOR)).toBe(
      "ambassador",
    );
  });

  it("returns null for an unrelated user", async () => {
    mockFromOnce({ data: null, error: null });
    mockFromOnce({ data: null, error: null });

    expect(await getCompetitionViewerRole(EVENT_A, PROFILE_UNRELATED)).toBeNull();
  });

  it("never queries without an event/profile id", async () => {
    expect(await getCompetitionViewerRole("", PROFILE_MANAGER)).toBeNull();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe("COMP-002: listManagedCompetitionEvents", () => {
  it("lists events created by the profile", async () => {
    const builder = mockFromOnce({
      data: [{ id: EVENT_A, status: "draft" }],
      error: null,
    });

    const events = await listManagedCompetitionEvents(PROFILE_MANAGER);

    expect(events).toHaveLength(1);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("competition_events");
    expect(builder.eq).toHaveBeenCalledWith("created_by", PROFILE_MANAGER);
  });

  it("returns an empty list on error (no throw)", async () => {
    mockFromOnce({ data: null, error: { message: "boom" } });
    expect(await listManagedCompetitionEvents(PROFILE_MANAGER)).toEqual([]);
  });
});

describe("COMP-002: listAmbassadorCompetitionEvents", () => {
  it("resolves events through the ambassador relationship", async () => {
    const builder = mockFromOnce({
      data: [{ event: { id: EVENT_A, status: "active" } }],
      error: null,
    });

    const events = await listAmbassadorCompetitionEvents(PROFILE_AMBASSADOR);

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(EVENT_A);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("competition_ambassadors");
    expect(builder.eq).toHaveBeenCalledWith("profile_id", PROFILE_AMBASSADOR);
  });
});

describe("COMP-002: updateCompetitionEvent authorization", () => {
  it("lets the creator update event configuration", async () => {
    // isEventManager → creator
    mockFromOnce({ data: { id: EVENT_A }, error: null });
    // update chain
    const updateBuilder = mockFromOnce({
      data: { id: EVENT_A, name: "Updated Cup", challenge_threshold: 40 },
      error: null,
    });

    const result = await updateCompetitionEvent(EVENT_A, PROFILE_MANAGER, {
      name: "Updated Cup",
      challenge_threshold: 40,
    });

    expect(result.ok).toBe(true);
    const updateArg = updateBuilder.update.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(updateArg.name).toBe("Updated Cup");
    expect(updateArg.challenge_threshold).toBe(40);
  });

  it("forbids an ambassador from editing event configuration", async () => {
    // isEventManager → no match (an ambassador is never the manager)
    mockFromOnce({ data: null, error: null });

    const result = await updateCompetitionEvent(EVENT_A, PROFILE_AMBASSADOR, {
      name: "Hacked",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });

  it("forbids an unrelated user from editing event configuration", async () => {
    mockFromOnce({ data: null, error: null });

    const result = await updateCompetitionEvent(EVENT_A, PROFILE_UNRELATED, {
      name: "Hacked",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

describe("COMP-002: changeCompetitionEventStatus lifecycle", () => {
  async function attempt(from: string, to: string) {
    // isEventManager → creator
    mockFromOnce({ data: { id: EVENT_A }, error: null });
    // getCompetitionEvent → current status
    mockFromOnce({ data: { id: EVENT_A, status: from }, error: null });
    // update (only reached for valid transitions)
    const updateBuilder = mockFromOnce({
      data: { id: EVENT_A, status: to },
      error: null,
    });
    const result = await changeCompetitionEventStatus(
      EVENT_A,
      PROFILE_MANAGER,
      to as never,
    );
    return { result, updateBuilder };
  }

  const valid: [string, string][] = [
    ["draft", "active"],
    ["draft", "cancelled"],
    ["active", "drawing"],
    ["active", "cancelled"],
    ["drawing", "active"],
    ["drawing", "completed"],
  ];

  for (const [from, to] of valid) {
    it(`allows ${from} → ${to}`, async () => {
      const { result, updateBuilder } = await attempt(from, to);
      expect(result.ok).toBe(true);
      expect(updateBuilder.update).toHaveBeenCalledWith({ status: to });
    });
  }

  const invalid: [string, string][] = [
    ["draft", "completed"],
    ["draft", "drawing"],
    ["completed", "active"],
    ["cancelled", "active"],
    ["active", "completed"],
    ["drawing", "cancelled"],
  ];

  for (const [from, to] of invalid) {
    it(`rejects ${from} → ${to}`, async () => {
      const { result, updateBuilder } = await attempt(from, to);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(409);
      expect(updateBuilder.update).not.toHaveBeenCalled();
    });
  }

  it("forbids an ambassador from changing status", async () => {
    // isEventManager → no match
    mockFromOnce({ data: null, error: null });

    const result = await changeCompetitionEventStatus(
      EVENT_A,
      PROFILE_AMBASSADOR,
      "active",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown status value", async () => {
    const result = await changeCompetitionEventStatus(
      EVENT_A,
      PROFILE_MANAGER,
      "published" as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe("COMP-002: addCompetitionAmbassador", () => {
  it("adds an existing account by email for the creator", async () => {
    // isEventManager → creator
    mockFromOnce({ data: { id: EVENT_A }, error: null });
    // profiles lookup by email
    mockFromOnce({
      data: { id: PROFILE_AMBASSADOR, email: "amb@example.com", full_name: "Amb" },
      error: null,
    });
    // duplicate check → none
    mockFromOnce({ data: null, error: null });
    // insert
    const insertBuilder = mockFromOnce({
      data: { id: "amb-1", event_id: EVENT_A, profile_id: PROFILE_AMBASSADOR },
      error: null,
    });

    const result = await addCompetitionAmbassador(
      EVENT_A,
      PROFILE_MANAGER,
      "amb@example.com",
    );

    expect(result.ok).toBe(true);
    const inserted = insertBuilder.insert.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(inserted.event_id).toBe(EVENT_A);
    // The server resolves the profile — a client can never inject this.
    expect(inserted.profile_id).toBe(PROFILE_AMBASSADOR);
  });

  it("returns a friendly message when no account exists", async () => {
    mockFromOnce({ data: { id: EVENT_A }, error: null }); // manager
    mockFromOnce({ data: null, error: null }); // no profile

    const result = await addCompetitionAmbassador(
      EVENT_A,
      PROFILE_MANAGER,
      "nobody@example.com",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toMatch(/No account found/i);
    }
  });

  it("handles duplicate associations cleanly", async () => {
    mockFromOnce({ data: { id: EVENT_A }, error: null }); // manager
    mockFromOnce({
      data: { id: PROFILE_AMBASSADOR, email: "amb@example.com" },
      error: null,
    });
    // existing association found
    mockFromOnce({ data: { id: "amb-1" }, error: null });

    const result = await addCompetitionAmbassador(
      EVENT_A,
      PROFILE_MANAGER,
      "amb@example.com",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    // No insert attempt was made.
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(3);
  });

  it("forbids an unrelated user from adding ambassadors", async () => {
    mockFromOnce({ data: null, error: null }); // not the manager

    const result = await addCompetitionAmbassador(
      EVENT_A,
      PROFILE_UNRELATED,
      "amb@example.com",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });

  it("forbids an ambassador from adding another ambassador", async () => {
    mockFromOnce({ data: null, error: null }); // ambassador is not the manager

    const result = await addCompetitionAmbassador(
      EVENT_A,
      PROFILE_AMBASSADOR,
      "other@example.com",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("rejects an empty identifier", async () => {
    mockFromOnce({ data: { id: EVENT_A }, error: null }); // manager
    const result = await addCompetitionAmbassador(EVENT_A, PROFILE_MANAGER, "  ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("COMP-002: removeCompetitionAmbassador", () => {
  it("lets the creator remove an ambassador", async () => {
    mockFromOnce({ data: { id: EVENT_A }, error: null }); // manager
    const deleteBuilder = mockFromOnce({ data: null, error: null });

    const result = await removeCompetitionAmbassador(
      EVENT_A,
      PROFILE_MANAGER,
      PROFILE_AMBASSADOR,
    );

    expect(result.ok).toBe(true);
    expect(deleteBuilder.eq).toHaveBeenCalledWith("event_id", EVENT_A);
    expect(deleteBuilder.eq).toHaveBeenCalledWith(
      "profile_id",
      PROFILE_AMBASSADOR,
    );
  });

  it("forbids an unrelated user from removing ambassadors", async () => {
    mockFromOnce({ data: null, error: null });

    const result = await removeCompetitionAmbassador(
      EVENT_A,
      PROFILE_UNRELATED,
      PROFILE_AMBASSADOR,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

describe("COMP-002: getCompetitionStatistics", () => {
  it("returns zero counts gracefully when there is no data", async () => {
    // participants
    mockFromOnce({ data: [], error: null });
    // ambassadors
    mockFromOnce({ data: [], error: null });

    const stats = await getCompetitionStatistics(EVENT_A);
    expect(stats).toEqual({
      total: 0,
      registered: 0,
      challenge_pending: 0,
      qualified: 0,
      not_qualified: 0,
      ambassadors: 0,
    });
  });

  it("counts participants by status and ambassadors", async () => {
    mockFromOnce({
      data: [
        { status: "registered" },
        { status: "qualified" },
        { status: "qualified" },
        { status: "not_qualified" },
      ],
      error: null,
    });
    mockFromOnce({ data: [{ id: "a" }], error: null });

    const stats = await getCompetitionStatistics(EVENT_A);
    expect(stats.total).toBe(4);
    expect(stats.qualified).toBe(2);
    expect(stats.not_qualified).toBe(1);
    expect(stats.registered).toBe(1);
    expect(stats.ambassadors).toBe(1);
  });
});