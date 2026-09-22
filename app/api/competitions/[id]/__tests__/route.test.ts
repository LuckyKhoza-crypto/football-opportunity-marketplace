import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/competition-server", () => ({
  getCompetitionEvent: vi.fn(),
  getCompetitionStatistics: vi.fn(),
  getCompetitionViewerRole: vi.fn(),
  updateCompetitionEvent: vi.fn(),
  changeCompetitionEventStatus: vi.fn(),
  isEventManager: vi.fn(),
  addCompetitionAmbassador: vi.fn(),
  removeCompetitionAmbassador: vi.fn(),
  getCompetitionAmbassadorsWithProfiles: vi.fn(),
}));

import { getServerSession } from "next-auth";
import {
  getCompetitionEvent,
  getCompetitionStatistics,
  getCompetitionViewerRole,
  updateCompetitionEvent,
  changeCompetitionEventStatus,
  isEventManager,
  addCompetitionAmbassador,
  removeCompetitionAmbassador,
} from "@/lib/competition-server";
import {
  getCompetitionEventHandler,
  patchCompetitionEventHandler,
  listAmbassadorsHandler,
  addAmbassadorHandler,
  removeAmbassadorHandler,
} from "@/lib/competition-api";

const PROFILE_1 = "11111111-1111-4111-8111-111111111111";
const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function session(id: string) {
  return { user: { id, email: id + "@test.com" }, expires: "later" };
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("COMP-002 handler: GET /api/competitions/[id]", () => {
  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await getCompetitionEventHandler(
      new Request("http://localhost/api/competitions/x"),
      EVENT_A,
    );
    expect(res.status).toBe(401);
  });

  it("denies an unrelated viewer", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(getCompetitionViewerRole).mockResolvedValue(null);

    const res = await getCompetitionEventHandler(
      new Request("http://localhost/api/competitions/x"),
      EVENT_A,
    );
    expect(res.status).toBe(404);
  });

  it("returns event + role + statistics for an authorized viewer", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(getCompetitionViewerRole).mockResolvedValue("ambassador");
    vi.mocked(getCompetitionEvent).mockResolvedValue({
      id: EVENT_A,
      status: "active",
    } as never);
    vi.mocked(getCompetitionStatistics).mockResolvedValue({
      total: 0,
      registered: 0,
      challenge_pending: 0,
      qualified: 0,
      not_qualified: 0,
      ambassadors: 0,
    });

    const res = await getCompetitionEventHandler(
      new Request("http://localhost/api/competitions/x"),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.role).toBe("ambassador");
    expect(data.statistics.total).toBe(0);
  });
});

describe("COMP-002 handler: PATCH /api/competitions/[id] (update)", () => {
  it("forbids an ambassador from editing (server re-checks authorization)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(updateCompetitionEvent).mockResolvedValue({
      ok: false,
      error: "Not authorized to edit this event",
      status: 403,
    });

    const res = await patchCompetitionEventHandler(
      jsonRequest("http://localhost/api/competitions/x", { name: "Hacked" }),
      EVENT_A,
    );

    expect(res.status).toBe(403);
  });

  it("lets the creator update configuration", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(updateCompetitionEvent).mockResolvedValue({
      ok: true,
      data: { id: EVENT_A, name: "Updated" } as never,
    });

    const res = await patchCompetitionEventHandler(
      jsonRequest("http://localhost/api/competitions/x", { name: "Updated" }),
      EVENT_A,
    );

    expect(res.status).toBe(200);
    expect(updateCompetitionEvent).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
      expect.objectContaining({ name: "Updated" }),
    );
  });
});

describe("COMP-002 handler: PATCH /api/competitions/[id] (lifecycle)", () => {
  it("routes status changes through the transition helper", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(changeCompetitionEventStatus).mockResolvedValue({
      ok: true,
      data: { id: EVENT_A, status: "active" } as never,
    });

    const res = await patchCompetitionEventHandler(
      jsonRequest("http://localhost/api/competitions/x", { status: "active" }),
      EVENT_A,
    );

    expect(res.status).toBe(200);
    expect(changeCompetitionEventStatus).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
      "active",
    );
    // A status-only PATCH must NOT go through the generic update helper.
    expect(updateCompetitionEvent).not.toHaveBeenCalled();
  });

  it("rejects an invalid transition with the helper's conflict status", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(changeCompetitionEventStatus).mockResolvedValue({
      ok: false,
      error: "Invalid status transition from draft to completed",
      status: 409,
    });

    const res = await patchCompetitionEventHandler(
      jsonRequest("http://localhost/api/competitions/x", {
        status: "completed",
      }),
      EVENT_A,
    );

    expect(res.status).toBe(409);
  });
});

describe("COMP-002 handler: ambassadors", () => {
  it("requires auth to list ambassadors", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await listAmbassadorsHandler(
      new Request("http://localhost/api/competitions/x/ambassadors"),
      EVENT_A,
    );
    expect(res.status).toBe(401);
  });

  it("forbids a non-creator from listing ambassadors", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(isEventManager).mockResolvedValue(false);

    const res = await listAmbassadorsHandler(
      new Request("http://localhost/api/competitions/x/ambassadors"),
      EVENT_A,
    );
    expect(res.status).toBe(403);
  });

  it("adds an ambassador by email for the creator", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(addCompetitionAmbassador).mockResolvedValue({
      ok: true,
      data: {
        ambassador: { id: "amb-1" } as never,
        profile: { id: "p2", email: "amb@example.com", full_name: "Amb" },
      },
    });

    const res = await addAmbassadorHandler(
      jsonRequest("http://localhost/api/competitions/x/ambassadors", {
        email: "amb@example.com",
      }),
      EVENT_A,
    );

    expect(res.status).toBe(201);
    expect(addCompetitionAmbassador).toHaveBeenCalledWith(
      EVENT_A,
      PROFILE_1,
      "amb@example.com",
    );
  });

  it("surfaces the friendly no-account message", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(addCompetitionAmbassador).mockResolvedValue({
      ok: false,
      error: "No account found for that email.",
      status: 404,
    });

    const res = await addAmbassadorHandler(
      jsonRequest("http://localhost/api/competitions/x/ambassadors", {
        email: "nobody@example.com",
      }),
      EVENT_A,
    );
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toMatch(/No account found/i);
  });

  it("forbids a non-creator from removing an ambassador", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(removeCompetitionAmbassador).mockResolvedValue({
      ok: false,
      error: "Not authorized to manage ambassadors",
      status: 403,
    });

    const res = await removeAmbassadorHandler(
      new Request("http://localhost/api/competitions/x/ambassadors/p2", {
        method: "DELETE",
      }),
      EVENT_A,
      "p2",
    );

    expect(res.status).toBe(403);
  });
});