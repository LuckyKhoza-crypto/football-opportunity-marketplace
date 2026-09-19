"use client";

import Link from "next/link";
import {
  POSITION_LABELS,
  PLAYING_LEVEL_LABELS,
  AVAILABILITY_LABELS,
  type Opportunity,
} from "@/types";
import type { MatchResult } from "@/lib/matching";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MatchDetails } from "@/components/marketplace/match-details";
import {
  MapPin,
  Calendar,
  Swords,
  Users,
  ArrowRight,
  DollarSign,
} from "lucide-react";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  excellent: "Excellent Match",
  strong: "Strong Match",
  possible: "Possible Match",
  weak: "Weak Match",
  poor: "Poor Match",
};

const CLASSIFICATION_COLORS: Record<string, string> = {
  excellent:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  strong:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  possible:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  weak: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  poor: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

interface RecommendationCardProps {
  opportunity: Opportunity & {
    team_name?: string | null;
    team_logo?: string | null;
  };
  matchResult: MatchResult;
}

export function RecommendationCard({
  opportunity,
  matchResult,
}: RecommendationCardProps) {
  const { classification } = matchResult;

  const positionLabel = opportunity.position
    ? POSITION_LABELS[opportunity.position] ?? opportunity.position
    : "Any Position";

  const levelLabel = opportunity.playing_level
    ? PLAYING_LEVEL_LABELS[
        opportunity.playing_level as keyof typeof PLAYING_LEVEL_LABELS
      ] ?? opportunity.playing_level
    : null;

  const availabilityLabel = opportunity.availability
    ? AVAILABILITY_LABELS[
        opportunity.availability as keyof typeof AVAILABILITY_LABELS
      ] ?? opportunity.availability
    : null;

  const classificationLabel =
    CLASSIFICATION_LABELS[classification] ?? classification;
  const classificationColor =
    CLASSIFICATION_COLORS[classification] ?? "bg-muted text-muted-foreground";

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex flex-col gap-4">
          {/* Match Classification */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${classificationColor}`}
              >
                {classificationLabel}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              Profile Compatibility
            </span>
          </div>

          {/* Team Info */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
              {opportunity.team_logo ? (
                <img
                  src={opportunity.team_logo}
                  alt={`${opportunity.team_name ?? "Team"} logo`}
                  className="h-10 w-10 rounded-lg object-cover"
                />
              ) : (
                <Users className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold">
                {opportunity.team_name ?? "Unknown Team"}
              </p>
              {levelLabel && (
                <p className="text-xs text-muted-foreground">
                  {levelLabel}
                  {opportunity.league && (
                    <>
                      {" "}&middot;{" "}
                      {opportunity.league}
                    </>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Opportunity Details */}
          <div>
            <h3 className="text-base font-bold">{opportunity.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {positionLabel}
              </span>
              {opportunity.role && (
                <span className="text-xs text-muted-foreground">
                  {opportunity.role}
                </span>
              )}
            </div>
          </div>

          {/* Meta Info */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {opportunity.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {opportunity.location}
              </span>
            )}
            {availabilityLabel && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {availabilityLabel}
              </span>
            )}
            {opportunity.tryout_date && (
              <span className="flex items-center gap-1">
                <Swords className="h-3.5 w-3.5" />
                Tryout: {formatDate(opportunity.tryout_date)}
              </span>
            )}
            {opportunity.compensation && (
              <span className="flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" />
                {opportunity.compensation}
              </span>
            )}
          </div>

          {/* Match Details — Collapsible */}
          {(matchResult.reasons.length > 0 || matchResult.mismatches.length > 0) && (
            <div className="border-t pt-3">
              <MatchDetails
                matchResult={matchResult}
                collapsible
                showBreakdown
                showReasons
                showSuggestions={false}
                showWhyCallout={false}
              />
            </div>
          )}

          {/* CTA */}
          <div className="pt-1">
            <Link href={`/opportunities/${opportunity.id}`}>
              <Button variant="outline" size="sm" className="group">
                View Opportunity
                <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}