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
import { hashVerificationToken } from "@/lib/competition-join";
import {
  getParticipantChallengeState,
  getParticipantAttempts,
  listCompetitionParticipantsWithState,
  mintParticipantVerificationToken,
  normalizeVerificationCode,
  recordCompetitionAttempt,
  verifyCompetitionParticipantByCode,
  verifyCompetitionParticipantByToken,
} from "@/lib/competition-attempt-server";

type MockFn = ReturnType<typeof vi.fn>;

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROFILE_MANAGER = "11111111-1111-4111-8111-111111111111";
const PROFILE_AMBASSADOR = "22222222-2222-4222-8222-222222222222";
const PROFILE_UNRELATED = "33333333-3333-4333-8333-333333333333";
const PARTICIPANT_1 = "p1111111-1111-4111-8111-111111111111";
const PARTICIPANT_OTHER = "p9999999-9999-4999-8999-999999999999";

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
    profile_id: "profile-x",
    status: "registered",
    checked_in_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function attemptRow(
  attempt_number: number,
  result_value: number,
  passed: boolean,
) {
  return {
    id: `att-${attempt_number}`,
    event_id: EVENT_A,
    participant_id: PARTICIPANT_1,
    attempt_number,
    result_value,
    passed,
    recorded_by_profile_id: PROFILE_MANAGER,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

// ═══════════════════════════════════════════════════════════════
// Verification — code
// ═══════════════════════════════════════════════════════════════

describe("COMP-004: verifyCompetitionParticipantByCode", () => {
  it("resolves the correct participant and marks them present", async () => {
    mockFromOnce({ data: { id: EVENT_A }, error: null }); // isEventManager
    mockFromOnce({
      data: {
        id: PARTICIPANT_1,
        event_id: EVENT_A,
        profile_id: "profile-x",
        status: "registered",
        checked_in_at: null,
        verification_code: "ABCD2345",
        profile: { full_name: "Ada Lovelace", email: "ada@example.com" },
      },
      error: null,
    });
    const updateBuilder = mockFromOnce({
      data: { status: "challenge_pending" },
      error: null,
    });
    mockFromOnce({ data: eventRow(), error: null }); // getCompetitionEvent
    mockFromOnce({ data: [], error: null }); // getParticipantAttempts

    const result = await verifyCompetitionParticipantByCode(
      EVENT_A,
      PROFILE_MANAGER,
      "abcd-2345",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.participantId).toBe(PARTICIPANT_1);
    expect(result.data.displayName).toBe("Ada Lovelace");
    expect(result.data.status).toBe("challenge_pending");

    const patch = updateBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.checked_in_at).toBeTruthy();
    expect(patch.status).toBe("challenge_pending");
  });

  it("normalises the code (uppercase, strips separators) before lookup", async () => {
    mockFromOnce({ data: { id: EVENT_A }, error: null });
    const lookup = mockFromOnce({ data: null, error: null });

    await verifyCompetitionParticipantByCode(EVENT_A, PROFILE_MANAGER, "abcd-2345");

    expect(lookup.eq).toHaveBeenCalledWith("event_id", EVENT_A);
    expect(lookup.eq).toHaveBeenCalledWith("verification_code", "ABCD2345");
  });

  it("rejects an invalid code (no participant)", async () => {
    mockFromOnce({ data: { id: EVENT_A }, error: null });
    mockFromOnce({ data: null, error: null });

    const result = await verifyCompetitionParticipantByCode(
      EVENT_A,
      PROFILE_MANAGER,
      "ZZZZ9999",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("rejects a participant from another event (code scoped to this event)", async () => {
    mockFromOnce({ data: { id: EVENT_A }, error: null });
    // The lookup is filtered by event_id too, so a foreign participant's code
    // never resolves here.
    const lookup = mockFromOnce({ data: null, error: null });

    const result = await verifyCompetitionParticipantByCode(
      EVENT_A,
      PROFILE_MANAGER,
      "FOREIGN1",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
    expect(lookup.eq).toHaveBeenCalledWith("event_id", EVENT_A);
  });

  it("rejects an unrelated authenticated user", async () => {
    mockFromOnce({ data: null, error: null }); // isEventManager → no match
    mockFromOnce({ data: null, error: null }); // isEventAmbassador → no match

    const result = await verifyCompetitionParticipantByCode(
      EVENT_A,
      PROFILE_UNRELATED,
      "ABCD2345",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
  });

  it("allows an assigned ambassador (not the creator) to verify by code", async () => {
    mockFromOnce({ data: null, error: null }); // isEventManager → no match
    mockFromOnce({ data: { id: "amb-1" }, error: null }); // isEventAmbassador → match
    mockFromOnce({
      data: {
        id: PARTICIPANT_1,
        event_id: EVENT_A,
        profile_id: "profile-x",
        status: "registered",
        checked_in_at: null,
        verification_code: "ABCD2345",
        profile: { full_name: "Ada Lovelace" },
      },
      error: null,
    });
    mockFromOnce({ data: { status: "challenge_pending" }, error: null }); // update
    mockFromOnce({ data: eventRow(), error: null }); // event
    mockFromOnce({ data: [], error: null }); // attempts

    const result = await verifyCompetitionParticipantByCode(
      EVENT_A,
      PROFILE_AMBASSADOR,
      "abcd-2345",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.participantId).toBe(PARTICIPANT_1);
    expect(result.data.status).toBe("challenge_pending");
  });

  it("rejects an empty code after authorization", async () => {
    mockFromOnce({ data: { id: EVENT_A }, error: null });
    const result = await verifyCompetitionParticipantByCode(
      EVENT_A,
      PROFILE_MANAGER,
      "   ",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// Verification — token (QR)
// ═══════════════════════════════════════════════════════════════

describe("COMP-004: verifyCompetitionParticipantByToken", () => {
  it("hashes the raw token before lookup and resolves the participant", async () => {
    const rawToken = "opaqueQRtoken_abc123";
    const lookup = mockFromOnce({
      data: {
        id: PARTICIPANT_1,
        event_id: EVENT_A,
        profile_id: "profile-x",
        status: "registered",
        checked_in_at: null,
        verification_code: "ABCD2345",
        profile: { full_name: "Ada", email: null },
      },
      error: null,
    });
    mockFromOnce({ data: { id: EVENT_A }, error: null }); // isEventManager
    mockFromOnce({ data: { status: "challenge_pending" }, error: null }); // update
    mockFromOnce({ data: eventRow(), error: null }); // event
    mockFromOnce({ data: [], error: null }); // attempts

    const result = await verifyCompetitionParticipantByToken(
      PROFILE_MANAGER,
      rawToken,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.eventId).toBe(EVENT_A);
    expect(lookup.eq).toHaveBeenCalledWith(
      "verification_token_hash",
      hashVerificationToken(rawToken),
    );
    expect(lookup.eq).not.toHaveBeenCalledWith(
      "verification_token_hash",
      rawToken,
    );
  });

  it("rejects an unknown token", async () => {
    mockFromOnce({ data: null, error: null });
    const result = await verifyCompetitionParticipantByToken(
      PROFILE_MANAGER,
      "nope",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("rejects when the resolved event is not managed by the requester", async () => {
    mockFromOnce({
      data: {
        id: PARTICIPANT_OTHER,
        event_id: EVENT_B,
        profile_id: "profile-y",
        status: "registered",
        checked_in_at: null,
        verification_code: "OTHER123",
        profile: { full_name: "Other" },
      },
      error: null,
    });
    // canManageEvent for EVENT_B → neither manager nor ambassador
    mockFromOnce({ data: null, error: null });
    mockFromOnce({ data: null, error: null });

    const result = await verifyCompetitionParticipantByToken(
      PROFILE_MANAGER,
      "opaque-token",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("allows an assigned ambassador to verify via QR token", async () => {
    const rawToken = "opaqueQRtoken_amb";
    mockFromOnce({
      data: {
        id: PARTICIPANT_1,
        event_id: EVENT_A,
        profile_id: "profile-x",
        status: "registered",
        checked_in_at: null,
        verification_code: "ABCD2345",
        profile: { full_name: "Ada" },
      },
      error: null,
    });
    mockFromOnce({ data: null, error: null }); // isEventManager → no
    mockFromOnce({ data: { id: "amb-1" }, error: null }); // isEventAmbassador → yes
    mockFromOnce({ data: { status: "challenge_pending" }, error: null }); // update
    mockFromOnce({ data: eventRow(), error: null }); // event
    mockFromOnce({ data: [], error: null }); // attempts

    const result = await verifyCompetitionParticipantByToken(
      PROFILE_AMBASSADOR,
      rawToken,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.eventId).toBe(EVENT_A);
  });
});

describe("COMP-004: normalizeVerificationCode", () => {
  it("uppercases and strips spaces/dashes", () => {
    expect(normalizeVerificationCode("ab-cd 23")).toBe("ABCD23");
  });
  it("returns empty for non-strings", () => {
    expect(normalizeVerificationCode(42)).toBe("");
    expect(normalizeVerificationCode(null)).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════
// Record attempt
// ═══════════════════════════════════════════════════════════════

describe("COMP-004: recordCompetitionAttempt", () => {
  function setupHappyPath(opts: {
    attempts?: ReturnType<typeof attemptRow>[];
    participantStatus?: string;
  }) {
    mockFromOnce({ data: { id: EVENT_A }, error: null }); // isEventManager
    mockFromOnce({ data: eventRow(), error: null }); // getCompetitionEvent
    mockFromOnce({
      data: participantRow({ status: opts.participantStatus ?? "registered" }),
      error: null,
    }); // getParticipantById
    mockFromOnce({ data: opts.attempts ?? [], error: null }); // getParticipantAttempts
  }

  it("records attempt #1 with a server-computed pass for a meeting result", async () => {
    setupHappyPath({});
    const insertBuilder = mockFromOnce({
      data: attemptRow(1, 30, true),
      error: null,
    });
    // status update chain
    mockFromOnce({ data: null, error: null });

    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_MANAGER,
      PARTICIPANT_1,
      30,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inserted = insertBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.attempt_number).toBe(1);
    expect(inserted.passed).toBe(true);
    expect(inserted.event_id).toBe(EVENT_A);
    expect(inserted.participant_id).toBe(PARTICIPANT_1);
    expect(inserted.recorded_by_profile_id).toBe(PROFILE_MANAGER);
    expect(result.data.state.passed).toBe(true);
    expect(result.data.state.challengeComplete).toBe(true);
  });

  it("computes passed=false for a below-threshold result", async () => {
    setupHappyPath({});
    const insertBuilder = mockFromOnce({
      data: attemptRow(1, 10, false),
      error: null,
    });
    mockFromOnce({ data: null, error: null });

    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_MANAGER,
      PARTICIPANT_1,
      10,
    );
    expect(result.ok).toBe(true);
    const inserted = insertBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.passed).toBe(false);
  });

  it("increments the attempt number sequentially", async () => {
    setupHappyPath({ attempts: [attemptRow(1, 10, false)] });
    const insertBuilder = mockFromOnce({
      data: attemptRow(2, 12, false),
      error: null,
    });
    mockFromOnce({ data: null, error: null });

    await recordCompetitionAttempt(EVENT_A, PROFILE_MANAGER, PARTICIPANT_1, 12);
    const inserted = insertBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.attempt_number).toBe(2);
  });

  it("ignores any browser-supplied attempt number / passed (object payload rejected)", async () => {
    // The browser cannot smuggle passed/attempt_number: any non-numeric payload
    // is rejected by validation before the insert.
    mockFromOnce({ data: { id: EVENT_A }, error: null }); // isEventManager
    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_MANAGER,
      PARTICIPANT_1,
      { passed: true, attempt_number: 99, result_value: 5 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    // Only the manager check ran; no insert happened.
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });

  it("rejects recording beyond max_attempts", async () => {
    setupHappyPath({
      attempts: [
        attemptRow(1, 1, false),
        attemptRow(2, 2, false),
        attemptRow(3, 3, false),
      ],
      participantStatus: "not_qualified",
    });

    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_MANAGER,
      PARTICIPANT_1,
      40,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("rejects recording after qualification", async () => {
    setupHappyPath({
      attempts: [attemptRow(1, 30, true)],
      participantStatus: "qualified",
    });

    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_MANAGER,
      PARTICIPANT_1,
      40,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("maps a duplicate/concurrent insert (23505) to 409", async () => {
    setupHappyPath({ attempts: [attemptRow(1, 10, false)] });
    mockFromOnce({ data: null, error: { code: "23505", message: "duplicate key" } });

    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_MANAGER,
      PARTICIPANT_1,
      12,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("maps a max-attempts trigger rejection to 409", async () => {
    setupHappyPath({ attempts: [attemptRow(1, 10, false)] });
    mockFromOnce({
      data: null,
      error: { message: "competition_max_attempts_exceeded" },
    });

    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_MANAGER,
      PARTICIPANT_1,
      12,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("rejects a participant that does not belong to this event", async () => {
    mockFromOnce({ data: { id: EVENT_A }, error: null }); // isEventManager
    mockFromOnce({ data: eventRow(), error: null }); // event
    mockFromOnce({ data: null, error: null }); // getParticipantById (scoped) → none

    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_MANAGER,
      PARTICIPANT_OTHER,
      10,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("rejects an unrelated authenticated user", async () => {
    mockFromOnce({ data: null, error: null }); // isEventManager → no match
    mockFromOnce({ data: null, error: null }); // isEventAmbassador → no match

    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_UNRELATED,
      PARTICIPANT_1,
      10,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
  });

  it("allows an assigned ambassador to record an attempt", async () => {
    mockFromOnce({ data: null, error: null }); // isEventManager → no
    mockFromOnce({ data: { id: "amb-1" }, error: null }); // isEventAmbassador → yes
    mockFromOnce({ data: eventRow(), error: null }); // getCompetitionEvent
    mockFromOnce({ data: participantRow({ status: "registered" }), error: null }); // participant
    mockFromOnce({ data: [], error: null }); // attempts
    const insertBuilder = mockFromOnce({
      data: attemptRow(1, 12, false),
      error: null,
    });
    mockFromOnce({ data: null, error: null }); // status update

    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_AMBASSADOR,
      PARTICIPANT_1,
      12,
    );

    expect(result.ok).toBe(true);
    const inserted = insertBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.attempt_number).toBe(1);
    expect(inserted.recorded_by_profile_id).toBe(PROFILE_AMBASSADOR);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["NaN string", "abc"],
    ["Infinity", "Infinity"],
  ])("rejects an invalid result value (%s)", async (_label, value) => {
    mockFromOnce({ data: { id: EVENT_A }, error: null }); // isEventManager
    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_MANAGER,
      PARTICIPANT_1,
      value,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("updates participant status to qualified on a passing attempt", async () => {
    setupHappyPath({ attempts: [attemptRow(1, 10, false)], participantStatus: "challenge_pending" });
    mockFromOnce({ data: attemptRow(2, 30, true), error: null }); // insert
    const statusBuilder = mockFromOnce({ data: null, error: null }); // status update

    const result = await recordCompetitionAttempt(
      EVENT_A,
      PROFILE_MANAGER,
      PARTICIPANT_1,
      30,
    );
    expect(result.ok).toBe(true);
    const patch = statusBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.status).toBe("qualified");
  });
});

// ═══════════════════════════════════════════════════════════════
// Retrieval
// ═══════════════════════════════════════════════════════════════

describe("COMP-004: listCompetitionParticipantsWithState", () => {
  it("lists participants with derived challenge state (creator only)", async () => {
    mockFromOnce({ data: { id: EVENT_A }, error: null }); // isEventManager
    mockFromOnce({ data: eventRow(), error: null }); // event
    mockFromOnce({
      data: [
        {
          id: PARTICIPANT_1,
          event_id: EVENT_A,
          profile_id: "profile-x",
          status: "challenge_pending",
          checked_in_at: null,
          created_at: "2026-01-01T00:00:00Z",
          verification_code: "ABCD2345",
          profile: { id: "profile-x", full_name: "Ada", email: "a@b.c" },
        },
      ],
      error: null,
    }); // participants
    mockFromOnce({
      data: [
        {
          id: "att-1",
          event_id: EVENT_A,
          participant_id: PARTICIPANT_1,
          attempt_number: 1,
          result_value: 10,
          passed: false,
        },
      ],
      error: null,
    }); // event attempts

    const list = await listCompetitionParticipantsWithState(
      EVENT_A,
      PROFILE_MANAGER,
    );

    expect(list).toHaveLength(1);
    expect(list[0].attemptsUsed).toBe(1);
    expect(list[0].attemptsRemaining).toBe(2);
    expect(list[0].bestResult).toBe(10);
    expect(list[0].verificationCode).toBe("ABCD2345");
    // Only the display name is exposed — never an account id or email.
    expect(list[0].profile).toEqual({ full_name: "Ada" });
  });

  it("returns an empty list for an unrelated user", async () => {
    mockFromOnce({ data: null, error: null }); // isEventManager → no
    mockFromOnce({ data: null, error: null }); // isEventAmbassador → no
    const list = await listCompetitionParticipantsWithState(
      EVENT_A,
      PROFILE_UNRELATED,
    );
    expect(list).toEqual([]);
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
  });

  it("lists participants for an assigned ambassador (not the creator)", async () => {
    mockFromOnce({ data: null, error: null }); // isEventManager → no
    mockFromOnce({ data: { id: "amb-1" }, error: null }); // isEventAmbassador → yes
    mockFromOnce({ data: eventRow(), error: null }); // event
    mockFromOnce({
      data: [
        {
          id: PARTICIPANT_1,
          event_id: EVENT_A,
          profile_id: "profile-x",
          status: "registered",
          checked_in_at: null,
          created_at: "2026-01-01T00:00:00Z",
          verification_code: "ABCD2345",
          profile: { id: "profile-x", full_name: "Ada", email: "a@b.c" },
        },
      ],
      error: null,
    }); // participants
    mockFromOnce({ data: [], error: null }); // event attempts

    const list = await listCompetitionParticipantsWithState(
      EVENT_A,
      PROFILE_AMBASSADOR,
    );

    expect(list).toHaveLength(1);
    // Privacy: the operator view never exposes account ids or emails.
    expect(list[0].profile).toEqual({ full_name: "Ada" });
    expect(list[0].verificationCode).toBe("ABCD2345");
  });

  it("returns an empty list without querying for missing ids", async () => {
    expect(await listCompetitionParticipantsWithState("", PROFILE_MANAGER)).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe("COMP-004: getParticipantChallengeState", () => {
  it("derives attempts used/remaining and qualification", async () => {
    mockFromOnce({ data: eventRow(), error: null }); // event
    mockFromOnce({ data: participantRow(), error: null }); // participant
    mockFromOnce({
      data: [attemptRow(1, 30, true)],
      error: null,
    }); // attempts

    const state = await getParticipantChallengeState(EVENT_A, PARTICIPANT_1);
    expect(state).not.toBeNull();
    expect(state?.attemptsUsed).toBe(1);
    expect(state?.attemptsRemaining).toBe(2);
    expect(state?.passed).toBe(true);
    expect(state?.challengeComplete).toBe(true);
  });

  it("returns null when the participant is not found", async () => {
    mockFromOnce({ data: eventRow(), error: null });
    mockFromOnce({ data: null, error: null });
    mockFromOnce({ data: [], error: null });

    expect(await getParticipantChallengeState(EVENT_A, PARTICIPANT_OTHER)).toBeNull();
  });
});

describe("COMP-004: getParticipantAttempts", () => {
  it("filters by both event and participant", async () => {
    const builder = mockFromOnce({ data: [attemptRow(1, 5, false)], error: null });
    const attempts = await getParticipantAttempts(EVENT_A, PARTICIPANT_1);
    expect(attempts).toHaveLength(1);
    expect(builder.eq).toHaveBeenCalledWith("event_id", EVENT_A);
    expect(builder.eq).toHaveBeenCalledWith("participant_id", PARTICIPANT_1);
  });

  it("does not query without ids", async () => {
    expect(await getParticipantAttempts("", "")).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass token minting
// ═══════════════════════════════════════════════════════════════

describe("COMP-004: mintParticipantVerificationToken", () => {
  it("stores only the token hash and returns the raw token once", async () => {
    mockFromOnce({ data: participantRow(), error: null }); // participant lookup
    const updateBuilder = mockFromOnce({ data: null, error: null });

    const result = await mintParticipantVerificationToken(EVENT_A, "profile-x");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const patch = updateBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof patch.verification_token_hash).toBe("string");
    expect(patch.verification_token_hash).toBe(
      hashVerificationToken(result.data.token),
    );
    // The raw token is never written to the database.
    expect(JSON.stringify(patch)).not.toContain(result.data.token);
  });

  it("rejects when the profile is not a participant of the event", async () => {
    mockFromOnce({ data: null, error: null });
    const result = await mintParticipantVerificationToken(EVENT_A, "profile-x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});