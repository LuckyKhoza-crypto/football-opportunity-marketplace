"use client";

import { useSearchParams } from "next/navigation";
import { TeamSwitcher } from "@/components/layout/TeamSwitcher";
import { getSelectedTeamIdFromLocalStorage } from "@/lib/team-context";

interface TeamSwitcherWithContextProps {
  teams: {
    id: string;
    team_name: string;
    logo_url: string | null;
  }[];
  canCreateTeam: boolean;
}

/**
 * Reads the `?team=<id>` query param and passes it to TeamSwitcher.
 * This is a separate client component so that useSearchParams() is
 * isolated within a Suspense boundary, avoiding prerender bailouts
 * for pages like /messages, /404, and /_not-found.
 */
export function TeamSwitcherWithContext({
  teams,
  canCreateTeam,
}: TeamSwitcherWithContextProps) {
  const searchParams = useSearchParams();
  const currentTeamId = searchParams.get("team") ?? getSelectedTeamIdFromLocalStorage();

  return (
    <TeamSwitcher
      teams={teams}
      currentTeamId={currentTeamId}
      canCreateTeam={canCreateTeam}
    />
  );
}