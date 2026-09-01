"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TeamPlayerBrowseCard } from "@/components/marketplace/team-player-browse-card";
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
import type { PlayerProfile, Position } from "@/types";
import {
  Search,
  SlidersHorizontal,
  X,
  Users,
} from "lucide-react";

interface PlayerWithMeta extends PlayerProfile {
  full_name?: string | null;
  avatar_url?: string | null;
}

interface TeamPlayerBrowseClientProps {
  players: PlayerWithMeta[];
  totalCount: number;
}

const SORT_OPTIONS = [
  { value: "newest", label: "Newest Profile" },
  { value: "age", label: "Age" },
  { value: "location", label: "Location" },
];

const PAGE_SIZE = 20;

export function TeamPlayerBrowseClient({
  players,
  totalCount,
}: TeamPlayerBrowseClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentPage, setCurrentPage] = useState(0);

  const currentQ = searchParams.get("q") ?? "";
  const currentPosition = searchParams.get("position") ?? "";
  const currentLevel = searchParams.get("level") ?? "";
  const currentLocation = searchParams.get("location") ?? "";
  const currentAvailability = searchParams.get("availability") ?? "";
  const currentFoot = searchParams.get("foot") ?? "";
  const currentSort = searchParams.get("sort") ?? "newest";

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
      const base = "/team/players";
      router.push(qs ? `${base}?${qs}` : base);
      setCurrentPage(0);
    },
    [router, searchParams],
  );

  const clearFilters = useCallback(() => {
    router.push("/team/players");
    setCurrentPage(0);
  }, [router]);

  const hasActiveFilters =
    currentPosition ||
    currentLevel ||
    currentLocation ||
    currentAvailability ||
    currentFoot ||
    currentQ;

  // Apply client-side filters and sorting
  const filteredResults = useMemo(() => {
    let results = [...players];

    // Search filter
    const q = currentQ.toLowerCase().trim();
    if (q) {
      results = results.filter((p) => {
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
        (p) => p.positions?.includes(currentPosition as Position),
      );
    }

    // Level filter
    if (currentLevel) {
      results = results.filter(
        (p) => p.playing_level === currentLevel,
      );
    }

    // Location filter
    if (currentLocation) {
      const loc = currentLocation.toLowerCase().trim();
      results = results.filter(
        (p) => p.location?.toLowerCase().includes(loc),
      );
    }

    // Availability filter
    if (currentAvailability) {
      results = results.filter(
        (p) => p.availability === currentAvailability,
      );
    }

    // Preferred foot filter
    if (currentFoot) {
      results = results.filter(
        (p) => p.preferred_foot === currentFoot,
      );
    }

    // Sorting
    const sort = currentSort;
    if (sort === "age") {
      results.sort((a, b) => {
        const ageA = a.date_of_birth
          ? new Date(a.date_of_birth).getTime()
          : 0;
        const ageB = b.date_of_birth
          ? new Date(b.date_of_birth).getTime()
          : 0;
        return ageB - ageA; // younger first
      });
    } else if (sort === "location") {
      results.sort((a, b) => {
        const locA = a.location ?? "";
        const locB = b.location ?? "";
        return locA.localeCompare(locB);
      });
    } else {
      // Default: Newest Profile
      results.sort(
        (a, b) =>
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime(),
      );
    }

    return results;
  }, [
    players,
    currentQ,
    currentPosition,
    currentLevel,
    currentLocation,
    currentAvailability,
    currentFoot,
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
    players.forEach((p) => {
      if (p.location) unique.add(p.location);
    });
    return Array.from(unique).sort();
  }, [players]);

  return (
    <div className="space-y-6">
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
            onValueChange={(v) =>
              updateParams({ position: v === "all" ? null : v })
            }
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
            onValueChange={(v) =>
              updateParams({ level: v === "all" ? null : v })
            }
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
            onValueChange={(v) =>
              updateParams({ location: v === "all" ? null : v })
            }
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
            onValueChange={(v) =>
              updateParams({ availability: v === "all" ? null : v })
            }
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
            onValueChange={(v) =>
              updateParams({ foot: v === "all" ? null : v })
            }
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
          ) : (
            <>
              <h2 className="mb-2 text-2xl font-bold">
                No matching players found.
              </h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                Try removing some filters to see more results.
              </p>
              <Button onClick={clearFilters} variant="outline">
                <X className="mr-2 h-4 w-4" />
                Clear Filters
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paginatedResults.map((player) => (
              <TeamPlayerBrowseCard
                key={player.id}
                player={player}
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