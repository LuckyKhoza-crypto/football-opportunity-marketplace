/**
 * Unit tests for the Player ↔ Opportunity Matching Engine.
 *
 * These tests verify:
 * - Scoring is deterministic
 * - Position matching (primary, secondary, none)
 * - Playing level matching (exact, adjacent, far apart)
 * - Age range matching (within, below, above, no requirement)
 * - Location matching (exact, partial, mismatch)
 * - Availability matching
 * - Travel preferences
 * - Relocation preferences
 * - Preferred foot matching
 * - League preference matching
 * - Missing data handling (no false penalties)
 * - Score classification
 * - Match reasons generation
 */

import { describe, it, expect } from "vitest";
import { matchPlayerToOpportunity, classifyScore } from "./engine";
import { getLevelMatchFactor, getLevelRank } from "./constants";
import { calculateAge } from "./evaluators";
import type { PlayerProfile, Opportunity, Position } from "@/types";

// ─── Helpers ────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerProfile> = {}): Partial<PlayerProfile> {
  return {
    id: "player-1",
    user_id: "user-1",
    date_of_birth: null,
    location: null,
    positions: [],
    playing_level: null,
    preferred_foot: null,
    availability: null,
    willing_to_travel: false,
    willing_to_relocate: false,
    travel_radius: null,
    preferred_leagues: [],
    ...overrides,
  };
}

function makeOpportunity(overrides: Partial<Opportunity> = {}): Partial<Opportunity> {
  return {
    id: "opp-1",
    team_id: "team-1",
    title: "Test Opportunity",
    position: null,
    secondary_positions: [],
    playing_level: null,
    age_min: null,
    age_max: null,
    location: null,
    radius: null,
    preferred_foot: null,
    availability: null,
    league: null,
    ...overrides,
  };
}

// ─── Level Hierarchy ────────────────────────────────────────────

describe("getLevelRank", () => {
  it("returns index for recognized levels", () => {
    expect(getLevelRank("recreational")).toBe(0);
    expect(getLevelRank("amateur")).toBe(1);
    expect(getLevelRank("competitive_amateur")).toBe(2);
    expect(getLevelRank("semi_pro")).toBe(3);
    expect(getLevelRank("academy")).toBe(4);
    expect(getLevelRank("college")).toBe(5);
    expect(getLevelRank("professional")).toBe(6);
  });

  it("returns -1 for null/undefined/unknown levels", () => {
    expect(getLevelRank(null)).toBe(-1);
    expect(getLevelRank(undefined)).toBe(-1);
    expect(getLevelRank("unknown_level")).toBe(-1);
  });
});

describe("getLevelMatchFactor", () => {
  it("exact match returns 1.0", () => {
    expect(getLevelMatchFactor("semi_pro", "semi_pro")).toBe(1.0);
  });

  it("adjacent levels return 0.8", () => {
    expect(getLevelMatchFactor("amateur", "competitive_amateur")).toBe(0.8);
    expect(getLevelMatchFactor("competitive_amateur", "semi_pro")).toBe(0.8);
  });

  it("two levels apart returns 0.5", () => {
    expect(getLevelMatchFactor("recreational", "competitive_amateur")).toBe(0.5);
    expect(getLevelMatchFactor("amateur", "semi_pro")).toBe(0.5);
  });

  it("three levels apart returns 0.25", () => {
    expect(getLevelMatchFactor("recreational", "semi_pro")).toBe(0.25);
  });

  it("four+ levels apart returns 0.1", () => {
    expect(getLevelMatchFactor("recreational", "professional")).toBe(0.1);
  });

  it("unknown levels return 0.5", () => {
    expect(getLevelMatchFactor("unknown", "semi_pro")).toBe(0.5);
    expect(getLevelMatchFactor("semi_pro", "unknown")).toBe(0.5);
  });
});

// ─── Age Calculation ────────────────────────────────────────────

describe("calculateAge", () => {
  it("calculates age correctly", () => {
    // Person born exactly 22 years ago
    const now = new Date();
    const birthYear = now.getFullYear() - 22;
    const dob = new Date(birthYear, now.getMonth(), now.getDate());
    expect(calculateAge(dob.toISOString())).toBe(22);
  });

  it("returns null for missing DOB", () => {
    expect(calculateAge(null)).toBe(null);
    expect(calculateAge(undefined)).toBe(null);
  });

  it("returns null for invalid date", () => {
    expect(calculateAge("not-a-date")).toBe(null);
  });
});

// ─── Position Matching ──────────────────────────────────────────

describe("Position Matching", () => {
  it("exact primary position match returns full score", () => {
    const player = makePlayer({ positions: ["ST" as Position] });
    const opp = makeOpportunity({ position: "ST" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.position.status).toBe("match");
    expect(result.breakdown.position.contribution).toBeGreaterThan(0);
  });

  it("player with secondary position matches partially", () => {
    const player = makePlayer({ positions: ["LW" as Position] });
    const opp = makeOpportunity({
      position: "ST",
      secondary_positions: ["LW", "RW"],
    });

    const result = matchPlayerToOpportunity(player, opp);
    // Player's position (LW) is in opportunity's secondary_positions
    expect(result.breakdown.position.status).toBe("match");
  });

  it("complete position mismatch has zero position contribution", () => {
    const player = makePlayer({ positions: ["CM" as Position] });
    const opp = makeOpportunity({ position: "ST" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.position.status).toBe("mismatch");
    expect(result.breakdown.position.contribution).toBe(0);
  });

  it("no position requirement is neutral", () => {
    const player = makePlayer({ positions: ["ST" as Position] });
    const opp = makeOpportunity({ position: null });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.position.status).toBe("neutral");
  });
});

// ─── Playing Level Matching ─────────────────────────────────────

describe("Playing Level Matching", () => {
  it("exact level match is a match", () => {
    const player = makePlayer({ playing_level: "semi_pro" });
    const opp = makeOpportunity({ playing_level: "semi_pro" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.playing_level.status).toBe("match");
  });

  it("professional → semi-pro is 3 levels apart (mismatch)", () => {
    const player = makePlayer({ playing_level: "professional" });
    const opp = makeOpportunity({ playing_level: "semi_pro" });

    const result = matchPlayerToOpportunity(player, opp);
    // professional=6, semi_pro=3 → distance=3 (0.25 factor) → mismatch
    expect(result.breakdown.playing_level.status).toBe("mismatch");
  });

  it("recreational → professional is far apart (mismatch)", () => {
    const player = makePlayer({ playing_level: "recreational" });
    const opp = makeOpportunity({ playing_level: "professional" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.playing_level.status).toBe("mismatch");
  });
});

// ─── Age Matching ───────────────────────────────────────────────

describe("Age Matching", () => {
  it("age within range is a match", () => {
    const player = makePlayer({
      date_of_birth: "2000-06-15", // ~26 years old
    });
    const opp = makeOpportunity({ age_min: 20, age_max: 30 });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.age.status).toBe("match");
  });

  it("age below minimum is a mismatch", () => {
    const player = makePlayer({
      date_of_birth: "2010-06-15", // ~16 years old
    });
    const opp = makeOpportunity({ age_min: 18, age_max: 35 });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.age.status).toBe("mismatch");
  });

  it("age above maximum is a mismatch", () => {
    const player = makePlayer({
      date_of_birth: "1970-06-15", // ~56 years old
    });
    const opp = makeOpportunity({ age_min: 18, age_max: 35 });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.age.status).toBe("mismatch");
  });

  it("no age requirement is neutral", () => {
    const player = makePlayer({
      date_of_birth: "2000-06-15",
    });
    const opp = makeOpportunity({ age_min: null, age_max: null });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.age.status).toBe("neutral");
  });

  it("missing DOB when age requirements exist is neutral", () => {
    const player = makePlayer({ date_of_birth: null });
    const opp = makeOpportunity({ age_min: 18, age_max: 35 });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.age.status).toBe("neutral");
  });
});

// ─── Location Matching ──────────────────────────────────────────

describe("Location Matching", () => {
  it("exact location match", () => {
    const player = makePlayer({ location: "Phoenix, AZ" });
    const opp = makeOpportunity({ location: "Phoenix, AZ" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.location.status).toBe("match");
  });

  it("partial location match (contains)", () => {
    const player = makePlayer({ location: "Phoenix, AZ" });
    const opp = makeOpportunity({ location: "Phoenix" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.location.status).toBe("match");
  });

  it("location mismatch", () => {
    const player = makePlayer({ location: "New York, NY" });
    const opp = makeOpportunity({ location: "Los Angeles, CA" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.location.status).toBe("mismatch");
  });

  it("missing location is neutral", () => {
    const player = makePlayer({ location: null });
    const opp = makeOpportunity({ location: "Phoenix, AZ" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.location.status).toBe("neutral");
  });
});

// ─── Availability Matching ──────────────────────────────────────

describe("Availability Matching", () => {
  it("compatible availability is a match", () => {
    const player = makePlayer({ availability: "immediately" });
    const opp = makeOpportunity({ availability: "immediately" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.availability.status).toBe("match");
  });

  it("player earlier than opportunity is a match", () => {
    const player = makePlayer({ availability: "immediately" });
    const opp = makeOpportunity({ availability: "1_month" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.availability.status).toBe("match");
  });

  it("incompatible availability is a mismatch", () => {
    const player = makePlayer({ availability: "next_season" });
    const opp = makeOpportunity({ availability: "immediately" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.availability.status).toBe("mismatch");
  });

  it("missing availability is neutral", () => {
    const player = makePlayer({ availability: null });
    const opp = makeOpportunity({ availability: "immediately" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.availability.status).toBe("neutral");
  });
});

// ─── Travel Matching ────────────────────────────────────────────

describe("Travel Matching", () => {
  it("willing + within radius is a match", () => {
    const player = makePlayer({
      willing_to_travel: true,
      travel_radius: 50,
    });
    const opp = makeOpportunity({ radius: 30 });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.travel.status).toBe("match");
  });

  it("willing + outside radius is a mismatch", () => {
    const player = makePlayer({
      willing_to_travel: true,
      travel_radius: 20,
    });
    const opp = makeOpportunity({ radius: 50 });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.travel.status).toBe("mismatch");
  });

  it("not willing to travel is neutral (no opp radius)", () => {
    const player = makePlayer({ willing_to_travel: false });
    const opp = makeOpportunity({ radius: null });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.travel.status).toBe("neutral");
  });

  it("missing travel info is neutral", () => {
    const player = makePlayer({ willing_to_travel: undefined });
    const opp = makeOpportunity({ radius: 30 });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.travel.status).toBe("neutral");
  });
});

// ─── Relocation Matching ────────────────────────────────────────

describe("Relocation Matching", () => {
  it("willing to relocate when location differs is a match", () => {
    const player = makePlayer({
      location: "New York, NY",
      willing_to_relocate: true,
    });
    const opp = makeOpportunity({ location: "Phoenix, AZ" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.relocation.status).toBe("match");
  });

  it("unwilling to relocate when location differs is a mismatch", () => {
    const player = makePlayer({
      location: "New York, NY",
      willing_to_relocate: false,
    });
    const opp = makeOpportunity({ location: "Phoenix, AZ" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.relocation.status).toBe("mismatch");
  });

  it("relocation not required (same location) is neutral", () => {
    const player = makePlayer({
      location: "Phoenix, AZ",
      willing_to_relocate: true,
    });
    const opp = makeOpportunity({ location: "Phoenix, AZ" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.relocation.status).toBe("neutral");
  });
});

// ─── Preferred Foot Matching ────────────────────────────────────

describe("Preferred Foot Matching", () => {
  it("matching foot is a match", () => {
    const player = makePlayer({ preferred_foot: "right" });
    const opp = makeOpportunity({ preferred_foot: "right" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.preferred_foot.status).toBe("match");
  });

  it("mismatching foot is a mismatch", () => {
    const player = makePlayer({ preferred_foot: "left" });
    const opp = makeOpportunity({ preferred_foot: "right" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.preferred_foot.status).toBe("mismatch");
  });

  it("'both' matches any foot requirement", () => {
    const player = makePlayer({ preferred_foot: "both" });
    const opp = makeOpportunity({ preferred_foot: "right" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.preferred_foot.status).toBe("match");
  });

  it("missing opportunity foot is neutral", () => {
    const player = makePlayer({ preferred_foot: "right" });
    const opp = makeOpportunity({ preferred_foot: null });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.preferred_foot.status).toBe("neutral");
  });

  it("missing player foot is neutral (no penalty)", () => {
    const player = makePlayer({ preferred_foot: null });
    const opp = makeOpportunity({ preferred_foot: "right" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.preferred_foot.status).toBe("neutral");
  });
});

// ─── League Preference Matching ────────────────────────────────

describe("League Preference Matching", () => {
  it("preferred league matches", () => {
    const player = makePlayer({ preferred_leagues: ["NPSL", "USL League Two"] });
    const opp = makeOpportunity({ league: "NPSL" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.league_preference.status).toBe("match");
  });

  it("non-preferred league is a mismatch", () => {
    const player = makePlayer({ preferred_leagues: ["NPSL"] });
    const opp = makeOpportunity({ league: "MLS Next" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.league_preference.status).toBe("mismatch");
  });

  it("no preferences is neutral (no penalty)", () => {
    const player = makePlayer({ preferred_leagues: [] });
    const opp = makeOpportunity({ league: "NPSL" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.league_preference.status).toBe("neutral");
  });

  it("no opportunity league is neutral", () => {
    const player = makePlayer({ preferred_leagues: ["NPSL"] });
    const opp = makeOpportunity({ league: null });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.league_preference.status).toBe("neutral");
  });
});

// ─── Missing Data ───────────────────────────────────────────────

describe("Missing Data Handling", () => {
  it("completely empty player does not crash", () => {
    const player: Partial<PlayerProfile> = {};
    const opp = makeOpportunity({ position: "ST" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("missing optional fields do not unfairly destroy the score", () => {
    const opp = makeOpportunity({
      position: "ST",
      playing_level: "semi_pro",
      location: "Phoenix, AZ",
      availability: "immediately",
    });

    // Player with same essential info but missing foot & leagues
    const playerMissingOptional = makePlayer({
      positions: ["ST" as Position],
      playing_level: "semi_pro",
      location: "Phoenix, AZ",
      availability: "immediately",
      preferred_foot: null, // missing
      preferred_leagues: [], // missing
      willing_to_travel: undefined, // missing
      willing_to_relocate: undefined, // missing
      travel_radius: null,
    });

    const missingResult = matchPlayerToOpportunity(playerMissingOptional, opp);

    // Missing optional fields should reduce score slightly vs a full profile
    // but should NOT be zero or very low
    expect(missingResult.score).toBeGreaterThan(50);
    // The difference should only be from foot/travel/relocation/league weights (5+3+2+5 = 15%)
    // So the score should still be relatively high
    expect(missingResult.score).toBeGreaterThanOrEqual(60);
  });

  it("deterministic: same inputs produce same result", () => {
    const player = makePlayer({
      positions: ["ST" as Position],
      playing_level: "semi_pro",
    });
    const opp = makeOpportunity({
      position: "ST",
      playing_level: "semi_pro",
    });

    const result1 = matchPlayerToOpportunity(player, opp);
    const result2 = matchPlayerToOpportunity(player, opp);
    const result3 = matchPlayerToOpportunity(player, opp);

    expect(result1.score).toBe(result2.score);
    expect(result2.score).toBe(result3.score);
    expect(result1.reasons).toEqual(result2.reasons);
    expect(result1.classification).toBe(result2.classification);
  });
});

// ─── Comprehensive / Integration Tests ──────────────────────────

describe("Comprehensive Match Scenarios", () => {
  it("excellent match: everything aligns", () => {
    const player = makePlayer({
      positions: ["ST" as Position],
      playing_level: "semi_pro",
      location: "Phoenix, AZ",
      date_of_birth: "2000-06-15", // ~26, within common range
      availability: "immediately",
      willing_to_travel: true,
      travel_radius: 100,
      willing_to_relocate: true,
      preferred_foot: "right",
      preferred_leagues: ["NPSL"],
    });

    const opp = makeOpportunity({
      position: "ST",
      playing_level: "semi_pro",
      location: "Phoenix, AZ",
      age_min: 18,
      age_max: 40,
      availability: "immediately",
      radius: 50,
      preferred_foot: "right",
      league: "NPSL",
    });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.classification).toBe("excellent");
    expect(result.reasons.length).toBeGreaterThanOrEqual(6);
    expect(result.mismatches.length).toBe(0);
  });

  it("strong match: most things align but not all", () => {
    const player = makePlayer({
      positions: ["LW" as Position],
      playing_level: "competitive_amateur",
      location: "Phoenix, AZ",
      availability: "2_weeks",
      preferred_foot: "left",
    });

    const opp = makeOpportunity({
      position: "LW",
      playing_level: "semi_pro", // 1 step off
      location: "Phoenix, AZ",
      availability: "1_month", // player earlier
    });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.mismatches.length).toBe(0); // everything compatible
  });

  it("poor match: only location and some factors align", () => {
    const player = makePlayer({
      positions: ["CB" as Position],
      playing_level: "recreational",
      location: "Phoenix, AZ",
    });

    const opp = makeOpportunity({
      position: "ST", // different position
      playing_level: "professional", // extreme level mismatch
      location: "Phoenix, AZ", // same location
    });

    const result = matchPlayerToOpportunity(player, opp);
    // Position (30%) + Level (20%) are mismatches → only location (15%) matches → poor
    expect(result.classification).toBe("poor");
    // Should have mismatch reasons
    expect(result.mismatches.length).toBeGreaterThanOrEqual(2);
  });

  it("position mismatch significantly reduces score", () => {
    const cmPlayer = makePlayer({
      positions: ["CM" as Position],
      playing_level: "semi_pro",
      location: "Phoenix, AZ",
      availability: "immediately",
    });
    const opp = makeOpportunity({
      position: "ST",
      playing_level: "semi_pro",
      location: "Phoenix, AZ",
      availability: "immediately",
    });

    const cmResult = matchPlayerToOpportunity(cmPlayer, opp);

    // Compare with matching player
    const stPlayer = makePlayer({
      positions: ["ST" as Position],
      playing_level: "semi_pro",
      location: "Phoenix, AZ",
      availability: "immediately",
    });
    const stResult = matchPlayerToOpportunity(stPlayer, opp);

    // Position mismatch should cause a significant drop
    expect(cmResult.score).toBeLessThan(stResult.score);
    // The position weight is 30%, so the difference should be noticeable
    expect(stResult.score - cmResult.score).toBeGreaterThan(15);
  });
});

// ─── Score Classification ───────────────────────────────────────

describe("Score Classification", () => {
  it("classifies scores correctly", () => {
    expect(classifyScore(95)).toBe("excellent");
    expect(classifyScore(90)).toBe("excellent");
    expect(classifyScore(80)).toBe("strong");
    expect(classifyScore(75)).toBe("strong");
    expect(classifyScore(70)).toBe("possible");
    expect(classifyScore(60)).toBe("possible");
    expect(classifyScore(50)).toBe("weak");
    expect(classifyScore(40)).toBe("weak");
    expect(classifyScore(30)).toBe("poor");
    expect(classifyScore(0)).toBe("poor");
  });
});

// ─── Reasons and Mismatches ─────────────────────────────────────

describe("Match Reasons", () => {
  it("generates reasons for matches", () => {
    const player = makePlayer({
      positions: ["ST" as Position],
      playing_level: "semi_pro",
      location: "Phoenix, AZ",
      availability: "immediately",
    });
    const opp = makeOpportunity({
      position: "ST",
      playing_level: "semi_pro",
      location: "Phoenix, AZ",
      availability: "immediately",
    });

    const result = matchPlayerToOpportunity(player, opp);

    expect(result.reasons.length).toBeGreaterThan(0);
    result.reasons.forEach((r) => {
      expect(r).toContain("✓");
    });
  });

  it("generates mismatches for non-matching factors", () => {
    const player = makePlayer({
      positions: ["CM" as Position],
      playing_level: "recreational",
      location: "New York, NY",
    });
    const opp = makeOpportunity({
      position: "ST",
      playing_level: "professional",
      location: "Los Angeles, CA",
    });

    const result = matchPlayerToOpportunity(player, opp);

    expect(result.mismatches.length).toBeGreaterThan(0);
    result.mismatches.forEach((m) => {
      expect(m).toContain("⚠");
    });
  });

  it("reasons and mismatches are explainable", () => {
    const player = makePlayer({
      positions: ["ST" as Position],
      playing_level: "semi_pro",
      date_of_birth: "2000-06-15",
    });
    const opp = makeOpportunity({
      position: "ST",
      playing_level: "semi_pro",
      age_min: 18,
      age_max: 25,
      preferred_foot: "right",
    });

    const result = matchPlayerToOpportunity(player, opp);

    // Position match reason
    expect(result.reasons.some((r) => r.includes("Position"))).toBe(true);
    // Level match reason
    expect(result.reasons.some((r) => r.includes("level"))).toBe(true);

    // All reasons should be human readable
    result.reasons.forEach((r) => {
      expect(r.length).toBeGreaterThan(5);
    });
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────

describe("Edge Cases", () => {
  it("handles player with both positions matching opportunity", () => {
    const player = makePlayer({
      positions: ["ST" as Position, "CF" as Position],
    });
    const opp = makeOpportunity({ position: "CF" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.position.status).toBe("match");
  });

  it("handles case-insensitive position matching", () => {
    const player = makePlayer({
      positions: ["st" as Position],
    });
    const opp = makeOpportunity({ position: "ST" });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.position.status).toBe("match");
  });

  it("age at exact boundary is still within range", () => {
    // Player born exactly 18 years ago
    const now = new Date();
    const birthYear = now.getFullYear() - 18;
    const dob = new Date(birthYear, now.getMonth(), now.getDate());

    const player = makePlayer({
      date_of_birth: dob.toISOString(),
    });
    const opp = makeOpportunity({ age_min: 18, age_max: 35 });

    const result = matchPlayerToOpportunity(player, opp);
    expect(result.breakdown.age.status).toBe("match");
  });
});