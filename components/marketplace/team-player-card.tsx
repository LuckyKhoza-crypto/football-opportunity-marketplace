"use client";

import Link from "next/link";
import {
  POSITION_LABELS,
  PLAYING_LEVEL_LABELS,
  AVAILABILITY_LABELS,
  PREFERRED_FOOT_LABELS,
  type PlayerProfile,
} from "@/types";
import type { MatchResult } from "@/lib/matching";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MatchDetails } from "@/components/marketplace/match-details";
import {
  MapPin,
  Calendar,
  Users,
  ArrowRight,
  Footprints,
} from "lucide-react";

function calculateAge(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function formatPositions(positions: string[]): string {
  if (!positions || positions.length === 0) return "Any Position";
  return positions
    .map((p) => POSITION_LABELS[p] ?? p)
    .join(" / ");
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

interface TeamPlayerCardProps {
  player: PlayerProfile & {
    full_name?: string | null;
    avatar_url?: string | null;
  };
  matchResult: MatchResult;
}

export function TeamPlayerCard({
  player,
  matchResult,
}: TeamPlayerCardProps) {
  const { score, classification } = matchResult;

  const age = calculateAge(player.date_of_birth);
  const primaryPosition = player.positions?.[0] ?? null;
  const secondaryPositions = player.positions?.slice(1) ?? [];
  const levelLabel = player.playing_level
    ? PLAYING_LEVEL_LABELS[player.playing_level] ?? player.playing_level
    : null;
  const availabilityLabel = player.availability
    ? AVAILABILITY_LABELS[player.availability] ?? player.availability
    : null;
  const footLabel = player.preferred_foot
    ? PREFERRED_FOOT_LABELS[player.preferred_foot] ?? player.preferred_foot
    : null;

  const classificationLabel =
    CLASSIFICATION_LABELS[classification] ?? classification;
  const scoreColor = SCORE_COLORS[classification] ?? "text-muted-foreground";
  const classificationColor =
    CLASSIFICATION_COLORS[classification] ?? "bg-muted text-muted-foreground";

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex flex-col gap-4">
          {/* Match Score */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className={`text-2xl font-bold tabular-nums ${scoreColor}`}
              >
                {score}%
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${classificationColor}`}
              >
                {classificationLabel}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              Match
            </span>
          </div>

          {/* Score Progress Bar */}
          <Progress value={score} className="h-2" />

          {/* Player Info */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-muted">
              {player.profile_photo_url ? (
                <img
                  src={player.profile_photo_url}
                  alt={`${player.full_name ?? "Player"} photo`}
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <Users className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold">
                {player.full_name ?? "Unknown Player"}
              </p>
              {primaryPosition && (
                <p className="text-sm font-medium text-primary">
                  {formatPositions(player.positions ?? [])}
                </p>
              )}
            </div>
          </div>

          {/* Player Details */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {age !== null && (
              <span>{age} years old</span>
            )}
            {player.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {player.location}
              </span>
            )}
            {levelLabel && (
              <span>{levelLabel}</span>
            )}
            {footLabel && (
              <span className="flex items-center gap-1">
                <Footprints className="h-3.5 w-3.5" />
                {footLabel}
              </span>
            )}
            {availabilityLabel && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {availabilityLabel}
              </span>
            )}
          </div>

          {/* Secondary Positions */}
          {secondaryPositions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {secondaryPositions.map((pos) => (
                <span
                  key={pos}
                  className="inline-flex items-center rounded-md bg-secondary/50 px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {POSITION_LABELS[pos] ?? pos}
                </span>
              ))}
            </div>
          )}

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
            <Link href={`/players/${player.id}`}>
              <Button variant="outline" size="sm" className="group">
                View Player
                <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}