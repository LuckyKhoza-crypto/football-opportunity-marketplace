import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Suspense } from "react";
import { TeamPlayerBrowseClient } from "./TeamPlayerBrowseClient";
import { ArrowLeft, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { PlayerProfile } from "@/types";

export default async function TeamPlayersBrowsePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const userRoles = session.user.roles as string[] | undefined;
  if (!userRoles?.includes("team")) {
    redirect("/");
  }

  // Fetch profile
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  // Fetch team profile
  const { data: teamProfile } = await supabaseAdmin
    .from("team_profiles")
    .select("*")
    .eq("user_id", profile.id)
    .single();

  if (!teamProfile) {
    redirect("/team/onboarding");
  }

  // Fetch all discoverable players (same base query as opportunity-linked page)
  const { data: playerProfiles, error } = await supabaseAdmin
    .from("player_profiles")
    .select(
      `
      *,
      profile:user_id (
        full_name,
        avatar_url
      )
    `,
    )
    .eq("discoverable", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch player profiles:", error);
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-6xl">
          <ErrorState />
        </div>
      </div>
    );
  }

  // Transform players
  const players = (playerProfiles ?? [])
    .filter((row: Record<string, unknown>) => {
      const rowUserId = row.user_id as string;
      return rowUserId !== profile.id;
    })
    .map((row: Record<string, unknown>) => {
      const player = row as unknown as PlayerProfile & {
        profile?: { full_name: string | null; avatar_url: string | null };
      };
      return {
        ...player,
        full_name: player.profile?.full_name ?? null,
        avatar_url: player.profile?.avatar_url ?? null,
      };
    });

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-6xl">
        {/* Back */}
        <div className="mb-6">
          <Link href="/team/find-players">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Find Players
            </Button>
          </Link>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 className="mb-1 text-3xl font-bold">Browse All Players</h1>
          <p className="text-lg text-muted-foreground">
            {teamProfile.team_name}
            {" — "}
            Discover all players looking for opportunities
          </p>
        </div>

        <Suspense fallback={<PlayersSkeleton />}>
          <TeamPlayerBrowseClient
            players={players}
            totalCount={players.length}
          />
        </Suspense>
      </div>
    </div>
  );
}

function PlayersSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
      <div className="flex flex-wrap gap-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-10 w-32 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-80 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <Users className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="mb-2 text-2xl font-bold">
        Failed to load players.
      </h2>
      <p className="mb-6 max-w-md text-muted-foreground">
        Something went wrong loading player profiles. Please try again.
      </p>
      <Link href="/team/find-players">
        <Button variant="outline">Back to Find Players</Button>
      </Link>
    </div>
  );
}