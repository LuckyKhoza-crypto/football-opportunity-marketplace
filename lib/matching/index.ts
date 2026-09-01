/**
 * Matching Engine — barrel export.
 *
 * Public API for the Player ↔ Opportunity matching engine.
 *
 * @module matching
 */

export { matchPlayerToOpportunity, classifyScore } from "./engine";
export {
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  LEVEL_HIERARCHY,
  getLevelRank,
  getLevelMatchFactor,
} from "./constants";
export type {
  MatchResult,
  MatchQuality,
  FactorBreakdown,
  FactorScore,
  MatchInput,
  MatchWeights,
  MatchThresholds,
} from "./types";