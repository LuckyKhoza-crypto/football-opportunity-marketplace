"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronDown, Check, Plus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { persistSelectedTeamId } from "@/lib/team-context";

interface TeamSwitcherProps {
  teams: {
    id: string;
    team_name: string;
    logo_url: string | null;
  }[];
  currentTeamId: string | null;
  canCreateTeam: boolean;
}

export function TeamSwitcher({
  teams,
  currentTeamId,
  canCreateTeam,
}: TeamSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentTeam = teams.find((t) => t.id === currentTeamId) ?? teams[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!session?.user || teams.length === 0) return null;

  const switchTeam = (teamId: string) => {
    setOpen(false);
    // Persist the selected team to localStorage
    persistSelectedTeamId(teamId);
    // Preserve the current path but update the team query param
    const params = new URLSearchParams(searchParams.toString());
    params.set("team", teamId);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    router.refresh();
  };

  const goToCreateTeam = () => {
    setOpen(false);
    router.push("/team/onboarding");
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
        aria-label="Switch team"
      >
        {currentTeam?.logo_url ? (
          <img
            src={currentTeam.logo_url}
            alt=""
            className="h-5 w-5 rounded-full object-cover"
          />
        ) : (
          <Users className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="max-w-[120px] truncate">
          {currentTeam?.team_name ?? "Select Team"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border bg-popover p-1 shadow-md">
          <p className="px-3 py-2 text-xs font-medium text-muted-foreground">
            Current Team
          </p>
          <div className="space-y-0.5">
            {teams.map((team) => {
              const isActive = team.id === (currentTeam?.id ?? currentTeamId);
              return (
                <button
                  key={team.id}
                  onClick={() => switchTeam(team.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {team.logo_url ? (
                    <img
                      src={team.logo_url}
                      alt=""
                      className="h-5 w-5 rounded-full object-cover"
                    />
                  ) : (
                    <Users className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate text-left">
                    {team.team_name}
                  </span>
                  {isActive && <Check className="h-4 w-4" />}
                </button>
              );
            })}
          </div>

          {canCreateTeam && (
            <>
              <div className="my-1 border-t" />
              <button
                onClick={goToCreateTeam}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
                Create Team
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}