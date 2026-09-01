import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import {
  type Opportunity,
} from "@/types";
import { Plus, Swords } from "lucide-react";
import { OpportunityCard, EmptyState } from "./OpportunityCardClient";

export default async function TeamOpportunitiesPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  const { data: teamProfile } = await supabaseAdmin
    .from("team_profiles")
    .select("*")
    .eq("user_id", profile.id)
    .single();

  if (!teamProfile) {
    redirect("/team/onboarding");
  }

  const { data: opportunities } = await supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("team_id", teamProfile.id)
    .order("created_at", { ascending: false });

  const typedOpps = (opportunities ?? []) as unknown as Opportunity[];

  const active = typedOpps.filter((o) => o.status === "active");
  const drafts = typedOpps.filter((o) => o.status === "draft");
  const closed = typedOpps.filter((o) => o.status === "closed");

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold">Your Opportunities</h1>
            <p className="text-lg text-muted-foreground">
              Manage your team opportunities
            </p>
          </div>
          <Link href="/team/opportunities/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Post an Opportunity
            </Button>
          </Link>
        </div>

        {/* Summary Cards */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                {active.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Drafts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">
                {drafts.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Closed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-gray-600 dark:text-gray-400">
                {closed.length}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Active Opportunities */}
        {active.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-xl font-semibold">Active</h2>
            <div className="space-y-4">
              {active.map((opp) => (
                <OpportunityCard key={opp.id} opportunity={opp} />
              ))}
            </div>
          </section>
        )}

        {active.length === 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-xl font-semibold">Active</h2>
            <EmptyState status="active" />
          </section>
        )}

        {/* Drafts */}
        {drafts.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-xl font-semibold">Drafts</h2>
            <div className="space-y-4">
              {drafts.map((opp) => (
                <OpportunityCard key={opp.id} opportunity={opp} />
              ))}
            </div>
          </section>
        )}

        {drafts.length === 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-xl font-semibold">Drafts</h2>
            <EmptyState status="draft" />
          </section>
        )}

        {/* Closed */}
        {closed.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-xl font-semibold">Closed</h2>
            <div className="space-y-4">
              {closed.map((opp) => (
                <OpportunityCard key={opp.id} opportunity={opp} />
              ))}
            </div>
          </section>
        )}

        {closed.length === 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-xl font-semibold">Closed</h2>
            <EmptyState status="closed" />
          </section>
        )}

        {/* Global Empty State */}
        {typedOpps.length === 0 && (
          <Card className="mt-8">
            <CardContent className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Swords className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="mb-2 text-2xl font-bold">
                No opportunities yet
              </h2>
              <p className="mb-6 max-w-md text-muted-foreground">
                Tell players what your team is looking for. Post an opportunity
                to describe exactly who you need.
              </p>
              <Link href="/team/opportunities/new">
                <Button size="lg">
                  <Plus className="mr-2 h-5 w-5" />
                  Post Your First Opportunity
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}