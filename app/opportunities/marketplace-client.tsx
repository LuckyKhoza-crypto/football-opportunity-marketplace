"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OpportunityCard } from "@/components/marketplace/opportunity-card";
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
import { Search, SlidersHorizontal, X, ChevronLeft, ChevronRight, Swords } from "lucide-react";

interface MarketplaceOpportunity {
  id: string;
  title: string;
  position: string | null;
  playing_level: string | null;
  league: string | null;
  location: string | null;
  availability: string | null;
  compensation: string | null;
  tryout_date: string | null;
  role: string | null;
  team_name: string | null;
  team_logo: string | null;
  created_at: string;
  status: string;
  team_id: string;
}

interface OpportunityMarketplaceProps {
  opportunities: MarketplaceOpportunity[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  error: boolean;
  leagues: string[];
}

export function OpportunityMarketplace({
  opportunities,
  totalCount,
  totalPages,
  currentPage,
  error,
  leagues,
}: OpportunityMarketplaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentQ = searchParams.get("q") ?? "";
  const currentPosition = searchParams.get("position") ?? "";
  const currentLevel = searchParams.get("level") ?? "";
  const currentLeague = searchParams.get("league") ?? "";
  const currentAvailability = searchParams.get("availability") ?? "";
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
      // Reset to page 1 when filters change
      if (!("page" in updates)) {
        params.delete("page");
      }
      const qs = params.toString();
      router.push(qs ? `/opportunities?${qs}` : "/opportunities");
    },
    [router, searchParams]
  );

  const clearFilters = useCallback(() => {
    router.push("/opportunities");
  }, [router]);

  const hasActiveFilters =
    currentPosition || currentLevel || currentLeague || currentAvailability || currentQ;

  // Filter out draft/closed on server side already, but also ensure we never render them
  const safeOpportunities = opportunities.filter((o) => o.status === "active");

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center py-24 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <Swords className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="mb-2 text-2xl font-bold">Something went wrong</h2>
        <p className="mb-6 max-w-md text-muted-foreground">
          We couldn't load opportunities right now. Please try again.
        </p>
        <Button onClick={() => router.refresh()}>Try Again</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
            onValueChange={(v) => updateParams({ position: v === "all" ? null : v })}
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
            onValueChange={(v) => updateParams({ level: v === "all" ? null : v })}
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
            onValueChange={(v) => updateParams({ league: v === "all" ? null : v })}
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
            onValueChange={(v) => updateParams({ availability: v === "all" ? null : v })}
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
          {totalCount} {totalCount === 1 ? "opportunity" : "opportunities"} found
        </p>
        <Select
          value={currentSort}
          onValueChange={(v) => updateParams({ sort: v })}
        >
          <SelectTrigger className="w-[130px]">
            <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="tryout">Tryout Date</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Opportunity Cards */}
      {safeOpportunities.length === 0 ? (
        <div className="flex flex-col items-center py-24 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Swords className="h-8 w-8 text-muted-foreground" />
          </div>
          {hasActiveFilters ? (
            <>
              <h2 className="mb-2 text-2xl font-bold">No opportunities found</h2>
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
              <h2 className="mb-2 text-2xl font-bold">No opportunities yet</h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                There aren't any active opportunities right now.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {safeOpportunities.map((opp) => (
            <OpportunityCard
              key={opp.id}
              opportunity={opp as any}
              teamName={opp.team_name ?? undefined}
              teamLogo={opp.team_logo}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => updateParams({ page: String(currentPage - 1) })}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>

          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => {
                // Show first, last, and pages around current
                return (
                  p === 1 ||
                  p === totalPages ||
                  Math.abs(p - currentPage) <= 1
                );
              })
              .map((p, idx, arr) => (
                <span key={p} className="flex items-center">
                  {idx > 0 && arr[idx - 1] !== p - 1 && (
                    <span className="px-1 text-muted-foreground">...</span>
                  )}
                  <Button
                    variant={p === currentPage ? "default" : "outline"}
                    size="sm"
                    className="min-w-[36px]"
                    onClick={() => updateParams({ page: String(p) })}
                  >
                    {p}
                  </Button>
                </span>
              ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => updateParams({ page: String(currentPage + 1) })}
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}