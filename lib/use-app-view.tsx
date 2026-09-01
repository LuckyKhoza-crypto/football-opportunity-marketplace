"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { getRouteContext } from "@/lib/route-context";

export type AppView = "player" | "team" | null;

const STORAGE_KEY = "fom-active-view";

interface AppViewContextValue {
  /** The currently active view. Null when no view is available (no roles). */
  view: AppView;
  /** Set the active view. Ignores invalid values. */
  setView: (view: AppView) => void;
  /** True if the user has the player role capability. */
  hasPlayerRole: boolean;
  /** True if the user has the team role capability. */
  hasTeamRole: boolean;
  /** True if the active view is "player". */
  isPlayerView: boolean;
  /** True if the active view is "team". */
  isTeamView: boolean;
  /** The user's roles array from the session. */
  roles: string[];
}

const AppViewContext = createContext<AppViewContextValue>({
  view: null,
  setView: () => {},
  hasPlayerRole: false,
  hasTeamRole: false,
  isPlayerView: false,
  isTeamView: false,
  roles: [],
});

function readPersistedView(): AppView {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "player" || stored === "team") return stored;
  } catch {
    // localStorage may be unavailable
  }
  return null;
}

function persistView(view: AppView) {
  if (typeof window === "undefined") return;
  try {
    if (view === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, view);
    }
  } catch {
    // localStorage may be unavailable
  }
}

export function AppViewProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const roles = (session?.user?.roles as string[] | undefined) ?? [];
  const hasPlayerRole = roles.includes("player");
  const hasTeamRole = roles.includes("team");

  // Determine the default view based on roles
  const getDefaultView = useCallback((): AppView => {
    if (hasPlayerRole && hasTeamRole) {
      // Dual-role: try persisted, fallback to player
      const persisted = readPersistedView();
      if (persisted === "player" || persisted === "team") return persisted;
      return "player";
    }
    if (hasPlayerRole) return "player";
    if (hasTeamRole) return "team";
    return null;
  }, [hasPlayerRole, hasTeamRole]);

  const [view, setViewState] = useState<AppView>(getDefaultView);
  const isInitialMount = useRef(true);

  // Sync view with roles on session change
  useEffect(() => {
    setViewState(getDefaultView());
  }, [getDefaultView]);

  // Persist view changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    persistView(view);
  }, [view]);

  // Auto-sync view when navigating to management routes
  useEffect(() => {
    const routeCtx = getRouteContext(pathname);
    if (routeCtx === "player" && hasPlayerRole && view !== "player") {
      setViewState("player");
    } else if (routeCtx === "team" && hasTeamRole && view !== "team") {
      setViewState("team");
    }
  }, [pathname, hasPlayerRole, hasTeamRole, view]);

  const setView = useCallback(
    (newView: AppView) => {
      if (newView === null) {
        setViewState(null);
        return;
      }
      // Only allow setting a view the user has the role for
      if (newView === "player" && !hasPlayerRole) return;
      if (newView === "team" && !hasTeamRole) return;
      setViewState(newView);
    },
    [hasPlayerRole, hasTeamRole],
  );

  return (
    <AppViewContext.Provider
      value={{
        view,
        setView,
        hasPlayerRole,
        hasTeamRole,
        isPlayerView: view === "player",
        isTeamView: view === "team",
        roles,
      }}
    >
      {children}
    </AppViewContext.Provider>
  );
}

export function useAppView(): AppViewContextValue {
  return useContext(AppViewContext);
}