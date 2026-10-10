import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { withdrawFromCompetition } from "@/lib/competition-join-server";
import { COMPETITION_SELF_REMOVAL_REASON } from "@/lib/competition-join";

/**
 * T-REM-2 — server-side `withdrawFromCompetition`.
 *
 * The Supabase client is mocked with a queue of query builders so each call
 * (`getCompetitionEvent` → participant lookup → maybe attempts → conditional
 * update) can be inspected independently.
 */

type MockFn = ReturnType<typeof vi.fn>;

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_PLAYER = "11111111-1111-4111-8111-111111111111";
const PROFILE_MANAGER = "99999999-9999-4999-8999-999999999999";
const PARTICIPANT_1 = "p1111111-1111-4111-8111-111111111111";

interface Builder {
  select: MockFn;
  eq: MockFn;
  is: MockFn;
  limit: MockFn;
  update: MockFn;
  delete: MockFn;
  maybeSingle: MockFn;
  single: MockFn;
  then: (resolve: (value: unknown) => unknown) => unknown;
}

function makeBuilder(result: { data: unknown; error: unknown }): Builder {
  const builder = {} as Builder;
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.is = vi.fn(self);
  builder.limit = vi.fn(self);
  builder.update = vi.fn(self);
  builder.delete = vi.fn(self);
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve) => resolve(result);
  return builder;
}

let queue: Builder[] = [];

function enqueue(result: { data: unknown; error: unknown }): Builder {
  const builder = makeBuilder(result);
  queue.push(builder);
  return builder;
}

beforeEach(() => {
  queue = [];
  vi.clearAllMocks();
  vi.mocked(supabaseAdmin.from).mockImplementation(
    () => (queue.shift() ?? makeBuilder({ data: null, error: null })) as never,
  );
});

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_A,
    name: "Juggle Challenge",
    description: null,
    location: null,
    event_date: null,
    status: "active",
    challenge_name: "Juggle Challenge",
    challenge_threshold: 30,
    max_attempts: 3,
    created_by: PROFILE_MANAGER,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function participantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTICIPANT_1,
    event_id: EVENT_A,
    profile_id: PROFILE_PLAYER,
    status: "registered",
    checked_in_at: null,
    provider_participant_id: null,
    removed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function fromCallCount(): number {
  return vi.mocked(supabaseAdmin.from).mock.calls.length;
}

// ═══════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════

describe("T-REM-2: withdrawFromCompetition — eligible", () => {
  it("soft-removes the registration and reports success", async () => {
    enqueue({ data: eventRow(), error: null }); // event
    enqueue({ data: participantRow(), error: null }); // own participant
    enqueue({ data: [], error: null }); // no attempts
    const update = enqueue({
      data: { id: PARTICIPANT_1, removed_at: "2026-02-01T00:00:00.000Z" },
      error: null,
    });

    const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.participantId).toBe(PARTICIPANT_1);
      expect(result.data.eventId).toBe(EVENT_A);
      expect(result.data.removedAt).toBe("2026-02-01T00:00:00.000Z");
    }

    // Queried tables in order: event, participant, attempts, participant update.
    const tables = vi
      .mocked(supabaseAdmin.from)
      .mock.calls.map((call) => call[0]);
    expect(tables).toEqual([
      "competition_events",
      "competition_participants",
      "competition_attempts",
      "competition_participants",
    ]);

    // Removal fields are written on the SAME row.
    const patch = update.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.removed_at).toBeTruthy();
    expect(patch.removed_by_profile_id).toBe(PROFILE_PLAYER);
    expect(patch.removal_reason).toBe(COMPETITION_SELF_REMOVAL_REASON);
    // Nothing else is written — no status change, no reactivation.
    expect(Object.keys(patch).sort()).toEqual(
      ["removal_reason", "removed_at", "removed_by_profile_id"].sort(),
    );

    // The update is CONDITIONAL on the eligibility fields still holding.
    const guardColumns = update.is.mock.calls.map((call) => call[0]);
    expect(guardColumns).toContain("removed_at");
    expect(guardColumns).toContain("checked_in_at");
    expect(guardColumns).toContain("provider_participant_id");

    // No hard delete anywhere.
    expect(update.delete).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Eligibility rejections — no write
// ═══════════════════════════════════════════════════════════════

describe("T-REM-2: withdrawFromCompetition — blocked registrations", () => {
  it("rejects a checked-in participant with 409 and writes nothing", async () => {
    enqueue({ data: eventRow(), error: null });
    const participant = enqueue({
      data: participantRow({ checked_in_at: "2026-01-02T09:00:00.000Z" }),
      error: null,
    });

    const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/checked in/i);
    }
    expect(participant.update).not.toHaveBeenCalled();
    expect(fromCallCount()).toBe(2);
  });

  it("rejects a participant with recorded attempts with 409 and writes nothing", async () => {
    enqueue({ data: eventRow(), error: null });
    const participant = enqueue({ data: participantRow(), error: null });
    enqueue({ data: [{ id: "attempt-1" }], error: null });

    const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/challenge|attempt/i);
    }
    expect(participant.update).not.toHaveBeenCalled();
  });

  it("rejects a provider-synced participant with 409 and no provider detail", async () => {
    enqueue({ data: eventRow(), error: null });
    const participant = enqueue({
      data: participantRow({ provider_participant_id: "provider-123" }),
      error: null,
    });

    const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).not.toMatch(/provider-123|challonge/i);
    }
    expect(participant.update).not.toHaveBeenCalled();
  });

  it("rejects an already-removed registration without modifying history", async () => {
    enqueue({ data: eventRow(), error: null });
    const participant = enqueue({
      data: participantRow({ removed_at: "2026-01-01T10:00:00.000Z" }),
      error: null,
    });

    const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/already unregistered/i);
    }
    expect(participant.update).not.toHaveBeenCalled();
  });

  it("rejects withdrawal when the event is not in an active lifecycle state", async () => {
    for (const status of ["draft", "drawing", "completed", "cancelled"]) {
      queue = [];
      enqueue({ data: eventRow({ status }), error: null });
      const participant = enqueue({ data: participantRow(), error: null });

      const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
        expect(result.error).toMatch(/no longer accepting withdrawals/i);
      }
      expect(participant.update).not.toHaveBeenCalled();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Not found / invalid
// ═══════════════════════════════════════════════════════════════

describe("T-REM-2: withdrawFromCompetition — not found / invalid", () => {
  it("returns 404 when the event does not exist", async () => {
    enqueue({ data: null, error: null });
    const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
    expect(fromCallCount()).toBe(1);
  });

  it("returns 404 when the player has no registration for the event", async () => {
    enqueue({ data: eventRow(), error: null });
    enqueue({ data: null, error: null });
    const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toMatch(/not registered/i);
    }
  });

  it("returns 400 and queries nothing when ids are missing", async () => {
    expect((await withdrawFromCompetition("", PROFILE_PLAYER)).ok).toBe(false);
    expect((await withdrawFromCompetition(EVENT_A, "")).ok).toBe(false);
    expect(fromCallCount()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Concurrency & failures
// ═══════════════════════════════════════════════════════════════

describe("T-REM-2: withdrawFromCompetition — concurrency & failures", () => {
  it("returns 409 when the conditional guard no longer matches (stale write)", async () => {
    enqueue({ data: eventRow(), error: null });
    enqueue({ data: participantRow(), error: null });
    enqueue({ data: [], error: null });
    enqueue({ data: null, error: null }); // guard matched zero rows

    const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/changed/i);
    }
  });

  it("returns 500 when the participant lookup fails", async () => {
    enqueue({ data: eventRow(), error: null });
    enqueue({ data: null, error: { message: "boom" } });

    const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
  });

  it("returns 500 when the attempt lookup fails", async () => {
    enqueue({ data: eventRow(), error: null });
    const participant = enqueue({ data: participantRow(), error: null });
    enqueue({ data: null, error: { message: "boom" } });

    const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
    expect(participant.update).not.toHaveBeenCalled();
  });

  it("returns 500 when the update fails", async () => {
    enqueue({ data: eventRow(), error: null });
    enqueue({ data: participantRow(), error: null });
    enqueue({ data: [], error: null });
    enqueue({ data: null, error: { message: "boom" } });

    const result = await withdrawFromCompetition(EVENT_A, PROFILE_PLAYER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
  });
});


