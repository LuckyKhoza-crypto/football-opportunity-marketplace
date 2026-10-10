import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock("@/lib/competition-server", () => ({
  canManageEvent: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { canManageEvent } from "@/lib/competition-server";
import {
  banCompetitionParticipant,
  getBannedProfileIds,
  isProfileBannedFromEvent,
  removeCompetitionParticipant,
} from "@/lib/competition-participant-admin-server";
import {
  COMPETITION_HOST_BAN_REASON,
  COMPETITION_HOST_REMOVAL_REASON,
  PARTICIPANT_REMOVAL_MESSAGES,
} from "@/lib/competition-participant-admin";

/**
 * T-REM-3 — server helpers.
 *
 * The Supabase client is mocked: `canManageEvent` (authorization) and the atomic
 * `remove_competition_participant` RPC are inspected independently.
 */

type MockFn = ReturnType<typeof vi.fn>;

interface Builder {
  select: MockFn;
  eq: MockFn;
  maybeSingle: MockFn;
  then: (resolve: (value: unknown) => unknown) => unknown;
}

function makeBuilder(result: { data: unknown; error: unknown }): Builder {
  const builder = {} as Builder;
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve) => resolve(result);
  return builder;
}

let fromQueue: Builder[] = [];

function enqueue(result: { data: unknown; error: unknown }): Builder {
  const builder = makeBuilder(result);
  fromQueue.push(builder);
  return builder;
}

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "99999999-9999-4999-8999-999999999999";
const PARTICIPANT_1 = "p1111111-1111-4111-8111-111111111111";

function rpcSuccess(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    participant_id: PARTICIPANT_1,
    profile_id: "profile-x",
    removed: true,
    already_removed: false,
    removed_at: "2026-02-01T00:00:00.000Z",
    banned: false,
    already_banned: false,
    banned_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  fromQueue = [];
  vi.clearAllMocks();
  vi.mocked(supabaseAdmin.from).mockImplementation(
    (): never => (fromQueue.shift() ?? makeBuilder({ data: null, error: null })) as never,
  );
});

describe("T-REM-3: isProfileBannedFromEvent", () => {
  it("returns true when a ban row exists", async () => {
    const builder = enqueue({ data: { id: "ban-1" }, error: null });
    expect(await isProfileBannedFromEvent(EVENT_A, MANAGER)).toBe(true);
    expect(builder.eq).toHaveBeenCalledWith("event_id", EVENT_A);
    expect(builder.eq).toHaveBeenCalledWith("profile_id", MANAGER);
  });

  it("returns false when no ban row exists", async () => {
    enqueue({ data: null, error: null });
    expect(await isProfileBannedFromEvent(EVENT_A, MANAGER)).toBe(false);
  });

  it("returns false without querying for missing ids", async () => {
    expect(await isProfileBannedFromEvent("", MANAGER)).toBe(false);
    expect(await isProfileBannedFromEvent(EVENT_A, "")).toBe(false);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("returns false and logs on a query error", async () => {
    enqueue({ data: null, error: { message: "boom" } });
    expect(await isProfileBannedFromEvent(EVENT_A, MANAGER)).toBe(false);
  });
});

describe("T-REM-3: getBannedProfileIds", () => {
  it("maps ban rows to profile ids", async () => {
    enqueue({ data: [{ profile_id: "p1" }, { profile_id: "p2" }], error: null });
    expect(await getBannedProfileIds(EVENT_A)).toEqual(["p1", "p2"]);
  });

  it("returns [] without querying for a missing event", async () => {
    expect(await getBannedProfileIds("")).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("returns [] on a query error", async () => {
    enqueue({ data: null, error: { message: "boom" } });
    expect(await getBannedProfileIds(EVENT_A)).toEqual([]);
  });
});

describe("T-REM-3: removeCompetitionParticipant", () => {
  it("returns 400 without checking authorization when args are missing", async () => {
    const result = await removeCompetitionParticipant("", MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(canManageEvent).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("returns 403 and never calls the RPC for an unauthorized caller", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(false);

    const result = await removeCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("removes via the atomic RPC (no ban) and reports the removed timestamp", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcSuccess(), error: null } as never);

    const result = await removeCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.removedAt).toBe("2026-02-01T00:00:00.000Z");

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("remove_competition_participant", {
      p_event_id: EVENT_A,
      p_participant_id: PARTICIPANT_1,
      p_actor_profile_id: MANAGER,
      p_removal_reason: COMPETITION_HOST_REMOVAL_REASON,
      p_ban: false,
      p_ban_reason: null,
    });
  });

  it("treats an already-removed participant as a 409 (idempotent, no history touched)", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: rpcSuccess({ removed: false, already_removed: true }),
      error: null,
    } as never);

    const result = await removeCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toBe(PARTICIPANT_REMOVAL_MESSAGES.alreadyRemoved);
  });

  it("maps a provider-synced participant to an actionable 409", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: false, error: "PARTICIPANT_PROVIDER_MAPPED" },
      error: null,
    } as never);

    const result = await removeCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toBe(PARTICIPANT_REMOVAL_MESSAGES.providerMapped);
  });

  it("maps the RPC error codes to the right statuses", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(true);
    const cases: [string, number, string][] = [
      ["EVENT_NOT_ACTIVE", 409, PARTICIPANT_REMOVAL_MESSAGES.eventNotActive],
      ["PARTICIPANT_CHECKED_IN", 409, PARTICIPANT_REMOVAL_MESSAGES.checkedIn],
      ["PARTICIPANT_HAS_ATTEMPTS", 409, PARTICIPANT_REMOVAL_MESSAGES.hasAttempts],
      ["PARTICIPANT_STATE_CHANGED", 409, PARTICIPANT_REMOVAL_MESSAGES.stateChanged],
      ["PARTICIPANT_NOT_FOUND", 404, PARTICIPANT_REMOVAL_MESSAGES.notFound],
      ["CANNOT_TARGET_SELF", 400, PARTICIPANT_REMOVAL_MESSAGES.cannotTargetSelf],
      ["UNAUTHORIZED", 403, PARTICIPANT_REMOVAL_MESSAGES.unauthorized],
    ];
    for (const [code, status, message] of cases) {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
        data: { success: false, error: code },
        error: null,
      } as never);
      const result = await removeCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.status).toBe(status);
      expect(result.error).toBe(message);
    }
  });

  it("authorizes the acting profile through the shared creator-or-ambassador rule", async () => {
    // canManageEvent is the single creator-OR-ambassador authorization rule, so
    // an assigned ambassador (a non-creator whose canManageEvent resolves true)
    // removes exactly like the creator.
    vi.mocked(canManageEvent).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcSuccess(), error: null } as never);

    await removeCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);

    expect(canManageEvent).toHaveBeenCalledWith(EVENT_A, MANAGER);
  });

  it("returns a 500 when the RPC transport fails", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "x" } } as never);

    const result = await removeCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);
  });
});


describe("T-REM-3: banCompetitionParticipant", () => {
  it("returns 403 and never calls the RPC for an unauthorized caller", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(false);

    const result = await banCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("bans an active participant and removes them in one atomic RPC call", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: rpcSuccess({
        banned: true,
        banned_at: "2026-02-01T00:00:00.000Z",
        removed: true,
      }),
      error: null,
    } as never);

    const result = await banCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created).toBe(true);
    expect(result.data.alreadyBanned).toBe(false);
    expect(result.data.removed).toBe(true);

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("remove_competition_participant", {
      p_event_id: EVENT_A,
      p_participant_id: PARTICIPANT_1,
      p_actor_profile_id: MANAGER,
      p_removal_reason: COMPETITION_HOST_BAN_REASON,
      p_ban: true,
      p_ban_reason: null,
    });
  });

  it("is idempotent for a duplicate ban request", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: rpcSuccess({
        banned: true,
        already_banned: true,
        already_removed: true,
        removed: false,
        banned_at: "2026-01-01T00:00:00.000Z",
      }),
      error: null,
    } as never);

    const result = await banCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.alreadyBanned).toBe(true);
    expect(result.data.created).toBe(false);
    expect(result.data.removed).toBe(false);
  });

  it("bans a previously removed participant without re-removing them", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: rpcSuccess({ banned: true, removed: false, already_removed: true }),
      error: null,
    } as never);

    const result = await banCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.removed).toBe(false);
    expect(result.data.created).toBe(true);
  });

  it("rejects an unsafe lifecycle state (provider-synced) with no partial result", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: false, error: "PARTICIPANT_PROVIDER_MAPPED" },
      error: null,
    } as never);

    const result = await banCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toBe(PARTICIPANT_REMOVAL_MESSAGES.providerMapped);
  });

  it("forwards a trimmed reason and nulls a blank one", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: rpcSuccess({ banned: true }),
      error: null,
    } as never);

    await banCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1, "  cheating  ");
    expect(supabaseAdmin.rpc).toHaveBeenLastCalledWith(
      "remove_competition_participant",
      expect.objectContaining({ p_ban_reason: "cheating" }),
    );

    await banCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1, "   ");
    expect(supabaseAdmin.rpc).toHaveBeenLastCalledWith(
      "remove_competition_participant",
      expect.objectContaining({ p_ban_reason: null }),
    );
  });

  it("returns a 500 when the RPC transport fails", async () => {
    vi.mocked(canManageEvent).mockResolvedValue(true);
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "x" } } as never);

    const result = await banCompetitionParticipant(EVENT_A, MANAGER, PARTICIPANT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);
  });
});

