/**
 * Types for the Player ↔ Opportunity Matching Engine
 *
 * This module defines the input/output types for the deterministic matching engine.
 * The engine evaluates profile/requirement compatibility, NOT football talent.
 *
 * @module matching
 */

import type { PlayerProfile, Opportunity } from "@/types";

/**
 * The result of matching a player to an opportunity.
 */
export interface MatchResult {
  /** Overall compatibility score 0–100 */
  score: number;
  /** Human-readable reasons for the score (positive matches) */
  reasons: string[];
  /** Human-readable reasons for deductions (mismatches) */
  mismatches: string[];
  /** Quality classification label */
  classification: MatchQuality;
  /** Breakdown of individual factor scores (for transparency/debugging) */
  breakdown: FactorBreakdown;
}

/** Quality classification for a match score */
export type MatchQuality =
  | "excellent"
  | "strong"
  | "possible"
  | "weak"
  | "poor";

/** Detailed breakdown of each factor's contribution */
export interface FactorBreakdown {
  position: FactorScore;
  playing_level: FactorScore;
  location: FactorScore;
  age: FactorScore;
  availability: FactorScore;
  travel: FactorScore;
  relocation: FactorScore;
  preferred_foot: FactorScore;
  league_preference: FactorScore;
}

/** Individual factor evaluation */
export interface FactorScore {
  /** Contribution to total score (0–100 weighted) */
  contribution: number;
  /** Maximum possible contribution for this factor */
  maxContribution: number;
  /** Status of this factor */
  status: "match" | "mismatch" | "neutral" | "unknown";
  /** Human-readable detail */
  detail: string;
}

/**
 * Input type for the matching engine.
 * Both player and opportunity are partial to allow flexibility.
 */
export interface MatchInput {
  player: Partial<PlayerProfile>;
  opportunity: Partial<Opportunity>;
}

/**
 * Configuration for the matching engine weights.
 */
export interface MatchWeights {
  position: number;
  playing_level: number;
  location: number;
  age: number;
  availability: number;
  travel: number;
  relocation: number;
  preferred_foot: number;
  league_preference: number;
}

/**
 * Configuration for match quality thresholds.
 */
export interface MatchThresholds {
  excellent: number; // >= this value
  strong: number; // >= this value
  possible: number; // >= this value
  weak: number; // >= this value
  // Below weak is "poor"
}