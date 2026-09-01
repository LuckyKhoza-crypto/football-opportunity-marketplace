"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TeamPlayerCard } from "@/components/marketplace/team-player-card";
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
  PREFERRED_FEET,
  PREFERRED_FOOT_LABELS,
} from "@/types";
import type { PlayerProfile, Position, Opportunity } from "@/types";
import type { MatchResult } from "@/lib/matching";
import {
  Search,
  SlidersHorizontal,
  X,
  Users,
  HelpCircle,
} from "lucide-react";

interface RankedPlayer {
  player: PlayerProfile & {
    full_name?: string | null;
    avatar_url?: string | null;
  };
  matchResult: MatchResult;
}

interface TeamPlayerDiscoveryClientProps {
  rankedPlayers: RankedPlayer[];
  totalCount: number;
  opportunityId: string;
  opportunityStatus?: string;
  opportunity?: Partial<Opportunity> | null;
}

const MIN_MATCH_OPTIONS = [
  { value: "0", label: "Any match" },
  { value: "60", label: "60%+" },
  { value: "75", label: "75%+" },
  { value: "90", label: "90%+" },
];

const SORT_OPTIONS = [
  { value: "match", label: "Best Match" },
  { value: "newest", label: "Newest Profile" },
  { value: "age", label: "Age" },
  { value: "location", label: "Location" },
];

const PAGE_SIZE = 20;

export function TeamPlayerDiscoveryClient({
  rankedPlayers,
  totalCount,
  opportunityId,
  opportunity,
}: TeamPlayerDiscoveryClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentPage, setCurrentPage] = useState(0);

  const currentQ = searchParams.get("q") ?? "";
  const currentPosition = searchParams.get("position") ?? "";
  const currentLevel = searchParams.get("level") ?? "";
  const currentLocation = searchParams.get("location") ?? "";
  const currentAvailability = searchParams.get("availability") ?? "";
  const currentFoot = searchParams.get("foot") ?? "";
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
      const base = `/team/opportunities/${opportunityId}/players`;
      router.push(qs ? `${base}?${qs}` : base);
      setCurrentPage(0);
    },
    [router, searchParams, opportunityId],
  );

  const clearFilters = useCallback(() => {
    router.push(`/team/opportunities/${opportunityId}/players`);
    setCurrentPage(0);
  }, [router, opportunityId]);

  const updateFilter = useCallback(
    (key: string, value: string) => {
      updateParams({ [key]: value === "all" ? null : value });
    },
    [updateParams],
  );

  const hasActiveFilters =
    currentPosition ||
    currentLevel ||
    currentLocation ||
    currentAvailability ||
    currentFoot ||
    currentQ ||
    currentMinMatch !== "0";

  // Apply client-side filters and sorting
  const filteredResults = useMemo(() => {
    let results = [...rankedPlayers];

    // Search filter
    const q = currentQ.toLowerCase().trim();
    if (q) {
      results = results.filter((r) => {
        const p = r.player;
        const searchable = [
          p.full_name ?? "",
          p.positions?.join(" ") ?? "",
          p.location ?? "",
          p.previous_clubs?.map((c) => c.name).join(" ") ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return searchable.includes(q);
      });
    }

    // Position filter
    if (currentPosition) {
      results = results.filter(
        (r) => r.player.positions?.includes(currentPosition as Position),
      );
    }

    // Level filter
    if (currentLevel) {
      results = results.filter(
        (r) => r.player.playing_level === currentLevel,
      );
    }

    // Location filter
    if (currentLocation) {
      const loc = currentLocation.toLowerCase().trim();
      results = results.filter(
        (r) => r.player.location?.toLowerCase().includes(loc),
      );
    }

    // Availability filter
    if (currentAvailability) {
      results = results.filter(
        (r) => r.player.availability === currentAvailability,
      );
    }

    // Preferred foot filter
    if (currentFoot) {
      results = results.filter(
        (r) => r.player.preferred_foot === currentFoot,
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
          new Date(b.player.created_at).getTime() -
          new Date(a.player.created_at).getTime(),
      );
    } else if (sort === "age") {
      results.sort((a, b) => {
        const ageA = a.player.date_of_birth
          ? new Date(a.player.date_of_birth).getTime()
          : 0;
        const ageB = b.player.date_of_birth
          ? new Date(b.player.date_of_birth).getTime()
          : 0;
        return ageB - ageA; // younger first
      });
    } else if (sort === "location") {
      results.sort((a, b) => {
        const locA = a.player.location ?? "";
        const locB = b.player.location ?? "";
        return locA.localeCompare(locB);
      });
    } else {
      // Default: Best Match (deterministic with secondary sort by newest)
      results.sort((a, b) => {
        const scoreDiff = b.matchResult.score - a.matchResult.score;
        if (scoreDiff !== 0) return scoreDiff;
        return (
          new Date(b.player.created_at).getTime() -
          new Date(a.player.created_at).getTime()
        );
      });
    }

    return results;
  }, [
    rankedPlayers,
    currentQ,
    currentPosition,
    currentLevel,
    currentLocation,
    currentAvailability,
    currentFoot,
    currentMinMatch,
    currentSort,
  ]);

  // Pagination
  const totalPages = Math.ceil(filteredResults.length / PAGE_SIZE);
  const paginatedResults = filteredResults.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );

  // Collect unique locations for filter
  const locations = useMemo(() => {
    const unique = new Set<string>();
    rankedPlayers.forEach((r) => {
      if (r.player.location) unique.add(r.player.location);
    });
    return Array.from(unique).sort();
  }, [rankedPlayers]);

  // Determine missing opportunity fields
  const missingOppFields = useMemo(() => {
    if (!opportunity) return [];
    const missing: string[] = [];
    if (!opportunity.position) missing.push("Position");
    if (!opportunity.playing_level) missing.push("Playing level");
    if (!opportunity.location) missing.push("Location");
    if (!opportunity.availability) missing.push("Availability");
    if (!opportunity.age_min && !opportunity.age_max) missing.push("Age range");
    if (!opportunity.preferred_foot) missing.push("Preferred foot");
    return missing;
  }, [opportunity]);

  return (
    <div className="space-y-6">
      {/* Opportunity Completeness Notice */}
      {missingOppFields.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
          <div className="flex items-start gap-3">
            <HelpCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
            <div>
              <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                Improve your opportunity
              </h3>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
                Adding requirements can make player matching more accurate:
              </p>
              <ul className="mt-1 space-y-0.5">
                {missingOppFields.map((field) => (
                  <li
                    key={field}
                    className="flex items-center gap-1 text-sm text-blue-700 dark:text-blue-400"
                  >
                    <span className="text-blue-500">•</span>
                    {field}
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <a href={`/team/opportunities/${opportunityId}/edit`}>
                  <Button size="sm" variant="outline">
                    Edit Opportunity
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
          placeholder="Search players by name, position, location, club..."
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

          {/* Location Filter */}
          <Select
            value={currentLocation}
            onValueChange={(v) => updateFilter("location", v)}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {locations.map((loc) => (
                <SelectItem key={loc} value={loc}>
                  {loc}
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

          {/* Preferred Foot Filter */}
          <Select
            value={currentFoot}
            onValueChange={(v) => updateFilter("foot", v)}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Foot" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Both Feet</SelectItem>
              {PREFERRED_FEET.map((foot) => (
                <SelectItem key={foot} value={foot}>
                  {PREFERRED_FOOT_LABELS[foot]}
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
            ? "1 player found"
            : `${filteredResults.length} players found`}
        </p>
        <Select
          value={currentSort}
          onValueChange={(v) => updateParams({ sort: v })}
        >
          <SelectTrigger className="w-[160px]">
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
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          {totalCount === 0 ? (
            <>
              <h2 className="mb-2 text-2xl font-bold">
                No players are currently available.
              </h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                Players with completed profiles will appear here once they
                opt in to discovery.
              </p>
            </>
          ) : hasActiveFilters ? (
            <>
              <h2 className="mb-2 text-2xl font-bold">
                No matching players found.
              </h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                Try lowering your minimum match or removing some filters.
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
                Try lowering your minimum match or selecting a different
                opportunity.
              </p>
              <Button onClick={() => updateParams({ minMatch: null })} variant="outline" size="sm">
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Show All Matches
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paginatedResults.map((item) => (
              <TeamPlayerCard
                key={item.player.id}
                player={item.player}
                matchResult={item.matchResult}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 0}
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                Previous
              </Button>
              <span className="px-4 text-sm text-muted-foreground">
                Page {currentPage + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}