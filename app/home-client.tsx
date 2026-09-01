"use client";

import Link from "next/link";
import { useAppView } from "@/lib/use-app-view";
import { OpportunityCard } from "@/components/marketplace/opportunity-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MapPin,
  Target,
  Users,
  ArrowRight,
  UserPlus,
  Swords,
  Search,
  Plus,
  Sparkles,
  Building2,
  User,
  Shield,
  ChevronRight,
  FileText,
} from "lucide-react";
import { POSITION_LABELS, PLAYING_LEVEL_LABELS } from "@/types";

// ─── Types ──────────────────────────────────────────────────────

interface OpportunityData {
  id: string;
  title: string;
  position: string | null;
  playing_level: string | null;
  league: string | null;
  location: string | null;
  compensation: string | null;
  tryout_date: string | null;
  role: string | null;
  team_name: string | null;
  team_logo: string | null;
  created_at: string;
  status: string;
  team_id: string;
}

interface RecommendationData extends OpportunityData {
  matchScore?: number;
  matchClassification?: string;
}

interface TeamPlayerRecommendation {
  id: string;
  full_name: string | null;
  positions: string[];
  location: string | null;
  playing_level: string | null;
  matchScore: number;
  matchClassification: string;
}

interface HomeClientProps {
  isAuthenticated: boolean;
  userRoles: string[];
  profileName: string | null;
  hasPlayerProfile: boolean;
  hasTeamProfile: boolean;
  latestOpportunities: OpportunityData[];
  playerRecommendations: RecommendationData[];
  teamPlayerRecommendations: TeamPlayerRecommendation[];
}

// ─── Helpers ────────────────────────────────────────────────────

function getPositionLabel(pos: string | null): string {
  if (!pos) return "Any Position";
  return POSITION_LABELS[pos] ?? pos;
}

function getLevelLabel(level: string | null): string {
  if (!level) return "";
  return PLAYING_LEVEL_LABELS[level as keyof typeof PLAYING_LEVEL_LABELS] ?? level;
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  excellent: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  strong: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  possible: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  weak: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  poor: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  excellent: "Excellent Match",
  strong: "Strong Match",
  possible: "Possible Match",
  weak: "Weak Match",
  poor: "Poor Match",
};

// ─── Section Components ─────────────────────────────────────────

function HeroSection({ isAuthenticated, userRoles, profileName }: {
  isAuthenticated: boolean;
  userRoles: string[];
  profileName: string | null;
}) {
  const hasPlayer = userRoles.includes("player");
  const hasTeam = userRoles.includes("team");

  if (!isAuthenticated) {
    return (
      <section className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary/5 via-primary/10 to-background border px-6 py-16 md:px-12 md:py-24">
        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
            <Sparkles className="mr-1.5 h-4 w-4" />
            Two-Sided Football Marketplace
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Find Your{" "}
            <span className="text-primary">Next Football Opportunity</span>
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
            The marketplace connecting football players with teams. Create your
            profile, discover opportunities, and take the next step in your
            football journey.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/login">
              <Button size="lg" className="min-w-[200px]">
                Get Started
              </Button>
            </Link>
            <Link href="/opportunities">
              <Button variant="outline" size="lg" className="min-w-[200px]">
                Browse Opportunities
              </Button>
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome{profileName ? `, ${profileName}` : ""}
        </h1>
        <p className="text-lg text-muted-foreground">
          {hasPlayer && hasTeam
            ? "Switch between Player and Team views to manage your marketplace experience."
            : hasPlayer
              ? "Find your next team and manage your football career."
              : "Find talent and manage your team's opportunities."}
        </p>
      </div>
    </section>
  );
}

function MarketplaceCards({ isAuthenticated, userRoles }: {
  isAuthenticated: boolean;
  userRoles: string[];
}) {
  const hasPlayer = userRoles.includes("player");
  const hasTeam = userRoles.includes("team");

  if (isAuthenticated && hasPlayer && hasTeam) {
    return null; // Dual-role users get the view switcher instead
  }

  return (
    <section className="mb-12 grid gap-6 md:grid-cols-2">
      {/* For Players Card */}
      <Card className="relative overflow-hidden transition-shadow hover:shadow-lg">
        <div className="absolute right-0 top-0 h-32 w-32 translate-x-8 -translate-y-8 rounded-full bg-primary/5" />
        <CardHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <User className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">For Players</CardTitle>
          <CardDescription>
            Find your next team and take your career to the next level
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              Find teams looking for your position
            </li>
            <li className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              Discover opportunities matched to your profile
            </li>
            <li className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              Get matched based on your skills and preferences
            </li>
            <li className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              Track your applications in one place
            </li>
          </ul>
          <Link href={isAuthenticated && hasPlayer ? "/player/find-team" : "/login"}>
            <Button className="w-full" size="lg">
              <Target className="mr-2 h-4 w-4" />
              Find a Team
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* For Teams Card */}
      <Card className="relative overflow-hidden transition-shadow hover:shadow-lg">
        <div className="absolute right-0 top-0 h-32 w-32 translate-x-8 -translate-y-8 rounded-full bg-primary/5" />
        <CardHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">For Teams</CardTitle>
          <CardDescription>
            Find the talent your team needs to succeed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              Find players matching your requirements
            </li>
            <li className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              Post opportunities and attract top talent
            </li>
            <li className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              Discover matching players automatically
            </li>
            <li className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              Manage applications efficiently
            </li>
          </ul>
          <Link href={isAuthenticated && hasTeam ? "/team/find-players" : "/login"}>
            <Button className="w-full" size="lg">
              <Search className="mr-2 h-4 w-4" />
              Find Players
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}

function DualRoleViewSwitcher() {
  const { setView, isPlayerView, isTeamView } = useAppView();

  return (
    <section className="mb-8">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Marketplace View</h2>
              <p className="text-sm text-muted-foreground">
                Switch between Player and Team views
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant={isPlayerView ? "default" : "outline"}
                onClick={() => setView("player")}
                className="min-w-[140px]"
              >
                <User className="mr-2 h-4 w-4" />
                Player View
              </Button>
              <Button
                variant={isTeamView ? "default" : "outline"}
                onClick={() => setView("team")}
                className="min-w-[140px]"
              >
                <Building2 className="mr-2 h-4 w-4" />
                Team View
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function LatestOpportunitiesSection({ opportunities }: { opportunities: OpportunityData[] }) {
  if (opportunities.length === 0) {
    return (
      <section className="mb-12">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Latest Opportunities</h2>
          <p className="text-muted-foreground">Discover teams looking for players</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Swords className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">No opportunities available right now</h3>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">
              There aren&apos;t any active opportunities at the moment. Check back later or browse teams directly.
            </p>
            <Link href="/teams">
              <Button variant="outline" size="sm">
                Browse Teams
              </Button>
            </Link>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mb-12">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Latest Opportunities</h2>
          <p className="text-muted-foreground">Discover teams looking for players</p>
        </div>
        <Link href="/opportunities">
          <Button variant="outline" size="sm">
            View All Opportunities
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {opportunities.map((opp) => (
          <OpportunityCard
            key={opp.id}
            opportunity={opp as unknown as import("@/types").Opportunity}
            teamName={opp.team_name ?? undefined}
            teamLogo={opp.team_logo}
          />
        ))}
      </div>
    </section>
  );
}

function PlayerRecommendationsSection({
  recommendations,
  hasPlayerProfile,
}: {
  recommendations: RecommendationData[];
  hasPlayerProfile: boolean;
}) {
  if (!hasPlayerProfile) {
    return (
      <section className="mb-12">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Recommended for You</h2>
          <p className="text-muted-foreground">Personalized opportunity matches</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <UserPlus className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Complete your player profile to get better matches</h3>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">
              Add your positions, playing level, and preferences so we can find the best opportunities for you.
            </p>
            <Link href="/player/profile/edit">
              <Button size="sm">
                <UserPlus className="mr-2 h-4 w-4" />
                Complete Profile
              </Button>
            </Link>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (recommendations.length === 0) {
    return (
      <section className="mb-12">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Recommended for You</h2>
          <p className="text-muted-foreground">Personalized opportunity matches</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Swords className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">No matching opportunities yet</h3>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">
              There aren&apos;t any opportunities matching your profile right now. Check back later or browse all opportunities.
            </p>
            <Link href="/opportunities">
              <Button variant="outline" size="sm">
                Browse All Opportunities
              </Button>
            </Link>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mb-12">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Recommended for You</h2>
          <p className="text-muted-foreground">Personalized opportunity matches based on your profile</p>
        </div>
        <Link href="/player/find-team">
          <Button variant="outline" size="sm">
            Find a Team
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {recommendations.map((rec) => (
          <Link
            key={rec.id}
            href={`/opportunities/${rec.id}`}
            className="group block"
          >
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-primary">
                        {rec.matchScore}% Match
                      </span>
                      {rec.matchClassification && (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          CLASSIFICATION_COLORS[rec.matchClassification] ?? "bg-muted text-muted-foreground"
                        }`}>
                          {CLASSIFICATION_LABELS[rec.matchClassification] ?? rec.matchClassification}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1 font-semibold">{rec.title}</h3>
                    <p className="text-sm text-muted-foreground">{rec.team_name ?? "Unknown Team"}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        {getPositionLabel(rec.position)}
                      </span>
                      {rec.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {rec.location}
                        </span>
                      )}
                      {rec.playing_level && (
                        <span>{getLevelLabel(rec.playing_level)}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

function TeamPlayerRecommendationsSection({
  recommendations,
  hasTeamProfile,
}: {
  recommendations: TeamPlayerRecommendation[];
  hasTeamProfile: boolean;
}) {
  if (!hasTeamProfile) {
    return (
      <section className="mb-12">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Players You May Be Looking For</h2>
          <p className="text-muted-foreground">Discover talent for your team</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Building2 className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Complete your team profile to find players</h3>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">
              Set up your team profile and post opportunities to start discovering players.
            </p>
            <Link href="/team/profile/edit">
              <Button size="sm">
                <Building2 className="mr-2 h-4 w-4" />
                Complete Team Profile
              </Button>
            </Link>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (recommendations.length === 0) {
    return (
      <section className="mb-12">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Players You May Be Looking For</h2>
          <p className="text-muted-foreground">Discover talent for your team</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">No matching players found yet</h3>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">
              Post an opportunity to attract players that match your requirements.
            </p>
            <Link href="/team/opportunities/new">
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Post an Opportunity
              </Button>
            </Link>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mb-12">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Players You May Be Looking For</h2>
          <p className="text-muted-foreground">Discover talent matching your requirements</p>
        </div>
        <Link href="/team/find-players">
          <Button variant="outline" size="sm">
            Find More Players
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {recommendations.map((rec) => (
          <Link
            key={rec.id}
            href={`/players/${rec.id}`}
            className="group block"
          >
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-primary">
                        {rec.matchScore}% Match
                      </span>
                      {rec.matchClassification && (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          CLASSIFICATION_COLORS[rec.matchClassification] ?? "bg-muted text-muted-foreground"
                        }`}>
                          {CLASSIFICATION_LABELS[rec.matchClassification] ?? rec.matchClassification}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1 font-semibold">
                      {rec.full_name ?? "Player"}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {rec.positions.length > 0 && (
                        <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">
                          {rec.positions.map((p) => POSITION_LABELS[p] ?? p).join(" / ")}
                        </span>
                      )}
                      {rec.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {rec.location}
                        </span>
                      )}
                      {rec.playing_level && (
                        <span>{getLevelLabel(rec.playing_level)}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

function TeamActionsSection({ hasTeamProfile }: { hasTeamProfile: boolean }) {
  if (!hasTeamProfile) return null;

  return (
    <section className="mb-12">
      <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
        <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">Post an Opportunity</h2>
            <p className="text-sm text-muted-foreground">
              Attract the best players by creating a new opportunity
            </p>
          </div>
          <Link href="/team/opportunities/new">
            <Button size="lg" className="min-w-[200px]">
              <Plus className="mr-2 h-4 w-4" />
              Post an Opportunity
            </Button>
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}

function QuickLinks({ isAuthenticated, userRoles }: {
  isAuthenticated: boolean;
  userRoles: string[];
}) {
  const hasPlayer = userRoles.includes("player");
  const hasTeam = userRoles.includes("team");

  if (!isAuthenticated) return null;

  return (
    <section className="mb-12">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {hasPlayer && (
          <>
            <Link href="/player/find-team">
              <Card className="transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Target className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">Find a Team</p>
                    <p className="text-xs text-muted-foreground">Discover opportunities</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/player/applications">
              <Card className="transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">Applications</p>
                    <p className="text-xs text-muted-foreground">Track your applications</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/player/profile">
              <Card className="transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">My Profile</p>
                    <p className="text-xs text-muted-foreground">View and edit your profile</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </>
        )}
        {hasTeam && (
          <>
            <Link href="/team/find-players">
              <Card className="transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Search className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">Find Players</p>
                    <p className="text-xs text-muted-foreground">Discover talent</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/team/opportunities">
              <Card className="transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Swords className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">My Opportunities</p>
                    <p className="text-xs text-muted-foreground">Manage postings</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/team/applications">
              <Card className="transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">Applications</p>
                    <p className="text-xs text-muted-foreground">Review applicants</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/team/profile">
              <Card className="transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">Team Profile</p>
                    <p className="text-xs text-muted-foreground">Manage team info</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </>
        )}
      </div>
    </section>
  );
}


// ─── Main Component ─────────────────────────────────────────────

export function HomeClient({
  isAuthenticated,
  userRoles,
  profileName,
  hasPlayerProfile,
  hasTeamProfile,
  latestOpportunities,
  playerRecommendations,
  teamPlayerRecommendations,
}: HomeClientProps) {
  const { isPlayerView, isTeamView } = useAppView();
  const hasPlayer = userRoles.includes("player");
  const hasTeam = userRoles.includes("team");
  const isDualRole = hasPlayer && hasTeam;

  // Determine which sections to show based on view
  const showPlayerContent = !isAuthenticated || (isDualRole ? isPlayerView : hasPlayer);
  const showTeamContent = !isAuthenticated || (isDualRole ? isTeamView : hasTeam);

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="mx-auto max-w-6xl">
        {/* Hero Section */}
        <HeroSection
          isAuthenticated={isAuthenticated}
          userRoles={userRoles}
          profileName={profileName}
        />

        {/* Dual-role view switcher */}
        {isAuthenticated && isDualRole && <DualRoleViewSwitcher />}

        {/* Marketplace Cards (logged-out or single-role) */}
        {(!isAuthenticated || !isDualRole) && (
          <MarketplaceCards
            isAuthenticated={isAuthenticated}
            userRoles={userRoles}
          />
        )}

        {/* Quick Links for authenticated users */}
        {isAuthenticated && <QuickLinks isAuthenticated={isAuthenticated} userRoles={userRoles} />}

        {/* Player-specific sections */}
        {showPlayerContent && (
          <>
            <PlayerRecommendationsSection
              recommendations={playerRecommendations}
              hasPlayerProfile={hasPlayerProfile}
            />
          </>
        )}

        {/* Team-specific sections */}
        {showTeamContent && (
          <>
            <TeamActionsSection hasTeamProfile={hasTeamProfile} />
            <TeamPlayerRecommendationsSection
              recommendations={teamPlayerRecommendations}
              hasTeamProfile={hasTeamProfile}
            />
          </>
        )}

        {/* Latest Opportunities — shown to everyone */}
        <LatestOpportunitiesSection opportunities={latestOpportunities} />

        {/* Logged-out: How it works section */}
        {!isAuthenticated && (
          <section className="mb-12">
            <div className="mb-6 text-center">
              <h2 className="text-2xl font-bold">How It Works</h2>
              <p className="text-muted-foreground">Simple steps to find or fill your next opportunity</p>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              <Card className="text-center">
                <CardContent className="p-6">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 font-semibold">1. Create Your Profile</h3>
                  <p className="text-sm text-muted-foreground">
                    Sign up and build your player or team profile with your key information.
                  </p>
                </CardContent>
              </Card>
              <Card className="text-center">
                <CardContent className="p-6">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <Search className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 font-semibold">2. Discover Matches</h3>
                  <p className="text-sm text-muted-foreground">
                    Browse opportunities or search for players using smart matching.
                  </p>
                </CardContent>
              </Card>
              <Card className="text-center">
                <CardContent className="p-6">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <Shield className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 font-semibold">3. Connect & Apply</h3>
                  <p className="text-sm text-muted-foreground">
                    Apply to opportunities or review applicants and take the next step.
                  </p>
                </CardContent>
              </Card>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}