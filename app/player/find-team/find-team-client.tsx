"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RecommendationCard } from "@/components/marketplace/recommendation-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  POSITIONS,
  POSITION_LABELS,
  PLAYING_LEVELS,
  PLAYING_LEVEL_LABELS,
  AVAILABILITY_OPTIONS,
  AVAILABILITY_LABELS,
} from "@/types";
import type { Opportunity, PlayerProfile } from "@/types";
import type { MatchResult } from "@/lib/matching";
import {
  Search,
  SlidersHorizontal,
  X,
  Swords,
  AlertTriangle,
  UserPlus,
} from "lucide-react";

interface RankedOpportunity {
  opportunity: Opportunity & {
    team_name?: string | null;
    team_logo?: string | null;
  };
  matchResult: MatchResult;
}

interface FindTeamClientProps {
  rankedOpportunities: RankedOpportunity[];
  totalCount: number;
  error: boolean;
  leagues: string[];
  playerProfileComplete: boolean;
  missingImportantFields: boolean;
  missingFields?: string[];
  playerProfile?: Partial<PlayerProfile> | null;
}

const MIN_MATCH_OPTIONS = [
  { value: "0", label: "Any match" },
  { value: "60", label: "60%+" },
  { value: "75", label: "75%+" },
  { value: "90", label: "90%+" },
];

const SORT_OPTIONS = [
  { value: "match", label: "Best Match" },
  { value: "newest", label: "Newest" },
  { value: "tryout", label: "Tryout Date" },
];

export function FindTeamClient({
  rankedOpportunities,
  totalCount,
  error,
  leagues,
  playerProfileComplete,
  missingImportantFields,
  missingFields,
  playerProfile,
}: FindTeamClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentQ = searchParams.get("q") ?? "";
  const currentPosition = searchParams.get("position") ?? "";
  const currentLevel = searchParams.get("level") ?? "";
  const currentLeague = searchParams.get("league") ?? "";
  const currentAvailability = searchParams.get("availability") ?? "";
  const currentMinMatch = searchParams.get("minMatch") ?? "0";
  const currentSort = searchParams.get("sort") ?? "match";

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      const qs = params.toString();
      router.push(qs ? `/player/find-team?${qs}` : "/player/find-team");
    },
    [router, searchParams],
  );

  const clearFilters = useCallback(() => {
    router.push("/player/find-team");
  }, [router]);

  const updateFilter = useCallback(
    (key: string, value: string) => {
      updateParams({ [key]: value === "all" ? null : value });
    },
    [updateParams],
  );

  const hasActiveFilters =
    currentPosition ||
    currentLevel ||
    currentLeague ||
    currentAvailability ||
    currentQ ||
    currentMinMatch !== "0";

  // Apply client-side filters and sorting
  const filteredResults = useMemo(() => {
    let results = [...rankedOpportunities];

    // Search filter
    const q = currentQ.toLowerCase().trim();
    if (q) {
      results = results.filter((r) => {
        const opp = r.opportunity;
        const searchable = [
          opp.team_name ?? "",
          opp.title ?? "",
          opp.position ?? "",
          opp.league ?? "",
          opp.location ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return searchable.includes(q);
      });
    }

    // Position filter
    if (currentPosition) {
      results = results.filter(
        (r) => r.opportunity.position === currentPosition,
      );
    }

    // Level filter
    if (currentLevel) {
      results = results.filter(
        (r) => r.opportunity.playing_level === currentLevel,
      );
    }

    // League filter
    if (currentLeague) {
      results = results.filter(
        (r) => r.opportunity.league === currentLeague,
      );
    }

    // Availability filter
    if (currentAvailability) {
      results = results.filter(
        (r) => r.opportunity.availability === currentAvailability,
      );
    }

    // Minimum match filter
    const minMatch = parseInt(currentMinMatch, 10) || 0;
    if (minMatch > 0) {
      results = results.filter((r) => r.matchResult.score >= minMatch);
    }

    // Sorting
    const sort = currentSort;
    if (sort === "newest") {
      results.sort(
        (a, b) =>
          new Date(b.opportunity.created_at).getTime() -
          new Date(a.opportunity.created_at).getTime(),
      );
    } else if (sort === "tryout") {
      results.sort((a, b) => {
        const dateA = a.opportunity.tryout_date
          ? new Date(a.opportunity.tryout_date).getTime()
          : Infinity;
        const dateB = b.opportunity.tryout_date
          ? new Date(b.opportunity.tryout_date).getTime()
          : Infinity;
        return dateA - dateB;
      });
    } else {
      // Default: Best Match (already sorted by score descending)
      // Use deterministic secondary sort by newest for equal scores
      results.sort((a, b) => {
        const scoreDiff = b.matchResult.score - a.matchResult.score;
        if (scoreDiff !== 0) return scoreDiff;
        return (
          new Date(b.opportunity.created_at).getTime() -
          new Date(a.opportunity.created_at).getTime()
        );
      });
    }

    return results;
  }, [
    rankedOpportunities,
    currentQ,
    currentPosition,
    currentLevel,
    currentLeague,
    currentAvailability,
    currentMinMatch,
    currentSort,
  ]);

  // Get all the actually applicable suggestions
  const applicableSuggestions = useMemo(() => {
    const items: string[] = [];
    // If player has location, suggest expanding (always reasonable)
    if (playerProfile?.location && rankedOpportunities.length > 0) {
      // Only if there are few results
      if (filteredResults.length < 5) {
        items.push("Expanding your location range");
      }
    }
    // If player hasn't set availability
    if (!playerProfile?.availability) {
      items.push("Setting your availability");
    }
    // Add secondary positions if they only have one
    if (
      playerProfile?.positions &&
      playerProfile.positions.length <= 1
    ) {
      items.push("Adding secondary positions");
    }
    // Lowering minimum match filter
    if (currentMinMatch !== "0") {
      items.push("Lowering the minimum match filter");
    }
    return items;
  }, [playerProfile, currentMinMatch, rankedOpportunities.length, filteredResults.length]);

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center py-24 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="mb-2 text-2xl font-bold">
          Failed to load your recommendations.
        </h2>
        <p className="mb-6 max-w-md text-muted-foreground">
          Something went wrong. Please try again.
        </p>
        <Button onClick={() => router.refresh()}>Try Again</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Incomplete Profile Notice */}
      {!playerProfileComplete && missingImportantFields && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            <div>
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Complete your profile for better matches
              </h3>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
                Your profile is missing:
              </p>
              <ul className="mt-1 space-y-0.5">
                {missingFields?.map((field) => (
                  <li
                    key={field}
                    className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400"
                  >
                    <span className="text-amber-500">•</span>
                    {field}
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <a href="/player/profile/edit">
                  <Button size="sm" variant="outline">
                    Complete Profile
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search teams, positions, leagues..."
          defaultValue={currentQ}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              updateParams({ q: (e.target as HTMLInputElement).value || null });
            }
          }}
          className="pl-10"
        />
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Position Filter */}
          <Select
            value={currentPosition}
            onValueChange={(v) => updateFilter("position", v)}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Position" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Positions</SelectItem>
              {POSITIONS.map((pos) => (
                <SelectItem key={pos} value={pos}>
                  {POSITION_LABELS[pos] ?? pos}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Level Filter */}
          <Select
            value={currentLevel}
            onValueChange={(v) => updateFilter("level", v)}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Playing Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              {PLAYING_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {PLAYING_LEVEL_LABELS[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* League Filter */}
          <Select
            value={currentLeague}
            onValueChange={(v) => updateFilter("league", v)}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="League" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Leagues</SelectItem>
              {leagues.map((league) => (
                <SelectItem key={league} value={league}>
                  {league}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Availability Filter */}
          <Select
            value={currentAvailability}
            onValueChange={(v) => updateFilter("availability", v)}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Availability" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Availability</SelectItem>
              {AVAILABILITY_OPTIONS.map((av) => (
                <SelectItem key={av} value={av}>
                  {AVAILABILITY_LABELS[av]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Minimum Match Filter */}
          <Select
            value={currentMinMatch}
            onValueChange={(v) =>
              updateParams({ minMatch: v === "0" ? null : v })
            }
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Min Match" />
            </SelectTrigger>
            <SelectContent>
              {MIN_MATCH_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Active Filters Indicator & Clear */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 h-4 w-4" />
            Clear Filters
          </Button>
        )}
      </div>

      {/* Sort & Results Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {filteredResults.length === 1
            ? "1 opportunity found"
            : `${filteredResults.length} opportunities found`}
        </p>
        <Select
          value={currentSort}
          onValueChange={(v) => updateParams({ sort: v })}
        >
          <SelectTrigger className="w-[150px]">
            <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      {filteredResults.length === 0 ? (
        <div className="flex flex-col items-center py-24 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Swords className="h-8 w-8 text-muted-foreground" />
          </div>
          {totalCount === 0 ? (
            <>
              <h2 className="mb-2 text-2xl font-bold">
                No opportunities available yet.
              </h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                Check back soon as teams post new opportunities.
              </p>
            </>
          ) : hasActiveFilters ? (
            <>
              <h2 className="mb-2 text-2xl font-bold">
                No matching opportunities found.
              </h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                Try changing your search or filters.
              </p>
              <Button onClick={clearFilters} variant="outline">
                <X className="mr-2 h-4 w-4" />
                Clear Filters
              </Button>
            </>
          ) : (
            <>
              <h2 className="mb-2 text-2xl font-bold">
                No strong matches found.
              </h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                Try these suggestions to find more opportunities:
              </p>
              {applicableSuggestions.length > 0 && (
                <ul className="mb-6 text-left text-sm text-muted-foreground">
                  {applicableSuggestions.map((suggestion, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 text-primary">•</span>
                      {suggestion}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {!playerProfileComplete && (
                  <a href="/player/profile/edit">
                    <Button variant="outline" size="sm">
                      <UserPlus className="mr-2 h-4 w-4" />
                      Complete Profile
                    </Button>
                  </a>
                )}
                <Button onClick={() => updateParams({ minMatch: null })} variant="outline" size="sm">
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Show All Matches
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredResults.map((item) => (
            <RecommendationCard
              key={item.opportunity.id}
              opportunity={item.opportunity}
              matchResult={item.matchResult}
            />
          ))}
        </div>
      )}
    </div>
  );
}