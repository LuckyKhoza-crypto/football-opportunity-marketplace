/**
 * Core matching engine — orchestrates all factor evaluators to produce
 * a deterministic, explainable compatibility score between a player profile
 * and an opportunity.
 *
 * # Architecture
 *
 * ```
 * Player data + Opportunity data
 *         ↓
 * ┌─────────────────────────────────────┐
 * │         matchPlayerToOpportunity    │
 * │                                     │
 * │  evaluatePosition()                 │  ← Pure function
 * │  evaluatePlayingLevel()             │  ← Pure function
 * │  evaluateLocation()                 │  ← Pure function
 * │  evaluateAge()                      │  ← Pure function
 * │  evaluateAvailability()             │  ← Pure function
 * │  evaluateTravel()                   │  ← Pure function
 * │  evaluateRelocation()               │  ← Pure function
 * │  evaluatePreferredFoot()            │  ← Pure function
 * │  evaluateLeaguePreference()         │  ← Pure function
 * │         ↓                           │
 * │  Aggregate scores                   │
 * │  Classify quality                   │
 * │  Generate reasons                   │
 * │         ↓                           │
 * └─────────────────────────────────────┘
 *         ↓
 *   MatchResult { score, reasons, mismatches, classification, breakdown }
 * ```
 *
 * ## Determinism
 *
 * Given the same player and opportunity data, this engine will ALWAYS
 * return the same result. No AI, no randomness, no external dependencies.
 *
 * ## Usage
 *
 * ```ts
 * import { matchPlayerToOpportunity } from "@/lib/matching";
 *
 * const result = matchPlayerToOpportunity(playerProfile, opportunity);
 * console.log(result.score); // 0–100
 * console.log(result.reasons); // ["✓ Position matches: ST", ...]
 * console.log(result.classification); // "excellent" | "strong" | ...
 * ```
 *
 * @module matching
 */

import type { MatchResult, FactorScore, FactorBreakdown, MatchQuality } from "./types";
import type { PlayerProfile, Opportunity } from "@/types";
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from "./constants";
import {
  evaluatePosition,
  evaluatePlayingLevel,
  evaluateLocation,
  evaluateAge,
  evaluateAvailability,
  evaluateTravel,
  evaluateRelocation,
  evaluatePreferredFoot,
  evaluateLeaguePreference,
  aggregateEvaluations,
} from "./evaluators";

/**
 * Match a player profile to an opportunity.
 *
 * This is the main entry point for the matching engine.
 *
 * @param player  Partial player profile (only fields used for matching)
 * @param opportunity Partial opportunity (only fields used for matching)
 * @param weights Optional custom weights (defaults to DEFAULT_WEIGHTS)
 * @param thresholds Optional custom thresholds (defaults to DEFAULT_THRESHOLDS)
 * @returns MatchResult with score, reasons, mismatches, classification, and breakdown
 */
export function matchPlayerToOpportunity(
  player: Partial<PlayerProfile>,
  opportunity: Partial<Opportunity>,
  weights = DEFAULT_WEIGHTS,
  thresholds = DEFAULT_THRESHOLDS,
): MatchResult {
  // Run all factor evaluations
  const positionScore = evaluatePosition(player, opportunity, weights.position);
  const levelScore = evaluatePlayingLevel(player, opportunity, weights.playing_level);
  const locationScore = evaluateLocation(player, opportunity, weights.location);
  const ageScore = evaluateAge(player, opportunity, weights.age);
  const availabilityScore = evaluateAvailability(player, opportunity, weights.availability);
  const travelScore = evaluateTravel(player, opportunity, weights.travel);
  const relocationScore = evaluateRelocation(player, opportunity, weights.relocation);
  const footScore = evaluatePreferredFoot(player, opportunity, weights.preferred_foot);
  const leagueScore = evaluateLeaguePreference(player, opportunity, weights.league_preference);

  const allScores: FactorScore[] = [
    positionScore,
    levelScore,
    locationScore,
    ageScore,
    availabilityScore,
    travelScore,
    relocationScore,
    footScore,
    leagueScore,
  ];

  // Calculate total score
  const totalMaxContribution = allScores.reduce(
    (sum, s) => sum + s.maxContribution,
    0,
  );

  const totalContribution = allScores.reduce(
    (sum, s) => sum + s.contribution,
    0,
  );

  // Normalize to 0–100
  const rawScore =
    totalMaxContribution > 0
      ? Math.round((totalContribution / totalMaxContribution) * 100)
      : 0;

  // Ensure 0–100 range
  const score = Math.max(0, Math.min(100, rawScore));

  // Aggregate reasons and mismatches
  const { reasons, mismatches } = aggregateEvaluations(allScores);

  // Classify the match quality
  const classification = classifyScore(score, thresholds);

  // Build breakdown
  const breakdown = buildBreakdown(allScores);

  return {
    score,
    reasons,
    mismatches,
    classification,
    breakdown,
  };
}

/**
 * Classify a score into a human-readable quality label.
 */
export function classifyScore(
  score: number,
  thresholds = DEFAULT_THRESHOLDS,
): MatchQuality {
  if (score >= thresholds.excellent) return "excellent";
  if (score >= thresholds.strong) return "strong";
  if (score >= thresholds.possible) return "possible";
  if (score >= thresholds.weak) return "weak";
  return "poor";
}

/**
 * Build a factor breakdown object from all factor scores.
 */
function buildBreakdown(scores: FactorScore[]): FactorBreakdown {
  const [
    position,
    playing_level,
    location,
    age,
    availability,
    travel,
    relocation,
    preferred_foot,
    league_preference,
  ] = scores;

  return {
    position,
    playing_level,
    location,
    age,
    availability,
    travel,
    relocation,
    preferred_foot,
    league_preference,
  };
}