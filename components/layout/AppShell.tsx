"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useAppView } from "@/lib/use-app-view";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Home", href: "/" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Opportunities", href: "/opportunities" },
];

const playerNavItems = [
  { label: "Player Dashboard", href: "/player" },
  { label: "Find a Team", href: "/player/find-team" },
  { label: "My Profile", href: "/player/profile" },
];

const teamNavItems = [
  { label: "Team Dashboard", href: "/team" },
  { label: "Find Players", href: "/team/find-players" },
  { label: "My Opportunities", href: "/team/opportunities" },
  { label: "Team Profile", href: "/team/profile" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const {
    view,
    setView,
    hasPlayerRole,
    hasTeamRole,
    isPlayerView,
    isTeamView,
  } = useAppView();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  // Close account menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    }
    if (accountMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [accountMenuOpen]);

  const handleSwitchView = (newView: "player" | "team") => {
    setView(newView);
    setAccountMenuOpen(false);
    // Navigate to the corresponding management route
    if (newView === "player") {
      if (hasPlayerRole) {
        router.push("/player");
      } else {
        router.push("/onboarding");
      }
    } else {
      if (hasTeamRole) {
        router.push("/team");
      } else {
        router.push("/onboarding");
      }
    }
  };

  // Determine which nav items to show based on active view
  const showPlayerNav = isPlayerView;
  const showTeamNav = isTeamView;

  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <span className="text-sm font-bold text-primary-foreground">
                ⚽
              </span>
            </div>
            <span className="hidden font-bold text-foreground sm:inline-block">
              Football Opportunity Marketplace
            </span>
            <span className="font-bold text-foreground sm:hidden">FOM</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-6 md:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-primary",
                  pathname === item.href
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
            {showPlayerNav &&
              playerNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "text-sm font-medium transition-colors hover:text-primary",
                    pathname === item.href
                      ? "text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            {showTeamNav &&
              teamNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "text-sm font-medium transition-colors hover:text-primary",
                    pathname === item.href
                      ? "text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
          </nav>

          {/* Auth Area */}
          <div className="flex items-center gap-2">
            {session?.user ? (
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                  className="flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-accent"
                  aria-label="Account menu"
                >
                  {session.user.image ? (
                    <img
                      src={session.user.image}
                      alt=""
                      className="h-8 w-8 rounded-full"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                      {session.user.name?.charAt(0)?.toUpperCase() ?? "?"}
                    </div>
                  )}
                </button>

                {/* Account Dropdown Menu */}
                {accountMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border bg-popover p-1 shadow-md">
                    {/* User info header */}
                    <div className="px-3 py-2">
                      <p className="text-sm font-medium">
                        {session.user.name ?? "User"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {session.user.email}
                      </p>
                    </div>

                    <div className="border-t" />

                    {/* View switcher — always show both options */}
                    <button
                      onClick={() => handleSwitchView("player")}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                        isPlayerView
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <span>⚽</span>
                      <span className="flex-1 text-left">Player View</span>
                      {isPlayerView && <span className="text-xs">✓</span>}
                    </button>

                    <button
                      onClick={() => handleSwitchView("team")}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                        isTeamView
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <span>🏟️</span>
                      <span className="flex-1 text-left">Team View</span>
                      {isTeamView && <span className="text-xs">✓</span>}
                    </button>

                    <div className="border-t mt-1 pt-1" />

                    {/* Log Out */}
                    <button
                      onClick={() => {
                        setAccountMenuOpen(false);
                        signOut({ callbackUrl: "/" });
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      Log Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" size="sm">
                    Log In
                  </Button>
                </Link>
                <Link href="/login">
                  <Button size="sm">Sign Up</Button>
                </Link>
              </>
            )}

            {/* Mobile Menu Toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="4" x2="20" y1="12" y2="12" />
                  <line x1="4" x2="20" y1="6" y2="6" />
                  <line x1="4" x2="20" y1="18" y2="18" />
                </svg>
              )}
            </Button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <nav className="border-t md:hidden">
            <div className="container mx-auto space-y-1 px-4 pb-3 pt-2">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "block rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-primary",
                    pathname === item.href
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {item.label}
                </Link>
              ))}
              {showPlayerNav &&
                playerNavItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "block rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-primary",
                      pathname === item.href
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              {showTeamNav &&
                teamNavItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "block rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-primary",
                      pathname === item.href
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {item.label}
                  </Link>
                ))}

              {/* Mobile account section */}
              {session?.user && (
                <>
                  <div className="border-t my-2" />
                  <div className="px-3 py-1">
                    <p className="text-sm font-medium">
                      {session.user.name ?? "User"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {session.user.email}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      handleSwitchView("player");
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                      isPlayerView
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <span>⚽</span>
                    <span className="flex-1 text-left">Player View</span>
                    {isPlayerView && <span className="text-xs">✓</span>}
                  </button>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      handleSwitchView("team");
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                      isTeamView
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <span>🏟️</span>
                    <span className="flex-1 text-left">Team View</span>
                    {isTeamView && <span className="text-xs">✓</span>}
                  </button>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      signOut({ callbackUrl: "/" });
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
                  >
                    Log Out
                  </button>
                </>
              )}
            </div>
          </nav>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t py-6">
        <div className="container mx-auto px-4">
          <p className="text-center text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Football Opportunity Marketplace.
            All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}