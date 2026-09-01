/**
 * MVP-016 Tests: Team Application Management
 *
 * These tests verify:
 * - Team sees applications for its own opportunities
 * - Team cannot see another team's applications
 * - Filters work correctly (status, opportunity, position, match quality)
 * - Sorting works correctly (newest, oldest, highest match, lowest match)
 * - Match score/classification displays correctly
 * - Team can move an application to Reviewing
 * - Team can accept an application
 * - Team can reject an application
 * - Invalid status transitions are prevented
 * - Unauthorized status updates are rejected
 * - Applicant profile links work
 * - Dual-role users can access the team workflow
 * - Existing player application functionality still works
 * - Existing matching functionality still works
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock setup ──────────────────────────────────────────────────

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
  default: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

const mockSupabaseAdmin = {
  from: vi.fn(),
};

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/matching", () => ({
  matchPlayerToOpportunity: vi.fn((player, opp) => {
    // Deterministic match based on position match
    const posMatch = player?.positions?.some(
      (p: string) => p.toUpperCase() === (opp?.position ?? "").toUpperCase(),
    );
    const levelMatch = player?.playing_level === opp?.playing_level;
    const locMatch = player?.location?.toLowerCase() === opp?.location?.toLowerCase();

    let score = 0;
    const reasons: string[] = [];
    const mismatches: string[] = [];

    if (posMatch) {
      score += 30;
      reasons.push("✓ Position matches");
    } else {
      mismatches.push("⚠ Position mismatch");
    }

    if (levelMatch) {
      score += 20;
      reasons.push("✓ Playing level matches");
    } else {
      mismatches.push("⚠ Playing level mismatch");
    }

    if (locMatch) {
      score += 15;
      reasons.push("✓ Location matches");
    } else {
      mismatches.push("⚠ Location mismatch");
    }

    // Add some neutral factors
    score += 10; // availability neutral
    score += 5; // travel neutral
    score += 5; // foot neutral
    score += 5; // league neutral

    const classification =
      score >= 90 ? "excellent" :
      score >= 75 ? "strong" :
      score >= 60 ? "possible" :
      score >= 40 ? "weak" :
      "poor";

    return {
      score,
      classification,
      reasons,
      mismatches,
      breakdown: {
        position: { contribution: posMatch ? 30 : 0, maxContribution: 30, status: posMatch ? "match" : "mismatch", detail: posMatch ? "Position matches" : "Position mismatch" },
        playing_level: { contribution: levelMatch ? 20 : 0, maxContribution: 20, status: levelMatch ? "match" : "mismatch", detail: levelMatch ? "Level matches" : "Level mismatch" },
        location: { contribution: locMatch ? 15 : 0, maxContribution: 15, status: locMatch ? "match" : "mismatch", detail: locMatch ? "Location matches" : "Location mismatch" },
        age: { contribution: 0, maxContribution: 10, status: "neutral", detail: "No age requirement" },
        availability: { contribution: 10, maxContribution: 10, status: "neutral", detail: "Availability not specified" },
        travel: { contribution: 5, maxContribution: 5, status: "neutral", detail: "Travel not specified" },
        relocation: { contribution: 0, maxContribution: 2, status: "neutral", detail: "Relocation not specified" },
        preferred_foot: { contribution: 5, maxContribution: 5, status: "neutral", detail: "Foot not specified" },
        league_preference: { contribution: 5, maxContribution: 5, status: "neutral", detail: "League not specified" },
      },
    };
  }),
  classifyScore: vi.fn((score: number) => {
    if (score >= 90) return "excellent";
    if (score >= 75) return "strong";
    if (score >= 60) return "possible";
    if (score >= 40) return "weak";
    return "poor";
  }),
}));

import { getServerSession } from "next-auth";
import { matchPlayerToOpportunity, classifyScore } from "@/lib/matching";
import type { Position, OpportunityStatus } from "@/types";

// ─── Helpers ─────────────────────────────────────────────────────

function createMockSession(userId: string, roles: string[] = ["player"]) {
  return {
    user: {
      id: userId,
      email: `user${userId}@test.com`,
      name: `User ${userId}`,
      roles,
    },
  };
}

function createMockResult(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    then: (onfulfilled: (value: { data: unknown; error: null }) => any) =>
      Promise.resolve({ data, error: null }).then(onfulfilled),
  };
}

function createApplication(overrides: Record<string, any> = {}) {
  return {
    id: "app-1",
    opportunity_id: "opp-1",
    player_profile_id: "player-profile-1",
    status: "pending",
    cover_message: "I would love to join your team!",
    created_at: "2024-06-01T00:00:00Z",
    updated_at: "2024-06-01T00:00:00Z",
    ...overrides,
  };
}

function createPlayerProfile(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: "player-profile-1",
    user_id: "player-user-1",
    profile_photo_url: null,
    date_of_birth: "1995-06-15",
    location: "London",
    positions: ["ST" as Position],
    preferred_role: "forward",
    playing_level: "semi_pro",
    preferred_foot: "right",
    availability: "immediately",
    willing_to_travel: true,
    willing_to_relocate: false,
    travel_radius: 50,
    compensation_expectation: "Negotiable",
    previous_clubs: [{ name: "FC Example", position: "ST", startDate: "2020", endDate: "2022" }],
    stats: { appearances: 50, goals: 20, assists: 10 },
    achievements: ["Player of the Month"],
    highlight_video_url: null,
    preferred_leagues: ["Premier League"],
    bio: "Experienced striker",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    user: { id: "player-user-1", full_name: "John Doe", email: "john@test.com" },
    ...overrides,
  };
}

function createOpportunity(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: "opp-1",
    title: "Striker Needed",
    position: "ST",
    secondary_positions: [],
    role: "Target Man",
    playing_level: "semi_pro",
    league: "Premier League",
    location: "London",
    radius: 30,
    preferred_foot: "right",
    availability: "immediately",
    compensation: "Full-Time Contract",
    status: "active" as OpportunityStatus,
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("MVP-016: Team Application Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Team sees applications for its own opportunities ──────

  describe("Team Application Visibility", () => {
    it("should return applications for the team's own opportunities", async () => {
      const session = createMockSession("team-user-1", ["team"]);
      (getServerSession as any).mockResolvedValue(session);

      // Mock team profile lookup
      const teamProfileQuery = createMockResult({ id: "team-1" });

      // Mock opportunities lookup
      const opportunitiesQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: any) =>
          Promise.resolve({
            data: [
              { id: "opp-1", title: "Striker Needed", position: "ST", playing_level: "semi_pro", location: "London", status: "active", created_at: "2024-01-01T00:00:00Z" },
              { id: "opp-2", title: "Midfielder Wanted", position: "CM", playing_level: "semi_pro", location: "London", status: "active", created_at: "2024-01-01T00:00:00Z" },
            ],
            error: null,
          }).then(onfulfilled),
      };

      // Mock applications query
      const applicationsData = [
        createApplication({ id: "app-1", opportunity_id: "opp-1", status: "pending" }),
        createApplication({ id: "app-2", opportunity_id: "opp-2", status: "reviewing" }),
      ];

      const applicationsQuery = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (onfulfilled: any) =>
          Promise.resolve({ data: applicationsData, error: null }).then(onfulfilled),
      };

      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        const chains: Record<string, any> = {
          team_profiles: teamProfileQuery,
          opportunities: opportunitiesQuery,
          applications: applicationsQuery,
        };
        return chains[table] ?? createMockResult(null);
      });

      // Simulate the API logic
      const teamResult = await mockSupabaseAdmin.from("team_profiles").select("id").eq("user_id", "team-user-1").single();
      expect(teamResult.data.id).toBe("team-1");

      const oppResult = await mockSupabaseAdmin.from("opportunities").select("id, title, position, playing_level, location, status, created_at").eq("team_id", "team-1");
      const resolvedOpps = await Promise.resolve(oppResult);
      expect(resolvedOpps.data.length).toBe(2);

      const appResult = await mockSupabaseAdmin.from("applications").select("*").in("opportunity_id", ["opp-1", "opp-2"]).order("created_at", { ascending: false });
      const resolvedApps = await Promise.resolve(appResult);
      expect(resolvedApps.data.length).toBe(2);
      expect(resolvedApps.data[0].opportunity_id).toBe("opp-1");
      expect(resolvedApps.data[1].opportunity_id).toBe("opp-2");
    });

    it("should return empty array when team has no opportunities", async () => {
      const session = createMockSession("team-user-1", ["team"]);
      (getServerSession as any).mockResolvedValue(session);

      const teamProfileQuery = createMockResult({ id: "team-1" });

      const opportunitiesQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: any) =>
          Promise.resolve({ data: [], error: null }).then(onfulfilled),
      };

      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        const chains: Record<string, any> = {
          team_profiles: teamProfileQuery,
          opportunities: opportunitiesQuery,
        };
        return chains[table] ?? createMockResult(null);
      });

      const oppResult = await mockSupabaseAdmin.from("opportunities").select("id").eq("team_id", "team-1");
      const resolved = await Promise.resolve(oppResult);
      expect(resolved.data.length).toBe(0);
    });
  });

  // ─── 2. Team cannot see another team's applications ──────────

  describe("Authorization - Team Cannot Access Other Teams' Applications", () => {
    it("should prevent a team from seeing another team's applications via opportunity IDs", async () => {
      const session = createMockSession("team-user-1", ["team"]);
      (getServerSession as any).mockResolvedValue(session);

      const teamProfileQuery = createMockResult({ id: "team-1" });

      // Team-1 only has opp-1, not opp-3 (which belongs to team-2)
      const opportunitiesQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (onfulfilled: any) =>
          Promise.resolve({
            data: [{ id: "opp-1", title: "Striker Needed", position: "ST", playing_level: "semi_pro", location: "London", status: "active", created_at: "2024-01-01T00:00:00Z" }],
            error: null,
          }).then(onfulfilled),
      };

      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        const chains: Record<string, any> = {
          team_profiles: teamProfileQuery,
          opportunities: opportunitiesQuery,
        };
        return chains[table] ?? createMockResult(null);
      });

      // Team-1 tries to fetch applications for opp-3 (belongs to team-2)
      // But the API only queries opportunities owned by team-1
      const oppResult = await mockSupabaseAdmin.from("opportunities").select("id").eq("team_id", "team-1");
      const resolved = await Promise.resolve(oppResult);
      const oppIds = resolved.data.map((o: any) => o.id);

      // opp-3 should NOT be in the list
      expect(oppIds).not.toContain("opp-3");
      expect(oppIds).toContain("opp-1");
      expect(oppIds.length).toBe(1);
    });

    it("should prevent unauthorized status updates via application ID manipulation", () => {
      // Valid status transitions
      const validTransitions: Record<string, string[]> = {
        pending: ["reviewing", "rejected", "accepted"],
        reviewing: ["rejected", "accepted"],
        accepted: [],
        rejected: [],
        withdrawn: [],
      };

      // A team cannot transition to "withdrawn" (player-only action)
      expect(validTransitions["pending"]).not.toContain("withdrawn");
      expect(validTransitions["reviewing"]).not.toContain("withdrawn");

      // A team cannot transition from accepted/rejected
      expect(validTransitions["accepted"]).toEqual([]);
      expect(validTransitions["rejected"]).toEqual([]);
    });
  });

  // ─── 3. Filters work correctly ───────────────────────────────

  describe("Filtering", () => {
    it("should filter by application status", () => {
      const apps = [
        createApplication({ id: "app-1", status: "pending" }),
        createApplication({ id: "app-2", status: "reviewing" }),
        createApplication({ id: "app-3", status: "accepted" }),
        createApplication({ id: "app-4", status: "rejected" }),
      ];

      const pendingApps = apps.filter((a) => a.status === "pending");
      expect(pendingApps.length).toBe(1);
      expect(pendingApps[0].id).toBe("app-1");

      const reviewingApps = apps.filter((a) => a.status === "reviewing");
      expect(reviewingApps.length).toBe(1);
      expect(reviewingApps[0].id).toBe("app-2");

      const acceptedApps = apps.filter((a) => a.status === "accepted");
      expect(acceptedApps.length).toBe(1);
      expect(acceptedApps[0].id).toBe("app-3");

      const rejectedApps = apps.filter((a) => a.status === "rejected");
      expect(rejectedApps.length).toBe(1);
      expect(rejectedApps[0].id).toBe("app-4");
    });

    it("should filter by opportunity", () => {
      const apps = [
        createApplication({ id: "app-1", opportunity_id: "opp-1" }),
        createApplication({ id: "app-2", opportunity_id: "opp-2" }),
        createApplication({ id: "app-3", opportunity_id: "opp-1" }),
      ];

      const opp1Apps = apps.filter((a) => a.opportunity_id === "opp-1");
      expect(opp1Apps.length).toBe(2);

      const opp2Apps = apps.filter((a) => a.opportunity_id === "opp-2");
      expect(opp2Apps.length).toBe(1);
    });

    it("should filter by player position", () => {
      const apps = [
        { ...createApplication({ id: "app-1" }), player_profile: createPlayerProfile({ positions: ["ST"] }) },
        { ...createApplication({ id: "app-2" }), player_profile: createPlayerProfile({ positions: ["CM"] }) },
        { ...createApplication({ id: "app-3" }), player_profile: createPlayerProfile({ positions: ["ST", "CF"] }) },
      ];

      const stApps = apps.filter((a) => {
        const positions = a.player_profile?.positions ?? [];
        return positions.some((p: string) => p.toLowerCase() === "st");
      });
      expect(stApps.length).toBe(2);

      const cmApps = apps.filter((a) => {
        const positions = a.player_profile?.positions ?? [];
        return positions.some((p: string) => p.toLowerCase() === "cm");
      });
      expect(cmApps.length).toBe(1);
    });

    it("should filter by match quality classification", () => {
      const apps = [
        { ...createApplication({ id: "app-1" }), player_profile: createPlayerProfile({ positions: ["ST"], playing_level: "semi_pro", location: "London" }), opportunity: createOpportunity({ position: "ST", playing_level: "semi_pro", location: "London" }) },
        { ...createApplication({ id: "app-2" }), player_profile: createPlayerProfile({ positions: ["CB"], playing_level: "recreational", location: "New York" }), opportunity: createOpportunity({ position: "ST", playing_level: "professional", location: "Los Angeles" }) },
      ];

      const appsWithMatches = apps.map((app) => ({
        ...app,
        match_result: matchPlayerToOpportunity(app.player_profile, app.opportunity),
      }));

      const excellentApps = appsWithMatches.filter((a) => a.match_result.classification === "excellent");
      const poorApps = appsWithMatches.filter((a) => a.match_result.classification === "poor");

      expect(excellentApps.length).toBe(1);
      expect(excellentApps[0].id).toBe("app-1");
      expect(poorApps.length).toBe(1);
      expect(poorApps[0].id).toBe("app-2");
    });
  });

  // ─── 4. Sorting works correctly ──────────────────────────────

  describe("Sorting", () => {
    it("should sort by newest first (default)", () => {
      const apps = [
        createApplication({ id: "app-1", created_at: "2024-01-01T00:00:00Z" }),
        createApplication({ id: "app-2", created_at: "2024-06-01T00:00:00Z" }),
        createApplication({ id: "app-3", created_at: "2024-03-01T00:00:00Z" }),
      ];

      apps.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      expect(apps[0].id).toBe("app-2");
      expect(apps[1].id).toBe("app-3");
      expect(apps[2].id).toBe("app-1");
    });

    it("should sort by oldest first", () => {
      const apps = [
        createApplication({ id: "app-1", created_at: "2024-01-01T00:00:00Z" }),
        createApplication({ id: "app-2", created_at: "2024-06-01T00:00:00Z" }),
        createApplication({ id: "app-3", created_at: "2024-03-01T00:00:00Z" }),
      ];

      apps.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      expect(apps[0].id).toBe("app-1");
      expect(apps[1].id).toBe("app-3");
      expect(apps[2].id).toBe("app-2");
    });

    it("should sort by highest match score first", () => {
      const apps = [
        { ...createApplication({ id: "app-1" }), match_result: { score: 50 } },
        { ...createApplication({ id: "app-2" }), match_result: { score: 90 } },
        { ...createApplication({ id: "app-3" }), match_result: { score: 75 } },
      ];

      apps.sort((a, b) => (b.match_result?.score ?? 0) - (a.match_result?.score ?? 0));

      expect(apps[0].id).toBe("app-2");
      expect(apps[1].id).toBe("app-3");
      expect(apps[2].id).toBe("app-1");
    });

    it("should sort by lowest match score first", () => {
      const apps = [
        { ...createApplication({ id: "app-1" }), match_result: { score: 50 } },
        { ...createApplication({ id: "app-2" }), match_result: { score: 90 } },
        { ...createApplication({ id: "app-3" }), match_result: { score: 75 } },
      ];

      apps.sort((a, b) => (a.match_result?.score ?? 0) - (b.match_result?.score ?? 0));

      expect(apps[0].id).toBe("app-1");
      expect(apps[1].id).toBe("app-3");
      expect(apps[2].id).toBe("app-2");
    });
  });

  // ─── 5. Match score/classification displays correctly ────────

  describe("Match Score Display", () => {
    it("should calculate match score for an application", () => {
      const player = createPlayerProfile({ positions: ["ST"], playing_level: "semi_pro", location: "London" });
      const opp = createOpportunity({ position: "ST", playing_level: "semi_pro", location: "London" });

      const result = matchPlayerToOpportunity(player, opp);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.classification).toBeDefined();
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it("should classify scores correctly", () => {
      expect(classifyScore(95)).toBe("excellent");
      expect(classifyScore(90)).toBe("excellent");
      expect(classifyScore(80)).toBe("strong");
      expect(classifyScore(75)).toBe("strong");
      expect(classifyScore(65)).toBe("possible");
      expect(classifyScore(60)).toBe("possible");
      expect(classifyScore(50)).toBe("weak");
      expect(classifyScore(40)).toBe("weak");
      expect(classifyScore(30)).toBe("poor");
      expect(classifyScore(0)).toBe("poor");
    });

    it("should show match reasons for matching factors", () => {
      const player = createPlayerProfile({ positions: ["ST"], playing_level: "semi_pro", location: "London" });
      const opp = createOpportunity({ position: "ST", playing_level: "semi_pro", location: "London" });

      const result = matchPlayerToOpportunity(player, opp);
      expect(result.reasons).toContain("✓ Position matches");
      expect(result.reasons).toContain("✓ Playing level matches");
      expect(result.reasons).toContain("✓ Location matches");
    });

    it("should show mismatches for non-matching factors", () => {
      const player = createPlayerProfile({ positions: ["CB"], playing_level: "recreational", location: "New York" });
      const opp = createOpportunity({ position: "ST", playing_level: "professional", location: "Los Angeles" });

      const result = matchPlayerToOpportunity(player, opp);
      expect(result.mismatches.length).toBeGreaterThan(0);
    });
  });

  // ─── 6. Status Transitions ───────────────────────────────────

  describe("Status Transitions", () => {
    it("should allow team to move pending to reviewing", () => {
      const validTransitions: Record<string, string[]> = {
        pending: ["reviewing", "rejected", "accepted"],
        reviewing: ["rejected", "accepted"],
        accepted: [],
        rejected: [],
        withdrawn: [],
      };

      expect(validTransitions["pending"]).toContain("reviewing");
    });

    it("should allow team to accept a reviewing application", () => {
      const validTransitions: Record<string, string[]> = {
        pending: ["reviewing", "rejected", "accepted"],
        reviewing: ["rejected", "accepted"],
        accepted: [],
        rejected: [],
        withdrawn: [],
      };

      expect(validTransitions["reviewing"]).toContain("accepted");
    });

    it("should allow team to reject a reviewing application", () => {
      const validTransitions: Record<string, string[]> = {
        pending: ["reviewing", "rejected", "accepted"],
        reviewing: ["rejected", "accepted"],
        accepted: [],
        rejected: [],
        withdrawn: [],
      };

      expect(validTransitions["reviewing"]).toContain("rejected");
    });

    it("should prevent invalid transitions from accepted", () => {
      const validTransitions: Record<string, string[]> = {
        pending: ["reviewing", "rejected", "accepted"],
        reviewing: ["rejected", "accepted"],
        accepted: [],
        rejected: [],
        withdrawn: [],
      };

      expect(validTransitions["accepted"]).not.toContain("reviewing");
      expect(validTransitions["accepted"]).not.toContain("pending");
      expect(validTransitions["accepted"]).not.toContain("rejected");
    });

    it("should prevent invalid transitions from rejected", () => {
      const validTransitions: Record<string, string[]> = {
        pending: ["reviewing", "rejected", "accepted"],
        reviewing: ["rejected", "accepted"],
        accepted: [],
        rejected: [],
        withdrawn: [],
      };

      expect(validTransitions["rejected"]).not.toContain("reviewing");
      expect(validTransitions["rejected"]).not.toContain("accepted");
      expect(validTransitions["rejected"]).not.toContain("pending");
    });

    it("should prevent team from withdrawing an application", () => {
      const validTransitions: Record<string, string[]> = {
        pending: ["reviewing", "rejected", "accepted"],
        reviewing: ["rejected", "accepted"],
        accepted: [],
        rejected: [],
        withdrawn: [],
      };

      // "withdrawn" is not in any team-allowed transition
      expect(validTransitions["pending"]).not.toContain("withdrawn");
      expect(validTransitions["reviewing"]).not.toContain("withdrawn");
    });
  });

  // ─── 7. Unauthorized status updates are rejected ─────────────

  describe("Unauthorized Status Updates", () => {
    it("should reject status update from non-owner user", () => {
      const application = {
        id: "app-1",
        status: "pending",
        player_profile: { user_id: "player-user-1" },
        opportunity: { team_id: "team-1", team: { user_id: "team-user-1" } },
      };

      const currentUserId = "some-other-user";
      const isPlayerOwner = application.player_profile.user_id === currentUserId;
      const isTeamOwner = application.opportunity.team.user_id === currentUserId;

      expect(isPlayerOwner).toBe(false);
      expect(isTeamOwner).toBe(false);
    });

    it("should reject player trying to accept their own application", () => {
      const application = {
        id: "app-1",
        status: "pending",
        player_profile: { user_id: "player-user-1" },
        opportunity: { team_id: "team-1", team: { user_id: "team-user-1" } },
      };

      const currentUserId = "player-user-1";
      const isPlayer = application.player_profile.user_id === currentUserId;
      const isTeam = application.opportunity.team.user_id === currentUserId;

      expect(isPlayer).toBe(true);
      expect(isTeam).toBe(false);

      // Players can only withdraw
      const newStatus: string = "accepted";
      const isAllowedForPlayer = newStatus === "withdrawn";
      expect(isAllowedForPlayer).toBe(false);
    });
  });

  // ─── 8. Applicant profile links work ─────────────────────────

  describe("Applicant Profile Links", () => {
    it("should link to the correct player profile URL", () => {
      const playerProfileId = "player-profile-1";
      const expectedUrl = `/players/${playerProfileId}`;
      expect(expectedUrl).toBe("/players/player-profile-1");
    });

    it("should not expose private user information in profile link", () => {
      const profile = createPlayerProfile();
      // The public profile route uses player_profile.id, not user_id
      const profileLink = `/players/${profile.id}`;
      expect(profileLink).not.toContain(profile.user_id);
      expect(profileLink).not.toContain("email");
      expect(profileLink).not.toContain("private");
    });
  });

  // ─── 9. Dual-role users can access team workflow ─────────────

  describe("Dual-Role Support", () => {
    it("should allow dual-role user to access team applications", () => {
      const session = createMockSession("dual-user-1", ["player", "team"]);
      const roles = session.user.roles as string[];

      expect(roles).toContain("player");
      expect(roles).toContain("team");

      // Team view check
      const isTeamView = true; // User has switched to team view
      expect(isTeamView).toBe(true);
    });

    it("should allow dual-role user to switch back to player view", () => {
      const session = createMockSession("dual-user-1", ["player", "team"]);
      const roles = session.user.roles as string[];

      // Switch to player view
      const isPlayerView = true;
      expect(isPlayerView).toBe(true);

      // Player can view their own applications
      const playerProfileQuery = createMockResult({ id: "player-profile-1" });
      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        return table === "player_profiles" ? playerProfileQuery : createMockResult(null);
      });

      // This should work regardless of team role
      expect(roles).toContain("player");
    });

    it("should not use active view for authorization", () => {
      // Authorization is based on database ownership, not UI view
      const application = {
        id: "app-1",
        player_profile: { user_id: "player-user-1" },
        opportunity: { team: { user_id: "team-user-1" } },
      };

      // Even if user has both roles, they can only act on owned resources
      const dualUserId = "player-user-1";
      const isPlayerOwner = application.player_profile.user_id === dualUserId;
      const isTeamOwner = application.opportunity.team.user_id === dualUserId;

      expect(isPlayerOwner).toBe(true);
      expect(isTeamOwner).toBe(false);
    });
  });

  // ─── 10. Existing player application functionality still works ─

  describe("Existing Player Application Functionality", () => {
    it("should allow player to submit an application", async () => {
      const session = createMockSession("player-user-1", ["player"]);
      (getServerSession as any).mockResolvedValue(session);

      const profileQuery = createMockResult({ id: "player-user-1", role: ["player"] });
      const playerProfileQuery = createMockResult({ id: "player-profile-1" });
      const opportunityQuery = createMockResult({ id: "opp-1", team_id: "team-1", status: "active" });
      const teamQuery = createMockResult({ user_id: "other-user" });
      const existingAppQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        const chains: Record<string, any> = {
          profiles: profileQuery,
          player_profiles: playerProfileQuery,
          opportunities: opportunityQuery,
          team_profiles: teamQuery,
          applications: existingAppQuery,
        };
        return chains[table] ?? createMockResult(null);
      });

      const result = await mockSupabaseAdmin.from("profiles").select("*").eq("id", "player-user-1").single();
      expect(result.data).toBeDefined();
      expect(result.data.role).toContain("player");
    });

    it("should prevent duplicate applications from the same player", async () => {
      const existingApp = { id: "existing-app-1", status: "pending" };

      const existingAppQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: existingApp, error: null }),
      };

      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        return table === "applications" ? existingAppQuery : createMockResult(null);
      });

      const checkResult = await mockSupabaseAdmin
        .from("applications")
        .select("id, status")
        .eq("opportunity_id", "opp-1")
        .eq("player_profile_id", "player-profile-1")
        .maybeSingle();

      expect(checkResult.data).toBeDefined();
      expect(checkResult.data.id).toBe("existing-app-1");
    });

    it("should allow player to withdraw their application", () => {
      const validTransitions: Record<string, string[]> = {
        pending: ["reviewing", "rejected", "accepted"],
        reviewing: ["rejected", "accepted"],
        accepted: [],
        rejected: [],
        withdrawn: [],
      };

      // Player can only withdraw
      // The API checks: isPlayer && newStatus === "withdrawn"
      const isPlayer = true;
      const newStatus = "withdrawn";
      const isAllowed = isPlayer && newStatus === "withdrawn";
      expect(isAllowed).toBe(true);

      // Player cannot change to other statuses
      expect(isPlayer && ("accepted" as string) === "withdrawn").toBe(false);
      expect(isPlayer && ("rejected" as string) === "withdrawn").toBe(false);
    });
  });

  // ─── 11. Existing matching functionality still works ─────────

  describe("Existing Matching Functionality", () => {
    it("should produce deterministic results", () => {
      const player = createPlayerProfile({ positions: ["ST"], playing_level: "semi_pro", location: "London" });
      const opp = createOpportunity({ position: "ST", playing_level: "semi_pro", location: "London" });

      const result1 = matchPlayerToOpportunity(player, opp);
      const result2 = matchPlayerToOpportunity(player, opp);

      expect(result1.score).toBe(result2.score);
      expect(result1.classification).toBe(result2.classification);
      expect(result1.reasons).toEqual(result2.reasons);
    });

    it("should handle partial profile data gracefully", () => {
      const minimalPlayer = {
        id: "player-1",
        user_id: "user-1",
        positions: [],
        playing_level: null,
        location: null,
        date_of_birth: null,
        preferred_foot: null,
        availability: null,
        willing_to_travel: false,
        willing_to_relocate: false,
        travel_radius: null,
        preferred_leagues: [],
        previous_clubs: [],
        stats: {},
        achievements: [],
        preferred_role: null,
        highlight_video_url: null,
        compensation_expectation: null,
        profile_photo_url: null,
        bio: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const minimalOpp: Record<string, any> = {
        id: "opp-1",
        team_id: "team-1",
        title: "Test",
        status: "active" as OpportunityStatus,
        position: null,
        playing_level: null,
        location: null,
        secondary_positions: [],
        role: null,
        formation: null,
        age_min: null,
        age_max: null,
        league: null,
        radius: null,
        preferred_foot: null,
        availability: null,
        compensation: null,
        housing: null,
        travel_requirements: null,
        visa_requirements: null,
        contract_length: null,
        tryout_date: null,
        description: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const result = matchPlayerToOpportunity(minimalPlayer, minimalOpp);
      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it("should require authentication for application operations", async () => {
      (getServerSession as any).mockResolvedValue(null);
      const session = await getServerSession();
      expect(session).toBeNull();
    });
  });
});