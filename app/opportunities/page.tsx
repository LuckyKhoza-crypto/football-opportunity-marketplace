import { Suspense } from "react";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { OpportunityMarketplace } from "./marketplace-client";
import type { Opportunity } from "@/types";

export const metadata = {
  title: "Find Opportunities | Football Opportunity Marketplace",
  description:
    "Browse active football opportunities. Find your next team.",
};

const PAGE_SIZE = 20;

interface SearchParams {
  q?: string;
  position?: string;
  level?: string;
  league?: string;
  availability?: string;
  sort?: string;
  page?: string;
}

async function getOpportunities(searchParams: SearchParams) {
  let query = supabaseAdmin
    .from("opportunities")
    .select(`
      *,
      team:team_id (
        team_name,
        logo_url,
        location,
        league,
        playing_level
      )
    `, { count: "exact" })
    .eq("status", "active");

  // Search
  const q = searchParams.q?.trim();
  if (q) {
    query = query.or(
      `title.ilike.%${q}%,position.ilike.%${q}%,location.ilike.%${q}%,league.ilike.%${q}%`
    );
  }

  // Filters
  if (searchParams.position) {
    query = query.eq("position", searchParams.position);
  }
  if (searchParams.level) {
    query = query.eq("playing_level", searchParams.level);
  }
  if (searchParams.league) {
    query = query.eq("league", searchParams.league);
  }
  if (searchParams.availability) {
    query = query.eq("availability", searchParams.availability);
  }

  // Sorting
  const sort = searchParams.sort ?? "newest";
  if (sort === "oldest") {
    query = query.order("created_at", { ascending: true });
  } else if (sort === "tryout") {
    query = query.order("tryout_date", { ascending: true, nullsFirst: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  // Pagination
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;

  if (error) {
    console.error("Failed to fetch opportunities:", error);
    return { opportunities: [], totalCount: 0, totalPages: 1, currentPage: 1, error: true };
  }

  const typedData = data as unknown as (Opportunity & {
    team: { team_name: string; logo_url: string | null; location: string | null; league: string | null; playing_level: string | null };
  })[];

  return {
    opportunities: typedData.map((item) => ({
      ...item,
      team_name: item.team?.team_name ?? null,
      team_logo: item.team?.logo_url ?? null,
    })),
    totalCount: count ?? 0,
    totalPages: Math.ceil((count ?? 0) / PAGE_SIZE) || 1,
    currentPage: page,
    error: false,
  };
}

async function getLeagues(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("opportunities")
    .select("league")
    .eq("status", "active")
    .not("league", "is", null)
    .order("league");

  const unique = new Set<string>();
  data?.forEach((r) => {
    if (r.league) unique.add(r.league);
  });
  return Array.from(unique).sort();
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [result, leagues] = await Promise.all([
    getOpportunities(params),
    getLeagues(),
  ]);

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">Find Opportunities</h1>
          <p className="text-lg text-muted-foreground">
            Discover teams looking for players like you
          </p>
        </div>

        <Suspense fallback={<MarketplaceSkeleton />}>
          <OpportunityMarketplace
            opportunities={result.opportunities}
            totalCount={result.totalCount}
            totalPages={result.totalPages}
            currentPage={result.currentPage}
            error={result.error}
            leagues={leagues}
          />
        </Suspense>
      </div>
    </div>
  );
}

function MarketplaceSkeleton() {
  return (
    <div className="space-y-6">
      {/* Search skeleton */}
      <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
      {/* Filters skeleton */}
      <div className="flex flex-wrap gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 w-32 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      {/* Cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}