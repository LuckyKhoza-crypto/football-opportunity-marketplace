"use client";

import { useState } from "react";
import type { MatchResult, FactorBreakdown } from "@/lib/matching";
import type { PlayerProfile, Opportunity } from "@/types";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  HelpCircle,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

// ─── Classification Labels ───────────────────────────────────────

const CLASSIFICATION_LABELS: Record<string, string> = {
  excellent: "Excellent Match",
  strong: "Strong Match",
  possible: "Possible Match",
  weak: "Weak Match",
  poor: "Poor Match",
};

const CLASSIFICATION_COLORS: Record<string, string> = {
  excellent:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  strong:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  possible:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  weak: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  poor: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const SCORE_COLORS: Record<string, string> = {
  excellent: "text-green-600 dark:text-green-400",
  strong: "text-emerald-600 dark:text-emerald-400",
  possible: "text-blue-600 dark:text-blue-400",
  weak: "text-yellow-600 dark:text-yellow-400",
  poor: "text-red-600 dark:text-red-400",
};

// ─── Factor Display Helpers ──────────────────────────────────────

const FACTOR_LABELS: Record<keyof FactorBreakdown, string> = {
  position: "Position",
  playing_level: "Playing Level",
  location: "Location",
  age: "Age",
  availability: "Availability",
  travel: "Travel",
  relocation: "Relocation",
  preferred_foot: "Preferred Foot",
  league_preference: "League Preference",
};

function getFactorLevelLabel(
  contribution: number,
  maxContribution: number,
  status: string,
): { label: string; color: string } {
  if (status === "neutral" || status === "unknown") {
    const labels: Record<string, string> = {
      neutral: "\u2014",
      unknown: "Unknown",
    };
    const colors: Record<string, string> = {
      neutral: "text-muted-foreground",
      unknown: "text-yellow-600 dark:text-yellow-400",
    };
    return {
      label: labels[status] ?? status,
      color: colors[status] ?? "text-muted-foreground",
    };
  }

  if (maxContribution <= 0) {
    return { label: "\u2014", color: "text-muted-foreground" };
  }

  const ratio = contribution / maxContribution;
  if (ratio >= 0.9) {
    return { label: "Excellent", color: "text-green-600 dark:text-green-400" };
  }
  if (ratio >= 0.6) {
    return { label: "Good", color: "text-emerald-600 dark:text-emerald-400" };
  }
  if (ratio >= 0.3) {
    return { label: "Fair", color: "text-yellow-600 dark:text-yellow-400" };
  }
  return { label: "Mismatch", color: "text-red-600 dark:text-red-400" };
}

// ─── Missing Field Detection ─────────────────────────────────────

function getMissingPlayerFields(
  player: Partial<PlayerProfile> | null | undefined,
): string[] {
  if (!player) return ["Position", "Playing level", "Location", "Availability", "Date of birth", "Preferred foot", "League preferences"];

  const missing: string[] = [];

  if (!Array.isArray(player.positions) || player.positions.length === 0) {
    missing.push("Position");
  }
  if (!player.playing_level) {
    missing.push("Playing level");
  }
  if (!player.location) {
    missing.push("Location");
  }
  if (!player.availability) {
    missing.push("Availability");
  }
  if (!player.date_of_birth) {
    missing.push("Date of birth");
  }
  if (!player.preferred_foot) {
    missing.push("Preferred foot");
  }
  if (!Array.isArray(player.preferred_leagues) || player.preferred_leagues.length === 0) {
    missing.push("League preferences");
  }

  return missing;
}

const OPPORTUNITY_MATCHING_FIELDS: (keyof Opportunity)[] = [
  "position" as keyof Opportunity,
  "playing_level" as keyof Opportunity,
  "location" as keyof Opportunity,
  "availability" as keyof Opportunity,
  "age_min" as keyof Opportunity,
  "age_max" as keyof Opportunity,
  "preferred_foot" as keyof Opportunity,
];

function getMissingOpportunityFields(
  opportunity: Partial<Opportunity> | null | undefined,
): string[] {
  if (!opportunity) return ["Position", "Playing level", "Location", "Availability"];

  const missing: string[] = [];

  if (!opportunity.position) missing.push("Position");
  if (!opportunity.playing_level) missing.push("Playing level");
  if (!opportunity.location) missing.push("Location");
  if (!opportunity.availability) missing.push("Availability");
  if (!opportunity.age_min && !opportunity.age_max) missing.push("Age range");
  if (!opportunity.preferred_foot) missing.push("Preferred foot");

  return missing;
}

// ─── Props ───────────────────────────────────────────────────────

interface MatchDetailsProps {
  matchResult: MatchResult;
  compact?: boolean;
  playerProfile?: Partial<PlayerProfile> | null;
  opportunity?: Partial<Opportunity> | null;
  showBreakdown?: boolean;
  showReasons?: boolean;
  showSuggestions?: boolean;
  showWhyCallout?: boolean;
  completeProfileHref?: string;
  editOpportunityHref?: string;
  collapsible?: boolean;
}

// ─── Component ───────────────────────────────────────────────────

export function MatchDetails({
  matchResult,
  compact = false,
  playerProfile,
  opportunity,
  showBreakdown = true,
  showReasons = true,
  showSuggestions = true,
  showWhyCallout = true,
  completeProfileHref,
  editOpportunityHref,
  collapsible = false,
}: MatchDetailsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { score, classification, reasons, mismatches, breakdown } = matchResult;
  const classificationLabel = CLASSIFICATION_LABELS[classification] ?? classification;
  const scoreColor = SCORE_COLORS[classification] ?? "text-muted-foreground";
  const classificationColor =
    CLASSIFICATION_COLORS[classification] ?? "bg-muted text-muted-foreground";

  const missingPlayerFields = getMissingPlayerFields(playerProfile);
  const missingOppFields = getMissingOpportunityFields(opportunity);
  const hasMissingPlayerInfo = missingPlayerFields.length > 0;
  const hasMissingOppInfo = missingOppFields.length > 0;
  const hasReasons = reasons.length > 0;
  const hasMismatches = mismatches.length > 0;
  const hasContent =
    showBreakdown ||
    (showReasons && (hasReasons || hasMismatches)) ||
    (showSuggestions && (hasMissingPlayerInfo || hasMissingOppInfo));

  // Limited requirements check
  const hasLimitedRequirements = (() => {
    if (!opportunity || hasMissingOppInfo) return false;
    const setFields = OPPORTUNITY_MATCHING_FIELDS.filter((f) => {
      if (f === "age_min" || f === "age_max") {
        return opportunity.age_min != null || opportunity.age_max != null;
      }
      return opportunity[f as keyof Opportunity] != null;
    });
    return setFields.length < 4;
  })();

  // Score display
  const scoreDisplay = (
    <div className="flex items-center gap-3">
      <span className={`text-2xl font-bold tabular-nums ${scoreColor}`}>
        {score}% Match
      </span>
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${classificationColor}`}
      >
        {classificationLabel}
      </span>
    </div>
  );

  // Breakdown
  const breakdownDisplay = showBreakdown ? (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        Match breakdown
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {(Object.keys(breakdown) as (keyof FactorBreakdown)[]).map((key) => {
          const factor = breakdown[key];
          const level = getFactorLevelLabel(
            factor.contribution,
            factor.maxContribution,
            factor.status,
          );
          return (
            <div key={key} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {FACTOR_LABELS[key]}
              </span>
              <span className={`font-medium ${level.color}`}>
                {level.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  // Reasons
  const reasonsDisplay = showReasons && hasReasons ? (
    <div>
      <p className="mb-1 text-xs font-medium text-green-600 dark:text-green-400">
        Why this matches
      </p>
      <ul className="space-y-1">
        {reasons.map((reason, i) => (
          <li
            key={i}
            className="flex items-start gap-1.5 text-xs text-muted-foreground"
          >
            <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-green-500" />
            {reason.replace(/^✓\s*/, "")}
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  // Mismatches
  const mismatchesDisplay = showReasons && hasMismatches ? (
    <div>
      <p className="mb-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        Potential differences
      </p>
      <ul className="space-y-1">
        {mismatches.map((mismatch, i) => (
          <li
            key={i}
            className="flex items-start gap-1.5 text-xs text-muted-foreground"
          >
            <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-500" />
            {mismatch.replace(/^⚠\s*/, "")}
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  // Missing player info
  const missingPlayerDisplay = showSuggestions && hasMissingPlayerInfo ? (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            Complete your profile for better matches
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Your profile is missing:
          </p>
          <ul className="mt-1 space-y-0.5">
            {missingPlayerFields.map((field) => (
              <li
                key={field}
                className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"
              >
                <span className="text-amber-500">\u2022</span>
                {field}
              </li>
            ))}
          </ul>
          {completeProfileHref && (
            <div className="mt-2">
              <a href={completeProfileHref}>
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  Complete Profile
                </Button>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  // Missing opportunity info
  const missingOppDisplay = showSuggestions && hasMissingOppInfo && editOpportunityHref ? (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">
            Improve your opportunity
          </p>
          <p className="mt-1 text-xs text-blue-700 dark:text-blue-400">
            Adding missing requirements can make player matching more accurate:
          </p>
          <ul className="mt-1 space-y-0.5">
            {missingOppFields.map((field) => (
              <li
                key={field}
                className="flex items-center gap-1 text-xs text-blue-700 dark:text-blue-400"
              >
                <span className="text-blue-500">\u2022</span>
                {field}
              </li>
            ))}
          </ul>
          {editOpportunityHref && (
            <div className="mt-2">
              <a href={editOpportunityHref}>
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  Edit Opportunity
                </Button>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  // Limited requirements notice
  const limitedRequirementsDisplay = showSuggestions && hasLimitedRequirements ? (
    <div className="rounded-lg border border-muted bg-muted/30 p-3">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            Limited requirements
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This opportunity has limited requirements. The match score may be
            less precise.
          </p>
        </div>
      </div>
    </div>
  ) : null;

  // Why callout
  const whyCallout = showWhyCallout ? (
    <p className="text-xs font-medium text-muted-foreground">
      Profile compatibility \u2014 this score represents how well the
      profile matches the requirements, not a talent evaluation.
    </p>
  ) : null;

  // Content for collapsible/expanded state
  const expandedContent = hasContent ? (
    <div className="space-y-3">
      {whyCallout}
      {breakdownDisplay}
      {reasonsDisplay}
      {mismatchesDisplay}
      {missingPlayerDisplay}
      {missingOppDisplay}
      {limitedRequirementsDisplay}
    </div>
  ) : null;

  // Collapsible mode
  if (collapsible) {
    return (
      <div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          {scoreDisplay}
          {isOpen ? (
            <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          )}
        </button>
        {isOpen && expandedContent && (
          <div className="mt-3 border-t pt-3">
            {expandedContent}
          </div>
        )}
      </div>
    );
  }

  // Compact mode
  if (compact) {
    return (
      <div className="space-y-2">
        {scoreDisplay}
        <Progress value={score} className="h-2" />
        {showWhyCallout && (
          <p className="text-xs text-muted-foreground">
            Profile compatibility \u2014 not a talent evaluation.
          </p>
        )}
        {breakdownDisplay}
        {reasonsDisplay}
        {mismatchesDisplay}
        {missingPlayerDisplay}
        {missingOppDisplay}
        {limitedRequirementsDisplay}
      </div>
    );
  }

  // Full mode
  return (
    <div className="space-y-3">
      {scoreDisplay}
      <Progress value={score} className="h-2" />
      {whyCallout}
      {breakdownDisplay}
      {reasonsDisplay}
      {mismatchesDisplay}
      {missingPlayerDisplay}
      {missingOppDisplay}
      {limitedRequirementsDisplay}
    </div>
  );
}