import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { listParticipantCompetitionEntries } from "@/lib/competition-server";

/**
 * T-REM-2 — participant-facing competition listing.
 *
 * `listParticipantCompetitionEntries` powers the "My Competitions" page. It must
 * only return ACTIVE registrations (removed_at IS NULL) for the authenticated
 * profile, joined with the event, so a player can open a competition and
 * unregister.
 */

type MockFn = ReturnType<typeof vi.fn>;

const PROFILE_PLAYER = "11111111-1111-4111-8111-111111111111";
const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface Builder {
  select: MockFn;
  eq: MockFn;
  is: MockFn;
  order: MockFn;
}

let lastBuilder: Builder;

function mockResult(result: { data: unknown; error: unknown }): Builder {
  const builder = {} as Builder;
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.is = vi.fn(self);
  builder.order = vi.fn(() => Promise.resolve(result));
  lastBuilder = builder;
  vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => builder as never);
  return builder;
}

function eventRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: "Sunday Cup",
    description: null,
    location: "Lagos",
    event_date: null,
    status: "active",
    challenge_name: "Juggle",
    challenge_threshold: 30,
    max_attempts: 3,
    created_by: "creator",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("T-REM-2: listParticipantCompetitionEntries", () => {
  it("returns active entries joined with their event", async () => {
    mockResult({
      data: [
        {
          id: "part-1",
          status: "registered",
          checked_in_at: null,
          removed_at: null,
          event: eventRow(EVENT_A),
        },
      ],
      error: null,
    });

    const entries = await listParticipantCompetitionEntries(PROFILE_PLAYER);

    expect(entries).toHaveLength(1);
    expect(entries[0].event.id).toBe(EVENT_A);
    expect(entries[0].participantId).toBe("part-1");
    expect(entries[0].status).toBe("registered");
    expect(entries[0].checkedInAt).toBeNull();

    // Only ACTIVE registrations are requested for the authenticated profile.
    const fromArgs = vi.mocked(supabaseAdmin.from).mock.calls[0];
    expect(fromArgs[0]).toBe("competition_participants");
    expect(lastBuilder.eq).toHaveBeenCalledWith("profile_id", PROFILE_PLAYER);
    expect(lastBuilder.is).toHaveBeenCalledWith("removed_at", null);
  });

  it("reports check-in state so the UI can explain why withdrawal is blocked", async () => {
    mockResult({
      data: [
        {
          id: "part-2",
          status: "challenge_pending",
          checked_in_at: "2026-02-01T09:00:00.000Z",
          removed_at: null,
          event: eventRow(EVENT_B),
        },
      ],
      error: null,
    });

    const entries = await listParticipantCompetitionEntries(PROFILE_PLAYER);
    expect(entries[0].checkedInAt).toBe("2026-02-01T09:00:00.000Z");
  });

  it("skips rows whose event embed is missing", async () => {
    mockResult({
      data: [
        {
          id: "part-1",
          status: "registered",
          checked_in_at: null,
          removed_at: null,
          event: eventRow(EVENT_A),
        },
        {
          id: "part-2",
          status: "registered",
          checked_in_at: null,
          removed_at: null,
          event: null,
        },
      ],
      error: null,
    });

    const entries = await listParticipantCompetitionEntries(PROFILE_PLAYER);
    expect(entries).toHaveLength(1);
    expect(entries[0].event.id).toBe(EVENT_A);
  });

  it("returns an empty list on error and when the profile id is missing", async () => {
    mockResult({ data: null, error: { message: "boom" } });
    expect(await listParticipantCompetitionEntries(PROFILE_PLAYER)).toEqual([]);

    expect(await listParticipantCompetitionEntries("")).toEqual([]);
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });
});
