/**
 * Individual factor evaluators for the matching engine.
 *
 * Each evaluator function assesses a single compatibility factor between
 * a player profile and an opportunity. All evaluators are pure functions
 * — they take player data + opportunity data and return a FactorScore.
 *
 * @module matching
 */

import type { FactorScore, MatchResult } from "./types";
import type { PlayerProfile, Opportunity, Position } from "@/types";
import { getLevelMatchFactor, POSITION_SECONDARY_MATCH_FACTOR, POSITION_NO_MATCH_FACTOR } from "./constants";

// ─── Helpers ────────────────────────────────────────────────────

/** Safe array access for player positions */
function getPlayerPositions(
  player: Partial<PlayerProfile>,
): Position[] {
  if (Array.isArray(player.positions) && player.positions.length > 0) {
    return player.positions;
  }
  return [];
}

/** Get opportunity position as string */
function getOppPosition(opportunity: Partial<Opportunity>): string | null {
  return opportunity.position ?? null;
}

/** Get opportunity secondary positions */
function getOppSecondaryPositions(opportunity: Partial<Opportunity>): string[] {
  return Array.isArray(opportunity.secondary_positions)
    ? opportunity.secondary_positions
    : [];
}

/** Calculate player's age from date_of_birth */
export function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

// ─── Factor Evaluators ──────────────────────────────────────────

/**
 * Evaluate position compatibility.
 *
 * Rules:
 * - If the opportunity has no position requirement → neutral
 * - If the player has no positions → unknown
 * - If the opportunity position is in the player's primary positions → exact match
 * - If the opportunity position is in the player's secondary positions → partial
 * - If the player has a preferred_role matching the general area → mild bonus
 * - Otherwise → no match
 */
export function evaluatePosition(
  player: Partial<PlayerProfile>,
  opportunity: Partial<Opportunity>,
  weight: number,
): FactorScore {
  const oppPos = getOppPosition(opportunity);

  // No position requirement → neutral
  if (!oppPos) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Opportunity does not specify a position requirement",
    };
  }

  const playerPositions = getPlayerPositions(player);

  if (playerPositions.length === 0) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "unknown",
      detail: "Player has not specified positions",
    };
  }

  // Check primary positions (exact match)
  const primaryMatch = playerPositions.some(
    (p) => p.toUpperCase() === oppPos.toUpperCase(),
  );

  if (primaryMatch) {
    return {
      contribution: weight,
      maxContribution: weight,
      status: "match",
      detail: `Position matches: ${oppPos}`,
    };
  }

  // Check secondary positions
  const oppSecondary = getOppSecondaryPositions(opportunity);
  const secondaryMatch = oppSecondary.some(
    (s) => s.toUpperCase() === oppPos.toUpperCase(),
  );
  if (secondaryMatch) {
    return {
      contribution: Math.round(weight * POSITION_SECONDARY_MATCH_FACTOR),
      maxContribution: weight,
      status: "match",
      detail: `Secondary position matches: ${oppPos}`,
    };
  }

  // Check if any player position is in the opportunity's secondary positions
  const playerInOppSecondary = playerPositions.some((pp) =>
    oppSecondary.some((os) => os.toUpperCase() === pp.toUpperCase()),
  );
  if (playerInOppSecondary) {
    return {
      contribution: Math.round(weight * POSITION_SECONDARY_MATCH_FACTOR),
      maxContribution: weight,
      status: "match",
      detail: `Position matches opportunity's secondary requirements`,
    };
  }

  return {
    contribution: Math.round(weight * POSITION_NO_MATCH_FACTOR),
    maxContribution: weight,
    status: "mismatch",
    detail: `Position mismatch: player cannot play ${oppPos}`,
  };
}

/**
 * Evaluate playing level compatibility.
 *
 * Uses the level hierarchy to determine how close two levels are.
 */
export function evaluatePlayingLevel(
  player: Partial<PlayerProfile>,
  opportunity: Partial<Opportunity>,
  weight: number,
): FactorScore {
  const playerLevel = player.playing_level ?? null;
  const oppLevel = opportunity.playing_level ?? null;

  if (!playerLevel || !oppLevel) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: !playerLevel
        ? "Player has not specified playing level"
        : "Opportunity does not specify playing level",
    };
  }

  const factor = getLevelMatchFactor(playerLevel, oppLevel);
  const contribution = Math.round(weight * factor);

  if (factor >= 1.0) {
    return {
      contribution,
      maxContribution: weight,
      status: "match",
      detail: `Playing level matches: ${playerLevel}`,
    };
  }

  if (factor >= 0.5) {
    return {
      contribution,
      maxContribution: weight,
      status: "match",
      detail: `Playing level close: ${playerLevel} ↔ ${oppLevel}`,
    };
  }

  return {
    contribution,
    maxContribution: weight,
    status: "mismatch",
    detail: `Playing level mismatch: ${playerLevel} vs ${oppLevel}`,
  };
}

/**
 * Evaluate location compatibility.
 *
 * Uses string-based comparison (case-insensitive).
 * If both locations contain a common city/region keyword, treat as a match.
 * Future iterations should use geospatial coordinates.
 */
export function evaluateLocation(
  player: Partial<PlayerProfile>,
  opportunity: Partial<Opportunity>,
  weight: number,
): FactorScore {
  const playerLoc = player.location ?? null;
  const oppLoc = opportunity.location ?? null;

  if (!playerLoc || !oppLoc) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: !playerLoc
        ? "Player location not specified"
        : "Opportunity location not specified",
    };
  }

  // Simple case-insensitive comparison
  const normalize = (s: string) => s.toLowerCase().trim();
  const np = normalize(playerLoc);
  const no = normalize(oppLoc);

  // Exact match
  if (np === no) {
    return {
      contribution: weight,
      maxContribution: weight,
      status: "match",
      detail: `Location matches: ${playerLoc}`,
    };
  }

  // Check if one contains the other (e.g., "Phoenix, AZ" contains "Phoenix")
  if (np.includes(no) || no.includes(np)) {
    return {
      contribution: weight,
      maxContribution: weight,
      status: "match",
      detail: `Location overlaps with: ${oppLoc}`,
    };
  }

  // Check for common substrings (first word of city)
  const npParts = np.split(",").map((s) => s.trim());
  const noParts = no.split(",").map((s) => s.trim());

  const hasCommonKeyword = npParts.some((part) =>
    noParts.includes(part),
  );

  if (hasCommonKeyword) {
    return {
      contribution: Math.round(weight * 0.8),
      maxContribution: weight,
      status: "match",
      detail: `Location nearby: ${playerLoc} ↔ ${oppLoc}`,
    };
  }

  return {
    contribution: 0,
    maxContribution: weight,
    status: "mismatch",
    detail: `Location mismatch: ${playerLoc} vs ${oppLoc}`,
  };
}

/**
 * Evaluate age compatibility.
 */
export function evaluateAge(
  player: Partial<PlayerProfile>,
  opportunity: Partial<Opportunity>,
  weight: number,
): FactorScore {
  const ageMin = opportunity.age_min ?? null;
  const ageMax = opportunity.age_max ?? null;

  // No age requirement → neutral
  if (ageMin === null && ageMax === null) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Opportunity does not specify age requirements",
    };
  }

  const playerAge = calculateAge(player.date_of_birth ?? null);

  // Missing player DOB → neutral
  if (playerAge === null) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Player date of birth not available for age verification",
    };
  }

  // Within range
  const meetsMin = ageMin === null || playerAge >= ageMin;
  const meetsMax = ageMax === null || playerAge <= ageMax;

  if (meetsMin && meetsMax) {
    const range =
      ageMin !== null && ageMax !== null
        ? `${ageMin}–${ageMax}`
        : ageMin !== null
          ? `${ageMin}+`
          : `up to ${ageMax}`;
    return {
      contribution: weight,
      maxContribution: weight,
      status: "match",
      detail: `Age ${playerAge} is within range: ${range}`,
    };
  }

  // Outside range
  if (!meetsMin && ageMin !== null) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "mismatch",
      detail: `Player age ${playerAge} is below minimum ${ageMin}`,
    };
  }

  return {
    contribution: 0,
    maxContribution: weight,
    status: "mismatch",
    detail: `Player age ${playerAge} exceeds maximum ${ageMax}`,
  };
}

/**
 * Evaluate availability compatibility.
 *
 * Compares player availability with opportunity availability.
 * Uses a simple ordinal comparison of availability types.
 */
export function evaluateAvailability(
  player: Partial<PlayerProfile>,
  opportunity: Partial<Opportunity>,
  weight: number,
): FactorScore {
  const playerAvail = player.availability ?? null;
  const oppAvail = opportunity.availability ?? null;

  if (!playerAvail || !oppAvail) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: !playerAvail
        ? "Player availability not specified"
        : "Opportunity availability not specified",
    };
  }

  // Map availability to ordinal for comparison
  const availOrder: Record<string, number> = {
    immediately: 0,
    "2_weeks": 1,
    "1_month": 2,
    next_season: 3,
    not_specified: 99,
  };

  const playerOrder = availOrder[playerAvail] ?? 99;
  const oppOrder = availOrder[oppAvail] ?? 99;

  // Both "not_specified" → neutral
  if (playerOrder === 99 && oppOrder === 99) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Availability not specified by either side",
    };
  }

  // Player is available at or before opportunity requires
  if (playerOrder <= oppOrder) {
    return {
      contribution: weight,
      maxContribution: weight,
      status: "match",
      detail: `Availability compatible: player available ${playerAvail}`,
    };
  }

  return {
    contribution: 0,
    maxContribution: weight,
    status: "mismatch",
    detail: `Availability mismatch: player available ${playerAvail}, opportunity requires ${oppAvail}`,
  };
}

/**
 * Evaluate travel compatibility.
 *
 * Considers:
 * - Player willing to travel
 * - Player travel radius
 * - Opportunity radius/distance requirements
 */
export function evaluateTravel(
  player: Partial<PlayerProfile>,
  opportunity: Partial<Opportunity>,
  weight: number,
): FactorScore {
  const willingToTravel = player.willing_to_travel;

  // Player hasn't specified travel preference
  if (willingToTravel === undefined || willingToTravel === null) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Player travel preference not specified",
    };
  }

  const playerRadius = player.travel_radius ?? null;
  const oppRadius = opportunity.radius ?? null;

  // Player is NOT willing to travel
  if (!willingToTravel) {
    // If the opportunity is in a different location, this is a mismatch
    // But we can't determine distance without location data
    // For now, if player doesn't want to travel and opportunity requires movement...
    if (oppRadius !== null && oppRadius > 0) {
      return {
        contribution: 0,
        maxContribution: weight,
        status: "mismatch",
        detail: "Player is not willing to travel but opportunity requires travel",
      };
    }
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Player is not willing to travel",
    };
  }

  // Player is willing to travel
  if (playerRadius !== null && oppRadius !== null) {
    if (playerRadius >= oppRadius) {
      return {
        contribution: weight,
        maxContribution: weight,
        status: "match",
        detail: `Player willing to travel ${playerRadius}mi, opportunity requires ${oppRadius}mi`,
      };
    }
    return {
      contribution: Math.round(weight * 0.3),
      maxContribution: weight,
      status: "mismatch",
      detail: `Player travel radius ${playerRadius}mi is less than opportunity requires ${oppRadius}mi`,
    };
  }

  // Willing to travel but missing radius data
  return {
    contribution: Math.round(weight * 0.5),
    maxContribution: weight,
    status: "match",
    detail: "Player is willing to travel",
  };
}

/**
 * Evaluate relocation compatibility.
 */
export function evaluateRelocation(
  player: Partial<PlayerProfile>,
  opportunity: Partial<Opportunity>,
  weight: number,
): FactorScore {
  const willingToRelocate = player.willing_to_relocate;

  // If player hasn't specified → neutral
  if (willingToRelocate === undefined || willingToRelocate === null) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Player relocation preference not specified",
    };
  }

  // Check if relocation might be needed based on location mismatch
  const playerLoc = player.location ?? null;
  const oppLoc = opportunity.location ?? null;
  const locationDiffers =
    playerLoc !== null &&
    oppLoc !== null &&
    playerLoc.toLowerCase().trim() !== oppLoc.toLowerCase().trim();

  // Relocation is not needed (same location or unknown)
  if (!locationDiffers) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Relocation is not required",
    };
  }

  // Relocation may be needed
  if (willingToRelocate) {
    return {
      contribution: weight,
      maxContribution: weight,
      status: "match",
      detail: "Player is willing to relocate",
    };
  }

  return {
    contribution: 0,
    maxContribution: weight,
    status: "mismatch",
    detail: "Player is not willing to relocate but location differs",
  };
}

/**
 * Evaluate preferred foot compatibility.
 */
export function evaluatePreferredFoot(
  player: Partial<PlayerProfile>,
  opportunity: Partial<Opportunity>,
  weight: number,
): FactorScore {
  const playerFoot = player.preferred_foot ?? null;
  const oppFoot = opportunity.preferred_foot ?? null;

  // Opportunity doesn't specify foot → neutral
  if (!oppFoot) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Opportunity does not specify preferred foot",
    };
  }

  // Player hasn't specified foot → neutral (not a penalty)
  if (!playerFoot) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Player preferred foot not specified",
    };
  }

  // Both specified: check match
  if (playerFoot.toLowerCase() === oppFoot.toLowerCase()) {
    return {
      contribution: weight,
      maxContribution: weight,
      status: "match",
      detail: `Preferred foot matches: ${playerFoot}`,
    };
  }

  // "both" matches any specific foot requirement
  if (playerFoot.toLowerCase() === "both") {
    return {
      contribution: weight,
      maxContribution: weight,
      status: "match",
      detail: "Player is comfortable with both feet",
    };
  }

  return {
    contribution: 0,
    maxContribution: weight,
    status: "mismatch",
    detail: `Preferred foot mismatch: player ${playerFoot}, opportunity prefers ${oppFoot}`,
  };
}

/**
 * Evaluate league preference compatibility.
 */
export function evaluateLeaguePreference(
  player: Partial<PlayerProfile>,
  opportunity: Partial<Opportunity>,
  weight: number,
): FactorScore {
  const preferredLeagues = player.preferred_leagues ?? [];
  const oppLeague = opportunity.league ?? null;

  // No opportunity league → neutral
  if (!oppLeague) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Opportunity does not specify a league",
    };
  }

  // Player hasn't specified preferences → neutral (don't penalize)
  if (!Array.isArray(preferredLeagues) || preferredLeagues.length === 0) {
    return {
      contribution: 0,
      maxContribution: weight,
      status: "neutral",
      detail: "Player has not specified league preferences",
    };
  }

  // Check if opportunity league is in player's preferred leagues
  const leagueMatch = preferredLeagues.some(
    (l) => l.toLowerCase().trim() === oppLeague.toLowerCase().trim(),
  );

  if (leagueMatch) {
    return {
      contribution: weight,
      maxContribution: weight,
      status: "match",
      detail: `League preference matches: ${oppLeague}`,
    };
  }

  // Not a match, but not a strong negative
  return {
    contribution: 0,
    maxContribution: weight,
    status: "mismatch",
    detail: `League ${oppLeague} is not in player's preferred leagues`,
  };
}

// ─── Aggregation ─────────────────────────────────────────────────

/**
 * Aggregation of all factor evaluators.
 * Returns a complete result object.
 */
export function aggregateEvaluations(
  evals: FactorScore[],
): Pick<MatchResult, "reasons" | "mismatches"> {
  const reasons: string[] = [];
  const mismatches: string[] = [];

  for (const e of evals) {
    if (e.status === "match") {
      reasons.push(`✓ ${e.detail}`);
    } else if (e.status === "mismatch") {
      mismatches.push(`⚠ ${e.detail}`);
    }
  }

  return { reasons, mismatches };
}