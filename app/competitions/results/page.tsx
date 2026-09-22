import Link from "next/link";
import { Trophy, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPublicCompetitionResults } from "@/lib/competition-public-server";
import { PublicCompetitionResultCard } from "./PublicCompetitionResultCard";

/**
 * COMP-007 — Public competition results dashboard.
 *
 * A deliberately PUBLIC page (no session required, no redirect to /login, and
 * it is listed in the middleware public routes). It shows only the
 * public-safe projection produced by getPublicCompetitionResults — never
 * management controls, participant ids, profiles.id, emails, verification
 * codes/tokens or join tokens.
 */

// Always reflect the latest results; this page is public and cheap to query.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Competition Results | Football Opportunity Marketplace",
  description:
    "Browse football competitions, see who qualified, and who won.",
};

export default async function PublicCompetitionResultsPage() {
  const results = await getPublicCompetitionResults();

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <Link href="/">
            <Button variant="ghost" size="sm" className="mb-4">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Home
            </Button>
          </Link>
          <h1 className="mb-2 text-3xl font-bold">Competitions</h1>
          <p className="text-lg text-muted-foreground">
            Browse competitions, their qualified participants and winners.
          </p>
        </div>

        {results.length > 0 ? (
          <div className="space-y-6">
            {results.map((result, index) => (
              <PublicCompetitionResultCard
                key={`${result.name}-${index}`}
                result={result}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-lg border py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Trophy className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-lg font-semibold">
              No competitions yet
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Competition results will appear here once competitions have been
              created.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}