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
  excellent: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  strong: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
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

  // For logged-out users, link directly to discovery routes (they redirect to /login if needed)
  // For authenticated users, link to role-appropriate routes
  const playerCtaHref = !isAuthenticated || hasPlayer ? "/player/find-team" : "/login";
  const teamCtaHref = !isAuthenticated || hasTeam ? "/team/find-players" : "/login";

  const showPlayerCta = !isAuthenticated || hasPlayer;
  const showTeamCta = !isAuthenticated || hasTeam;

  return (
    <section className="relative mb-8 overflow-hidden">
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/images/fom-home-page-im-1.png')" }}
        aria-hidden="true"
      />
      {/* Readability overlay — subtle so the football image remains visible */}
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60" />

      <div className="relative z-10 mx-auto flex min-h-[60vh] max-w-4xl flex-col items-center justify-center px-6 py-24 text-center md:min-h-[70vh] md:px-12 md:py-32">
        {!isAuthenticated ? (
          <>
            <div className="mb-6 inline-flex items-center rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
              <Sparkles className="mr-1.5 h-4 w-4" />
              Two-Sided Football Marketplace
            </div>
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              Find Your{" "}
              <span className="text-primary">Next Football Opportunity</span>
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-white/90">
              Find a team for your next opportunity, or find the player your team needs.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href={playerCtaHref}>
                <Button size="lg" className="min-w-[200px]">
                  <Target className="mr-2 h-4 w-4" />
                  Find a Team
                </Button>
              </Link>
              <Link href={teamCtaHref}>
                <Button size="lg" variant="outline" className="min-w-[200px] border-white/60 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                  <Search className="mr-2 h-4 w-4" />
                  Find a Player
                </Button>
              </Link>
            </div>
            <div className="mt-6">
              <Link href="/login" className="text-sm font-medium text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline">
                Get Started
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Welcome{profileName ? `, ${profileName}` : ""}
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-white/90">
              {hasPlayer && hasTeam
                ? "Switch between Player and Team views to manage your marketplace experience."
                : hasPlayer
                  ? "Find your next team and manage your football career."
                  : "Find talent and manage your team's opportunities."}
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              {showPlayerCta && (
                <Link href={playerCtaHref}>
                  <Button size="lg" className="min-w-[200px]">
                    <Target className="mr-2 h-4 w-4" />
                    Find a Team
                  </Button>
                </Link>
              )}
              {showTeamCta && (
                <Link href={teamCtaHref}>
                  <Button size="lg" variant="outline" className="min-w-[200px] border-white/60 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                    <Search className="mr-2 h-4 w-4" />
                    Find a Player
                  </Button>
                </Link>
              )}
            </div>
          </>
        )}
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
    <section className="mb-12 grid justify-center gap-6 md:grid-cols-2">
      {/* For Players Card */}
      <Card className="relative overflow-hidden text-center transition-shadow hover:shadow-lg">
        {/* Full-card background image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/home-page-for-players-im.jpg')" }}
          aria-hidden="true"
        />
        {/* Readability overlay */}
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 flex h-full flex-col p-6">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-white/10">
              <User className="h-6 w-6 text-white" />
            </div>
            <CardTitle className="text-xl text-orange-400">For Players</CardTitle>
            <CardDescription className="text-white/90">
              Find your next team and take your career to the next level
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2 text-sm text-white/90">
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-white" />
                Find teams looking for your position
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-white" />
                Discover opportunities matched to your profile
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-white" />
                Get matched based on your skills and preferences
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-white" />
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
        </div>
      </Card>

      {/* For Teams Card */}
      <Card className="relative overflow-hidden text-center transition-shadow hover:shadow-lg">
        {/* Full-card background image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/home-page-for-teams-im.jpg')" }}
          aria-hidden="true"
        />
        {/* Readability overlay */}
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 flex h-full flex-col p-6">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-white/10">
              <Building2 className="h-6 w-6 text-white" />
            </div>
            <CardTitle className="text-xl text-orange-400">For Teams</CardTitle>
            <CardDescription className="text-white/90">
              Find the talent your team needs to succeed
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2 text-sm text-white/90">
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-white" />
                Find players matching your requirements
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-white" />
                Post opportunities and attract top talent
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-white" />
                Discover matching players automatically
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-white" />
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
        </div>
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
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between">
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

function LatestOpportunitiesSection({ opportunities, isAuthenticated }: { opportunities: OpportunityData[]; isAuthenticated: boolean }) {
  if (opportunities.length === 0) {
    return (
      <section className="mb-12">
        <div className="mb-6 text-center">
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
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold">Latest Opportunities</h2>
        <p className="text-muted-foreground">Discover teams looking for players</p>
        {!isAuthenticated && (
          <div className="mt-3 flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
              <Swords className="h-4 w-4" />
              100+ Opportunities
            </span>
          </div>
        )}
      </div>
      <div className="grid justify-center gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {opportunities.map((opp) => (
          <OpportunityCard
            key={opp.id}
            opportunity={opp as unknown as import("@/types").Opportunity}
            teamName={opp.team_name ?? undefined}
            teamLogo={opp.team_logo}
          />
        ))}
      </div>
      <div className="mt-6 flex justify-center">
        <Link href="/opportunities">
          <Button variant="outline" size="sm">
            View All Opportunities
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </div>
    </section>
  );
}

function LatestPlayersSection({
  recommendations,
  hasTeamProfile,
}: {
  recommendations: TeamPlayerRecommendation[];
  hasTeamProfile: boolean;
}) {
  if (!hasTeamProfile) {
    return (
      <section className="mb-12">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold">Latest Players</h2>
          <p className="text-muted-foreground">Discover players looking for teams</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Users className="h-6 w-6 text-muted-foreground" />
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
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold">Latest Players</h2>
          <p className="text-muted-foreground">Discover players looking for teams</p>
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
      <div className="mb-6 flex flex-col items-center gap-4 text-center">
        <div>
          <h2 className="text-2xl font-bold">Latest Players</h2>
          <p className="text-muted-foreground">Discover players looking for teams</p>
        </div>
        <Link href="/team/find-players">
          <Button variant="outline" size="sm">
            View All Players
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </div>
      <div className="grid justify-center gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {recommendations.map((rec) => (
          <Link
            key={rec.id}
            href={`/players/${rec.id}`}
            className="group block"
          >
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="p-6">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                      <User className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {rec.full_name ?? "Player"}
                      </p>
                      {rec.playing_level && (
                        <p className="text-xs text-muted-foreground">
                          {getLevelLabel(rec.playing_level)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {rec.positions.length > 0 && (
                        <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          {rec.positions.map((p) => POSITION_LABELS[p] ?? p).join(" / ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {rec.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {rec.location}
                      </span>
                    )}
                  </div>
                  <div className="pt-1">
                    <Button variant="outline" size="sm" className="group">
                      View Player
                      <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

function LatestSection({
  view,
  opportunities,
  teamPlayerRecommendations,
  hasTeamProfile,
  isAuthenticated,
}: {
  view: "player" | "team" | null;
  opportunities: OpportunityData[];
  teamPlayerRecommendations: TeamPlayerRecommendation[];
  hasTeamProfile: boolean;
  isAuthenticated: boolean;
}) {
  if (view === "team") {
    return (
      <LatestPlayersSection
        recommendations={teamPlayerRecommendations}
        hasTeamProfile={hasTeamProfile}
      />
    );
  }
  return <LatestOpportunitiesSection opportunities={opportunities} isAuthenticated={isAuthenticated} />;
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
        <div className="mb-6 text-center">
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
        <div className="mb-6 text-center">
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
      <div className="mb-6 flex flex-col items-center gap-4 text-center">
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
      <div className="grid justify-center gap-4 sm:grid-cols-2">
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
        <div className="mb-6 text-center">
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
        <div className="mb-6 text-center">
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
      <div className="mb-6 flex flex-col items-center gap-4 text-center">
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
      <div className="grid justify-center gap-4 sm:grid-cols-2">
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
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:justify-between">
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
      <div className="grid justify-center gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {hasPlayer && (
          <>
            <Link href="/player/find-team">
              <Card className="text-center transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex flex-col items-center gap-3 p-4">
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
              <Card className="text-center transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex flex-col items-center gap-3 p-4">
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
              <Card className="text-center transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex flex-col items-center gap-3 p-4">
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
              <Card className="text-center transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex flex-col items-center gap-3 p-4">
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
              <Card className="text-center transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex flex-col items-center gap-3 p-4">
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
              <Card className="text-center transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex flex-col items-center gap-3 p-4">
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
              <Card className="text-center transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="flex flex-col items-center gap-3 p-4">
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

  // Determine which "Latest" section to show based on the active view
  const activeView = isAuthenticated && isDualRole
    ? (isPlayerView ? "player" : isTeamView ? "team" : null)
    : isAuthenticated
      ? (hasPlayer ? "player" : hasTeam ? "team" : null)
      : null;

  return (
    <div className="py-8 md:py-12">
      {/* Hero Section — full-bleed, spans the entire viewport width */}
      <HeroSection
        isAuthenticated={isAuthenticated}
        userRoles={userRoles}
        profileName={profileName}
      />

      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-6xl">
        {/* Latest section — shown right after hero, switches based on view */}
        <LatestSection
          view={activeView}
          opportunities={latestOpportunities}
          teamPlayerRecommendations={teamPlayerRecommendations}
          hasTeamProfile={hasTeamProfile}
          isAuthenticated={isAuthenticated}
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
    </div>
  );
}
