import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

// Mock the server helper layer so the route tests focus on HTTP concerns:
// authentication, validation, status codes and server-resolved identity.
vi.mock("@/lib/competition-server", () => ({
  createCompetitionEvent: vi.fn(),
  isCompetitionCreationAdmin: vi.fn(),
  listManagedCompetitionEvents: vi.fn(),
  listAmbassadorCompetitionEvents: vi.fn(),
  getCompetitionEvent: vi.fn(),
  getCompetitionStatistics: vi.fn(),
  getCompetitionViewerRole: vi.fn(),
  updateCompetitionEvent: vi.fn(),
  changeCompetitionEventStatus: vi.fn(),
  addCompetitionAmbassador: vi.fn(),
  removeCompetitionAmbassador: vi.fn(),
  getCompetitionAmbassadorsWithProfiles: vi.fn(),
  isEventManager: vi.fn(),
}));

import { getServerSession } from "next-auth";
import {
  createCompetitionEvent,
  isCompetitionCreationAdmin,
} from "@/lib/competition-server";
import { POST } from "../route";

const PROFILE_1 = "11111111-1111-4111-8111-111111111111";
const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function session(id: string) {
  return { user: { id, email: id + "@test.com" }, expires: "later" };
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the caller IS the configured competition-creation admin. Tests
  // that exercise the restriction override this.
  vi.mocked(isCompetitionCreationAdmin).mockReturnValue(true);
});

describe("COMP-002 API: POST /api/competitions", () => {
  it("requires authentication", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await POST(
      jsonRequest("http://localhost/api/competitions", "POST", {
        name: "Cup",
        challenge_name: "Juggle",
        challenge_threshold: 30,
        max_attempts: 3,
      }),
    );

    expect(res.status).toBe(401);
    expect(createCompetitionEvent).not.toHaveBeenCalled();
  });

  it("resolves created_by server-side (ignores a spoofed client value)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(createCompetitionEvent).mockResolvedValue({
      id: EVENT_A,
      name: "Cup",
      status: "draft",
      created_by: PROFILE_1,
    } as never);

    const res = await POST(
      jsonRequest("http://localhost/api/competitions", "POST", {
        name: "Cup",
        challenge_name: "Juggle",
        challenge_threshold: 30,
        max_attempts: 3,
        created_by: "99999999-9999-4999-8999-999999999999",
      }),
    );

    expect(res.status).toBe(201);
    expect(createCompetitionEvent).toHaveBeenCalledTimes(1);
    // The helper is called with the SESSION profile id, never the body value.
    expect(vi.mocked(createCompetitionEvent).mock.calls[0][1]).toBe(PROFILE_1);
    const input = vi.mocked(createCompetitionEvent).mock.calls[0][0];
    expect(input).not.toHaveProperty("created_by");
  });

  it("persists the editable challenge configuration", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(createCompetitionEvent).mockResolvedValue({
      id: EVENT_A,
      status: "draft",
    } as never);

    await POST(
      jsonRequest("http://localhost/api/competitions", "POST", {
        name: "Sprint Cup",
        challenge_name: "Sprint Challenge",
        challenge_threshold: 10,
        max_attempts: 5,
      }),
    );

    const input = vi.mocked(createCompetitionEvent).mock.calls[0][0];
    expect(input.challenge_name).toBe("Sprint Challenge");
    expect(input.challenge_threshold).toBe(10);
    expect(input.max_attempts).toBe(5);
  });

  it("rejects an invalid challenge configuration", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);

    const res = await POST(
      jsonRequest("http://localhost/api/competitions", "POST", {
        name: "Bad Cup",
        challenge_name: "Juggle",
        challenge_threshold: 0,
        max_attempts: 3,
      }),
    );

    expect(res.status).toBe(400);
    expect(createCompetitionEvent).not.toHaveBeenCalled();
  });
});

describe("COMP-007 API: POST /api/competitions creation restriction", () => {
  it("rejects an authenticated non-admin (e.g. ambassador) with 403", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(isCompetitionCreationAdmin).mockReturnValue(false);

    const res = await POST(
      jsonRequest("http://localhost/api/competitions", "POST", {
        name: "Ambassador Cup",
        challenge_name: "Juggle",
        challenge_threshold: 30,
        max_attempts: 3,
      }),
    );

    expect(res.status).toBe(403);
    // The creation operation must never run for a non-admin.
    expect(createCompetitionEvent).not.toHaveBeenCalled();
  });

  it("fails closed for an unauthenticated request (401)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    vi.mocked(isCompetitionCreationAdmin).mockReturnValue(false);

    const res = await POST(
      jsonRequest("http://localhost/api/competitions", "POST", {
        name: "Anonymous Cup",
        challenge_name: "Juggle",
        challenge_threshold: 30,
        max_attempts: 3,
      }),
    );

    expect(res.status).toBe(401);
    expect(createCompetitionEvent).not.toHaveBeenCalled();
  });

  it("allows the configured admin through to creation (201)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session(PROFILE_1) as never);
    vi.mocked(isCompetitionCreationAdmin).mockReturnValue(true);
    vi.mocked(createCompetitionEvent).mockResolvedValue({
      id: EVENT_A,
      status: "draft",
      created_by: PROFILE_1,
    } as never);

    const res = await POST(
      jsonRequest("http://localhost/api/competitions", "POST", {
        name: "Admin Cup",
        challenge_name: "Juggle",
        challenge_threshold: 30,
        max_attempts: 3,
      }),
    );

    expect(res.status).toBe(201);
    expect(createCompetitionEvent).toHaveBeenCalledTimes(1);
  });
});
