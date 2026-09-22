import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
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
  getQualifiedParticipantCount,
  getCompetitionDrawing,
  startCompetitionDrawing,
} from "@/lib/competition-drawing-server";

type MockFn = ReturnType<typeof vi.fn>;

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_MANAGER = "11111111-1111-4111-8111-111111111111";
const PROFILE_AMBASSADOR = "22222222-2222-4222-8222-222222222222";
const PROFILE_UNRELATED = "33333333-3333-4333-8333-333333333333";
const WINNER_PROFILE = "44444444-4444-4444-8444-444444444444";

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

function makeBuilder(result: Record<string, unknown>): Builder {
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

let fromQueue: Builder[] = [];

function mockFromOnce(result: Record<string, unknown>): Builder {
  const builder = makeBuilder(result);
  fromQueue.push(builder);
  return builder;
}

beforeEach(() => {
  fromQueue = [];
  vi.clearAllMocks();
  vi.mocked(supabaseAdmin.from).mockImplementation(
    () =>
      (fromQueue.shift() ??
        makeBuilder({ data: null, error: null })) as never,
  );
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
    data: null,
    error: null,
  } as never);
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

/** Queue a manager authorization match (creator). */
function mockManagerAuthorized() {
  mockFromOnce({ data: { id: EVENT_A }, error: null }); // isEventManager
}

/** Queue an ambassador authorization match (not creator). */
function mockAmbassadorAuthorized() {
  mockFromOnce({ data: null, error: null }); // isEventManager → no
  mockFromOnce({ data: { id: "amb-1" }, error: null }); // isEventAmbassador → yes
}

/** Queue an unrelated user (neither manager nor ambassador). */
function mockUnauthorized() {
  mockFromOnce({ data: null, error: null }); // isEventManager → no
  mockFromOnce({ data: null, error: null }); // isEventAmbassador → no
}

// ═══════════════════════════════════════════════════════════════
// getQualifiedParticipantCount
// ═══════════════════════════════════════════════════════════════

describe("COMP-006: getQualifiedParticipantCount", () => {
  it("counts only qualified participants, scoped to the event", async () => {
    const builder = mockFromOnce({ count: 4, data: null, error: null });
    const count = await getQualifiedParticipantCount(EVENT_A);
    expect(count).toBe(4);
    expect(builder.eq).toHaveBeenCalledWith("event_id", EVENT_A);
    expect(builder.eq).toHaveBeenCalledWith("status", "qualified");
  });

  it("returns 0 without querying for a missing event id", async () => {
    expect(await getQualifiedParticipantCount("")).toBe(0);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// startCompetitionDrawing — authorization
// ═══════════════════════════════════════════════════════════════

describe("COMP-006: startCompetitionDrawing authorization", () => {
  it("lets the creator start the drawing", async () => {
    mockManagerAuthorized();
    mockFromOnce({ data: eventRow(), error: null }); // getCompetitionEvent
    mockFromOnce({ count: 3, data: null, error: null }); // qualified count
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: {
        success: true,
        drawing_id: "draw-1",
        winner_participant_id: "part-1",
        winner_profile_id: WINNER_PROFILE,
        qualified_participant_count: 3,
        drawn_at: "2026-09-21T15:42:00Z",
        drawn_by_profile_id: PROFILE_MANAGER,
      },
      error: null,
    } as never);
    mockFromOnce({ data: { full_name: "Ada Lovelace" }, error: null }); // winner name

    const result = await startCompetitionDrawing(EVENT_A, PROFILE_MANAGER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.winnerName).toBe("Ada Lovelace");
    expect(result.data.qualifiedParticipantCount).toBe(3);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("start_competition_drawing", {
      p_event_id: EVENT_A,
      p_user_id: PROFILE_MANAGER,
    });
  });

  it("lets an assigned ambassador start the drawing", async () => {
    mockAmbassadorAuthorized();
    mockFromOnce({ data: eventRow(), error: null });
    mockFromOnce({ count: 2, data: null, error: null });
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: {
        success: true,
        winner_profile_id: WINNER_PROFILE,
        qualified_participant_count: 2,
        drawn_at: "2026-09-21T15:42:00Z",
      },
      error: null,
    } as never);
    mockFromOnce({ data: { full_name: "Grace Hopper" }, error: null });

    const result = await startCompetitionDrawing(
      EVENT_A,
      PROFILE_AMBASSADOR,
    );
    expect(result.ok).toBe(true);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("start_competition_drawing", {
      p_event_id: EVENT_A,
      p_user_id: PROFILE_AMBASSADOR,
    });
  });

  it("rejects an unrelated authenticated user (no rpc call)", async () => {
    mockUnauthorized();
    const result = await startCompetitionDrawing(
      EVENT_A,
      PROFILE_UNRELATED,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
  });

  it("rejects a participant (neither manager nor ambassador)", async () => {
    mockUnauthorized();
    const result = await startCompetitionDrawing(EVENT_A, "participant");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// startCompetitionDrawing — eligibility & error mapping
// ═══════════════════════════════════════════════════════════════

describe("COMP-006: startCompetitionDrawing eligibility", () => {
  it("prevents the drawing when zero participants qualified", async () => {
    mockManagerAuthorized();
    mockFromOnce({ data: eventRow(), error: null });
    mockFromOnce({ count: 0, data: null, error: null }); // no qualified

    const result = await startCompetitionDrawing(EVENT_A, PROFILE_MANAGER);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/no qualified participants/i);
    }
    // The atomic RPC must never run without eligible participants.
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("maps DRAWING_ALREADY_EXISTS to 409", async () => {
    mockManagerAuthorized();
    mockFromOnce({ data: eventRow(), error: null });
    mockFromOnce({ count: 2, data: null, error: null });
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: false, error: "DRAWING_ALREADY_EXISTS" },
      error: null,
    } as never);

    const result = await startCompetitionDrawing(EVENT_A, PROFILE_MANAGER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("maps EVENT_NOT_DRAWABLE to 409", async () => {
    mockManagerAuthorized();
    mockFromOnce({ data: eventRow({ status: "draft" }), error: null });
    mockFromOnce({ count: 2, data: null, error: null });
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: false, error: "EVENT_NOT_DRAWABLE" },
      error: null,
    } as never);

    const result = await startCompetitionDrawing(EVENT_A, PROFILE_MANAGER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("maps UNAUTHORIZED from the RPC to 403", async () => {
    mockManagerAuthorized();
    mockFromOnce({ data: eventRow(), error: null });
    mockFromOnce({ count: 2, data: null, error: null });
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: false, error: "UNAUTHORIZED" },
      error: null,
    } as never);

    const result = await startCompetitionDrawing(EVENT_A, PROFILE_MANAGER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════
// startCompetitionDrawing — result persistence
// ═══════════════════════════════════════════════════════════════

describe("COMP-006: startCompetitionDrawing result", () => {
  it("returns the server-selected winner, count and timestamp", async () => {
    mockManagerAuthorized();
    mockFromOnce({ data: eventRow(), error: null });
    mockFromOnce({ count: 8, data: null, error: null });
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: {
        success: true,
        drawing_id: "draw-9",
        winner_participant_id: "part-9",
        winner_profile_id: WINNER_PROFILE,
        qualified_participant_count: 8,
        drawn_at: "2026-09-21T15:42:00Z",
        drawn_by_profile_id: PROFILE_MANAGER,
      },
      error: null,
    } as never);
    const profilesBuilder = mockFromOnce({
      data: { full_name: "Winner Name" },
      error: null,
    });

    const result = await startCompetitionDrawing(EVENT_A, PROFILE_MANAGER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      winnerName: "Winner Name",
      qualifiedParticipantCount: 8,
      drawnAt: "2026-09-21T15:42:00Z",
    });
    // The winner profile is resolved server-side from the persisted id.
    expect(profilesBuilder.eq).toHaveBeenCalledWith("id", WINNER_PROFILE);
  });

  it("passes ONLY the event id + profile id to the RPC (no client winner)", async () => {
    mockManagerAuthorized();
    mockFromOnce({ data: eventRow(), error: null });
    mockFromOnce({ count: 2, data: null, error: null });
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: {
        success: true,
        winner_profile_id: WINNER_PROFILE,
        qualified_participant_count: 2,
        drawn_at: "2026-09-21T15:42:00Z",
      },
      error: null,
    } as never);
    mockFromOnce({ data: { full_name: "X" }, error: null });

    await startCompetitionDrawing(EVENT_A, PROFILE_MANAGER);

    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0];
    expect(rpcArgs[0]).toBe("start_competition_drawing");
    expect(Object.keys(rpcArgs[1] as object).sort()).toEqual([
      "p_event_id",
      "p_user_id",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
// getCompetitionDrawing
// ═══════════════════════════════════════════════════════════════

describe("COMP-006: getCompetitionDrawing", () => {
  it("returns the display-safe drawing for a manager", async () => {
    mockManagerAuthorized();
    mockFromOnce({
      data: {
        id: "draw-1",
        event_id: EVENT_A,
        winner_profile_id: WINNER_PROFILE,
        qualified_participant_count: 6,
        drawn_at: "2026-09-21T15:42:00Z",
      },
      error: null,
    });
    mockFromOnce({ data: { full_name: "Ada" }, error: null });

    const drawing = await getCompetitionDrawing(EVENT_A, PROFILE_MANAGER);
    expect(drawing).toEqual({
      winnerName: "Ada",
      qualifiedParticipantCount: 6,
      drawnAt: "2026-09-21T15:42:00Z",
    });
    // No internal ids are leaked to the view.
    expect(drawing).not.toHaveProperty("id");
    expect(drawing).not.toHaveProperty("winner_profile_id");
  });

  it("returns null for an unrelated user (no drawing query)", async () => {
    mockUnauthorized();
    const drawing = await getCompetitionDrawing(EVENT_A, PROFILE_UNRELATED);
    expect(drawing).toBeNull();
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
  });

  it("returns null when no drawing exists", async () => {
    mockManagerAuthorized();
    mockFromOnce({ data: null, error: null });
    const drawing = await getCompetitionDrawing(EVENT_A, PROFILE_MANAGER);
    expect(drawing).toBeNull();
  });
});