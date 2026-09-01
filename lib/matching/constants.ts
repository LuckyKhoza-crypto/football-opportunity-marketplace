/**
 * Constants and configuration for the matching engine.
 *
 * ## Weights
 *
 * The scoring system uses weighted factors to determine overall compatibility.
 * All weights sum to 100%.
 *
 * | Factor             | Weight | Rationale                                                      |
 * |--------------------|--------|----------------------------------------------------------------|
 * | Position           | 30%    | Most critical — player must be able to play the required role  |
 * | Playing Level      | 20%    | Skill/experience compatibility                                 |
 * | Location           | 15%    | Practicality of the move                                       |
 * | Age                | 10%    | Age range requirements                                         |
 * | Availability       | 10%    | Timing compatibility                                           |
 * | Travel/Relocation  | 5%     | Combined weight for mobility factors                           |
 * | Preferred Foot     | 5%     | Tactical preference, less critical than position/level         |
 * | League Preference  | 5%     | Nice-to-have alignment                                         |
 *
 * ## Level Hierarchy
 *
 * Playing levels are ordered by increasing competitiveness.
 * A mismatch penalty depends on the distance in this hierarchy.
 *
 * ```
 * recreational < amateur < competitive_amateur < semi_pro < academy < college < professional
 * ```
 *
 * Matching logic:
 * - Exact level match → full score
 * - Adjacent level (e.g., amateur ↔ competitive_amateur) → partial match
 * - Two+ levels apart → significant penalty
 * - Extreme mismatch (e.g., recreational ↔ professional) → near-zero
 *
 * ## Missing Data Behavior
 *
 * - Missing optional information (foot, league preferences) → **neutral** (no penalty)
 * - Missing critical information (position, level) → **unknown** (partial score)
 * - Missing player DOB when opportunity has age range → **neutral** (no penalty)
 * - We do NOT treat missing data as a mismatch.
 *
 * ## Known Limitations
 *
 * 1. **Location comparison is string-based.** The engine uses simple city/state
 *    string matching or the existing location fields directly. It does not use
 *    geocoding. Future iterations should integrate a geospatial distance
 *    calculation (e.g., using PostGIS or a coordinate-based approach).
 *
 * 2. **Compensation is not scored.** The data model does not provide structured
 *    comparable compensation fields. Compensation is preserved in the result
 *    but does not affect the score.
 *
 * 3. **Travel radius comparison uses basic number comparison.** The engine
 *    checks if the player's travel_radius >= the opportunity's radius (distance).
 *    True geographic distance calculation is not performed.
 *
 * 4. **No persistence.** Match scores are calculated on-the-fly and are not
 *    stored. If performance becomes an issue, caching can be added later.
 *
 * @module matching
 */

import type { MatchWeights, MatchThresholds } from "./types";

/**
 * Factor weights for scoring.
 * All values are percentages that sum to 100.
 */
export const DEFAULT_WEIGHTS: MatchWeights = {
  position: 30,
  playing_level: 20,
  location: 15,
  age: 10,
  availability: 10,
  travel: 3,
  relocation: 2,
  preferred_foot: 5,
  league_preference: 5,
};

/** Verify weights sum to 100 */
const WEIGHT_SUM = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
if (WEIGHT_SUM !== 100) {
  throw new Error(
    `Matching weights must sum to 100, but they sum to ${WEIGHT_SUM}`,
  );
}

/**
 * Match quality thresholds (inclusive on lower bound).
 *
 * | Score Range      | Classification  |
 * |------------------|-----------------|
 * | 90–100           | Excellent Match |
 * | 75–89            | Strong Match    |
 * | 60–74            | Possible Match  |
 * | 40–59            | Weak Match      |
 * | 0–39             | Poor Match      |
 */
export const DEFAULT_THRESHOLDS: MatchThresholds = {
  excellent: 90,
  strong: 75,
  possible: 60,
  weak: 40,
};

/**
 * Playing level hierarchy ordered by competitiveness (lowest to highest).
 *
 * The index position determines the "distance" between levels for mismatch
 * calculations. To add a new level, insert it at the appropriate position.
 */
export const LEVEL_HIERARCHY: readonly string[] = [
  "recreational",
  "amateur",
  "competitive_amateur",
  "semi_pro",
  "academy",
  "college",
  "professional",
] as const;

/**
 * Get the numeric rank of a playing level.
 * Returns -1 if the level is not recognized.
 */
export function getLevelRank(level: string | null | undefined): number {
  if (!level) return -1;
  return LEVEL_HIERARCHY.indexOf(level);
}

/**
 * Position matching scores.
 *
 * - **Exact match** (player has position === opportunity requires): full score
 * - **Secondary position** (player's secondary includes the position): partial score
 * - **No match**: significant penalty
 */
export const POSITION_EXACT_MATCH_FACTOR = 1.0;
export const POSITION_SECONDARY_MATCH_FACTOR = 0.6;
export const POSITION_NO_MATCH_FACTOR = 0.0;

/**
 * Level matching score factors.
 *
 * - **Exact match**: full score
 * - **1 level apart**: 0.8
 * - **2 levels apart**: 0.5
 * - **3 levels apart**: 0.25
 * - **4+ levels apart**: 0.1
 *
 * These factors are applied to the playing level weight.
 */
export function getLevelMatchFactor(playerLevel: string, oppLevel: string): number {
  const playerRank = getLevelRank(playerLevel);
  const oppRank = getLevelRank(oppLevel);

  if (playerRank === -1 || oppRank === -1) return 0.5; // unknown level → partial

  const distance = Math.abs(playerRank - oppRank);

  if (distance === 0) return 1.0;
  if (distance === 1) return 0.8;
  if (distance === 2) return 0.5;
  if (distance === 3) return 0.25;
  return 0.1;
}

/**
 * Normalize a numeric value to be within the range [0, maxScore].
 */
export function normalizeScore(raw: number, maxScore: number): number {
  return Math.max(0, Math.min(maxScore, raw));
}