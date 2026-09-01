"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MatchDetails } from "@/components/marketplace/match-details";
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
  type ApplicationStatus,
  POSITION_LABELS,
  PLAYING_LEVEL_LABELS,
  AVAILABILITY_LABELS,
  PREFERRED_FOOT_LABELS,
  POSITIONS,
} from "@/types";
import type { MatchResult, MatchQuality } from "@/lib/matching";
import {
  Loader2,
  AlertCircle,
  Inbox,
  Eye,
  User,
  MapPin,
  Calendar,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Search,
  Trophy,
  Target,
  Filter,
  ArrowUpDown,
  Swords,
  Plus,
  Building,
  Footprints,
  Cake,
  Briefcase,
  Star,
  Video,
  Award,
  Globe,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface ApplicationWithDetails {
  id: string;
  opportunity_id: string;
  player_profile_id: string;
  status: ApplicationStatus;
  cover_message: string | null;
  created_at: string;
  updated_at: string;
  opportunity: {
    id: string;
    title: string;
    position: string | null;
    secondary_positions: string[];
    role: string | null;
    playing_level: string | null;
    league: string | null;
    location: string | null;
    radius: number | null;
    preferred_foot: string | null;
    availability: string | null;
    compensation: string | null;
    status: string;
    created_at: string;
  } | null;
  player_profile: {
    id: string;
    user_id: string;
    profile_photo_url: string | null;
    date_of_birth: string | null;
    location: string | null;
    positions: string[];
    preferred_role: string | null;
    playing_level: string | null;
    preferred_foot: string | null;
    availability: string | null;
    willing_to_travel: boolean;
    willing_to_relocate: boolean;
    travel_radius: number | null;
    compensation_expectation: string | null;
    previous_clubs: Array<{ name: string; position: string; startDate: string; endDate: string | null; achievements?: string }>;
    stats: Record<string, number>;
    achievements: string[];
    highlight_video_url: string | null;
    preferred_leagues: string[];
    bio: string | null;
    created_at: string;
    updated_at: string;
    user: {
      id: string;
      full_name: string | null;
      email: string;
    } | null;
  } | null;
  match_result: MatchResult | null;
}

interface OpportunitySummary {
  id: string;
  title: string;
  position: string | null;
  playing_level: string | null;
  location: string | null;
  status: string;
  created_at: string;
}

const STATUS_OPTIONS: Array<ApplicationStatus | "all"> = [
  "all",
  "pending",
  "reviewing",
  "accepted",
  "rejected",
];

const MATCH_QUALITY_OPTIONS: Array<MatchQuality | "all"> = [
  "all",
  "excellent",
  "strong",
  "possible",
  "weak",
  "poor",
];

const MATCH_QUALITY_LABELS: Record<string, string> = {
  all: "All Qualities",
  excellent: "Excellent",
  strong: "Strong",
  possible: "Possible",
  weak: "Weak",
  poor: "Poor",
};

const SORT_OPTIONS = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "highest_match", label: "Highest Match" },
  { value: "lowest_match", label: "Lowest Match" },
];

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return formatDate(dateStr);
}

function calculateAge(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function getMatchQualityColor(classification: string): string {
  const colors: Record<string, string> = {
    excellent: "text-green-600 dark:text-green-400",
    strong: "text-emerald-600 dark:text-emerald-400",
    possible: "text-blue-600 dark:text-blue-400",
    weak: "text-yellow-600 dark:text-yellow-400",
    poor: "text-red-600 dark:text-red-400",
  };
  return colors[classification] ?? "text-muted-foreground";
}

function getMatchQualityBg(classification: string): string {
  const colors: Record<string, string> = {
    excellent: "bg-green-100 dark:bg-green-900/30",
    strong: "bg-emerald-100 dark:bg-emerald-900/30",
    possible: "bg-blue-100 dark:bg-blue-900/30",
    weak: "bg-yellow-100 dark:bg-yellow-900/30",
    poor: "bg-red-100 dark:bg-red-900/30",
  };
  return colors[classification] ?? "bg-muted";
}

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  confirmVariant = "default",
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h3 className="mb-2 text-lg font-semibold">{title}</h3>
        <p className="mb-6 text-sm text-muted-foreground">{message}</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ApplicationStatus }) {
  const colorClass = APPLICATION_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-800";
  const label = APPLICATION_STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

function MatchScoreBadge({ score, classification }: { score: number; classification: string }) {
  const color = getMatchQualityColor(classification);
  const bg = getMatchQualityBg(classification);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${color} ${bg}`}>
      <Star className="h-3 w-3" />
      {score}% Match
    </span>
  );
}

export function TeamApplicationsClient() {
  const [applications, setApplications] = useState<ApplicationWithDetails[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
  const [opportunityFilter, setOpportunityFilter] = useState<string>("all");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [matchQualityFilter, setMatchQualityFilter] = useState<MatchQuality | "all">("all");
  const [sortBy, setSortBy] = useState<string>("newest");

  // UI state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    applicationId: string;
    newStatus: ApplicationStatus;
    title: string;
    message: string;
    confirmLabel: string;
    confirmVariant: "default" | "destructive";
  }>({
    isOpen: false,
    applicationId: "",
    newStatus: "pending" as ApplicationStatus,
    title: "",
    message: "",
    confirmLabel: "",
    confirmVariant: "default",
  });

  const fetchApplications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ context: "team" });
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      if (opportunityFilter !== "all") {
        params.set("opportunity_id", opportunityFilter);
      }
      if (positionFilter !== "all") {
        params.set("position", positionFilter);
      }
      if (matchQualityFilter !== "all") {
        params.set("match_quality", matchQualityFilter);
      }
      params.set("sort", sortBy);

      const res = await fetch(`/api/applications?${params}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to fetch applications");
        return;
      }

      setApplications(data.applications ?? []);
      setOpportunities(data.opportunities ?? []);
      setCurrentPage(1);
    } catch {
      setError("Failed to load applications. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, opportunityFilter, positionFilter, matchQualityFilter, sortBy]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]); // eslint-disable-line react-hooks/set-state-in-effect

  const updateStatus = async (
    applicationId: string,
    newStatus: ApplicationStatus,
  ) => {
    setUpdatingId(applicationId);
    try {
      const res = await fetch(`/api/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to update application");
        return;
      }

      // Optimistic update
      setApplications((prev) =>
        prev.map((app) =>
          app.id === applicationId ? { ...app, status: newStatus } : app,
        ),
      );
    } catch {
      alert("Failed to update application. Please try again.");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStatusAction = (
    applicationId: string,
    newStatus: ApplicationStatus,
  ) => {
    if (newStatus === "rejected" || newStatus === "accepted") {
      const isReject = newStatus === "rejected";
      setConfirmDialog({
        isOpen: true,
        applicationId,
        newStatus,
        title: isReject ? "Reject Application" : "Accept Application",
        message: isReject
          ? "Are you sure you want to reject this application? This action cannot be undone."
          : "Are you sure you want to accept this application? This will notify the player.",
        confirmLabel: isReject ? "Reject Application" : "Accept Application",
        confirmVariant: isReject ? "destructive" : "default",
      });
    } else {
      updateStatus(applicationId, newStatus);
    }
  };

  // Pagination
  const totalPages = Math.ceil(applications.length / itemsPerPage);
  const paginatedApps = applications.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  // Counts for filter buttons
  const counts = {
    all: applications.length,
    pending: applications.filter((a) => a.status === "pending").length,
    reviewing: applications.filter((a) => a.status === "reviewing").length,
    accepted: applications.filter((a) => a.status === "accepted").length,
    rejected: applications.filter((a) => a.status === "rejected").length,
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="mt-4 text-lg text-muted-foreground">
          Loading applications...
        </p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20">
        <CardContent className="flex items-start gap-3 p-6">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
          <div>
            <p className="font-medium text-red-800 dark:text-red-300">
              Error loading applications
            </p>
            <p className="mt-1 text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={fetchApplications}
            >
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── Empty States ───────────────────────────────────────────────

  // No applications at all
  if (applications.length === 0 && statusFilter === "all" && opportunityFilter === "all" && positionFilter === "all" && matchQualityFilter === "all") {
    const hasOpportunities = opportunities.length > 0;
    return (
      <div className="space-y-6">
        {/* Status Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((status) => {
            const isActive = statusFilter === status;
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {status === "all" ? "All" : APPLICATION_STATUS_LABELS[status]}
                <span className="ml-1.5 text-xs opacity-70">(0)</span>
              </button>
            );
          })}
        </div>

        <Card>
          <CardContent className="flex flex-col items-center py-20 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
              <Inbox className="h-10 w-10 text-muted-foreground" />
            </div>
            <h2 className="mb-3 text-2xl font-bold">No applications yet</h2>
            <p className="mb-8 max-w-lg text-muted-foreground">
              {hasOpportunities
                ? "Applications from players will appear here when they apply to your opportunities. Make sure your opportunities are active and visible to players."
                : "You need to create an opportunity first before players can apply. Post your first opportunity to start receiving applications."}
            </p>
            <div className="flex flex-wrap gap-3">
              {hasOpportunities ? (
                <Link href="/team/opportunities">
                  <Button variant="outline">
                    <Swords className="mr-2 h-4 w-4" />
                    View Opportunities
                  </Button>
                </Link>
              ) : (
                <Link href="/team/opportunities/new">
                  <Button>
                    <Plus className="mr-2 h-5 w-5" />
                    Create an Opportunity
                  </Button>
                </Link>
              )}
              <Link href="/team/find-players">
                <Button variant="outline">
                  <Search className="mr-2 h-4 w-4" />
                  Find Players
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No applications matching filters
  if (applications.length === 0) {
    return (
      <div className="space-y-6">
        {/* Status Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((status) => {
            const isActive = statusFilter === status;
            const count = (status === "all" ? counts.all : (counts as Record<string, number>)[status]) ?? 0;
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {status === "all" ? "All" : APPLICATION_STATUS_LABELS[status]}
                <span className="ml-1.5 text-xs opacity-70">({count})</span>
              </button>
            );
          })}
        </div>

        <Card>
          <CardContent className="flex flex-col items-center py-20 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
              <Filter className="h-10 w-10 text-muted-foreground" />
            </div>
            <h2 className="mb-3 text-2xl font-bold">No matching applications</h2>
            <p className="mb-8 max-w-lg text-muted-foreground">
              No applications match your current filter selection. Try adjusting
              your filters to see more results.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setStatusFilter("all");
                setOpportunityFilter("all");
                setPositionFilter("all");
                setMatchQualityFilter("all");
                setSortBy("newest");
              }}
            >
              Clear All Filters
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        confirmVariant={confirmDialog.confirmVariant}
        onConfirm={() => {
          updateStatus(confirmDialog.applicationId, confirmDialog.newStatus);
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        }}
        onCancel={() =>
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }))
        }
        loading={updatingId === confirmDialog.applicationId}
      />

      {/* Status Filter Buttons */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((status) => {
          const isActive = statusFilter === status;
          const count = (status === "all" ? counts.all : (counts as Record<string, number>)[status]) ?? 0;
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {status === "all" ? "All" : APPLICATION_STATUS_LABELS[status]}
              <span className="ml-1.5 text-xs opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Filter & Sort Controls */}
      <div className="rounded-lg border bg-card p-4">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex w-full items-center justify-between text-sm font-medium"
        >
          <span className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters & Sorting
            {(opportunityFilter !== "all" || positionFilter !== "all" || matchQualityFilter !== "all" || sortBy !== "newest") && (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                {(opportunityFilter !== "all" ? 1 : 0) +
                  (positionFilter !== "all" ? 1 : 0) +
                  (matchQualityFilter !== "all" ? 1 : 0) +
                  (sortBy !== "newest" ? 1 : 0)}
              </span>
            )}
          </span>
          {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {showFilters && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Opportunity Filter */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Opportunity
              </label>
              <select
                value={opportunityFilter}
                onChange={(e) => setOpportunityFilter(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              >
                <option value="all">All Opportunities</option>
                {opportunities.map((opp) => (
                  <option key={opp.id} value={opp.id}>
                    {opp.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Position Filter */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Position
              </label>
              <select
                value={positionFilter}
                onChange={(e) => setPositionFilter(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              >
                <option value="all">All Positions</option>
                {POSITIONS.map((pos) => (
                  <option key={pos} value={pos}>
                    {POSITION_LABELS[pos] ?? pos}
                  </option>
                ))}
              </select>
            </div>

            {/* Match Quality Filter */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Match Quality
              </label>
              <select
                value={matchQualityFilter}
                onChange={(e) => setMatchQualityFilter(e.target.value as MatchQuality | "all")}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              >
                {MATCH_QUALITY_OPTIONS.map((q) => (
                  <option key={q} value={q}>
                    {MATCH_QUALITY_LABELS[q]}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                <ArrowUpDown className="mr-1 inline h-3 w-3" />
                Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {paginatedApps.length} of {applications.length} application{applications.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Applications List */}
      <div className="space-y-4">
        {paginatedApps.map((app) => {
          const isExpanded = expandedId === app.id;
          const profile = app.player_profile;
          const opportunity = app.opportunity;
          const playerName = profile?.user?.full_name ?? "Unknown Player";

          return (
            <Card
              key={app.id}
              className={`transition-all hover:shadow-md ${
                app.status === "pending" ? "border-l-4 border-l-primary" : ""
              } ${app.status === "reviewing" ? "border-l-4 border-l-blue-500" : ""}`}
            >
              <CardContent className="p-0">
                {/* Main Row */}
                <div className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    {/* Left: Applicant Info */}
                    <div className="flex-1 space-y-3">
                      {/* Player Name & Status */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/players/${profile?.id}`}
                          className="group flex items-center gap-2"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                            {profile?.profile_photo_url ? (
                              <img
                                src={profile.profile_photo_url}
                                alt=""
                                className="h-10 w-10 rounded-full object-cover"
                              />
                            ) : (
                              <User className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <span className="text-base font-semibold group-hover:text-primary">
                            {playerName}
                          </span>
                        </Link>
                        <StatusBadge status={app.status} />
                        {app.match_result && (
                          <MatchScoreBadge
                            score={app.match_result.score}
                            classification={app.match_result.classification}
                          />
                        )}
                      </div>

                      {/* Position & Opportunity */}
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        {profile?.positions && profile.positions.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Target className="h-3.5 w-3.5" />
                            {profile.positions
                              .map((p) => POSITION_LABELS[p] ?? p)
                              .join(" / ")}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Swords className="h-3.5 w-3.5" />
                          {opportunity?.title ?? "Unknown Opportunity"}
                        </span>
                        {profile?.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {profile.location}
                          </span>
                        )}
                      </div>

                      {/* Dates */}
                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Applied {formatDateRelative(app.created_at)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Updated {formatDateRelative(app.updated_at)}
                        </span>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Quick Status Actions */}
                      {app.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleStatusAction(app.id, "reviewing")
                            }
                            disabled={updatingId === app.id}
                            className="h-8"
                          >
                            {updatingId === app.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Eye className="mr-1 h-3.5 w-3.5" />
                            )}
                            Review
                          </Button>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() =>
                              handleStatusAction(app.id, "accepted")
                            }
                            disabled={updatingId === app.id}
                            className="h-8"
                          >
                            {updatingId === app.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            )}
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20"
                            onClick={() =>
                              handleStatusAction(app.id, "rejected")
                            }
                            disabled={updatingId === app.id}
                          >
                            {updatingId === app.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <XCircle className="mr-1 h-3.5 w-3.5" />
                            )}
                            Reject
                          </Button>
                        </>
                      )}
                      {app.status === "reviewing" && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() =>
                              handleStatusAction(app.id, "accepted")
                            }
                            disabled={updatingId === app.id}
                            className="h-8"
                          >
                            {updatingId === app.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            )}
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20"
                            onClick={() =>
                              handleStatusAction(app.id, "rejected")
                            }
                            disabled={updatingId === app.id}
                          >
                            {updatingId === app.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <XCircle className="mr-1 h-3.5 w-3.5" />
                            )}
                            Reject
                          </Button>
                        </>
                      )}
                      {app.status === "accepted" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Accepted
                        </span>
                      )}
                      {app.status === "rejected" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          <XCircle className="h-3.5 w-3.5" />
                          Rejected
                        </span>
                      )}

                      {/* Expand/Collapse */}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setExpandedId(isExpanded ? null : app.id)
                        }
                        className="h-8"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                        <span className="ml-1 text-xs">
                          {isExpanded ? "Less" : "Details"}
                        </span>
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t px-5 pb-5 pt-4">
                    <div className="grid gap-8 lg:grid-cols-2">
                      {/* ─── Player Profile ─────────────────────────── */}
                      <div className="space-y-4">
                        <h4 className="flex items-center gap-2 text-sm font-semibold">
                          <User className="h-4 w-4 text-primary" />
                          Player Profile
                        </h4>

                        {profile ? (
                          <div className="space-y-4">
                            {/* Player Header */}
                            <div className="flex items-center gap-3">
                              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                                {profile.profile_photo_url ? (
                                  <img
                                    src={profile.profile_photo_url}
                                    alt=""
                                    className="h-14 w-14 rounded-full object-cover"
                                  />
                                ) : (
                                  <User className="h-7 w-7 text-muted-foreground" />
                                )}
                              </div>
                              <div>
                                <p className="font-semibold">{playerName}</p>
                                {profile.positions && profile.positions.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {profile.positions.map((pos) => (
                                      <span
                                        key={pos}
                                        className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                                      >
                                        {POSITION_LABELS[pos] ?? pos}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Player Details Grid */}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                              {profile.date_of_birth && (
                                <div>
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Cake className="h-3 w-3" />
                                    Age
                                  </span>
                                  <p className="text-sm font-medium">
                                    {calculateAge(profile.date_of_birth)} years old
                                  </p>
                                </div>
                              )}
                              {profile.location && (
                                <div>
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <MapPin className="h-3 w-3" />
                                    Location
                                  </span>
                                  <p className="text-sm font-medium">
                                    {profile.location}
                                  </p>
                                </div>
                              )}
                              {profile.preferred_foot && (
                                <div>
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Footprints className="h-3 w-3" />
                                    Preferred Foot
                                  </span>
                                  <p className="text-sm font-medium">
                                    {PREFERRED_FOOT_LABELS[profile.preferred_foot as keyof typeof PREFERRED_FOOT_LABELS] ?? profile.preferred_foot}
                                  </p>
                                </div>
                              )}
                              {profile.playing_level && (
                                <div>
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Star className="h-3 w-3" />
                                    Level
                                  </span>
                                  <p className="text-sm font-medium">
                                    {PLAYING_LEVEL_LABELS[profile.playing_level as keyof typeof PLAYING_LEVEL_LABELS] ?? profile.playing_level}
                                  </p>
                                </div>
                              )}
                              {profile.availability && (
                                <div>
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    Availability
                                  </span>
                                  <p className="text-sm font-medium">
                                    {AVAILABILITY_LABELS[profile.availability as keyof typeof AVAILABILITY_LABELS] ?? profile.availability}
                                  </p>
                                </div>
                              )}
                              {profile.compensation_expectation && (
                                <div>
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Briefcase className="h-3 w-3" />
                                    Compensation
                                  </span>
                                  <p className="text-sm font-medium">
                                    {profile.compensation_expectation}
                                  </p>
                                </div>
                              )}
                            </div>

                            {/* Bio */}
                            {profile.bio && (
                              <div>
                                <span className="text-xs text-muted-foreground">Bio</span>
                                <p className="mt-0.5 text-sm text-muted-foreground">
                                  {profile.bio}
                                </p>
                              </div>
                            )}

                            {/* Previous Clubs */}
                            {profile.previous_clubs && profile.previous_clubs.length > 0 && (
                              <div>
                                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                                  <Building className="h-3 w-3" />
                                  Previous Clubs
                                </span>
                                <div className="mt-1 space-y-2">
                                  {profile.previous_clubs.slice(0, 3).map((club, idx) => (
                                    <div key={idx} className="rounded-md bg-muted/50 p-2">
                                      <p className="text-sm font-medium">{club.name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {club.position}
                                        {club.startDate && ` · ${club.startDate}${club.endDate ? ` - ${club.endDate}` : " - Present"}`}
                                      </p>
                                    </div>
                                  ))}
                                  {profile.previous_clubs.length > 3 && (
                                    <p className="text-xs text-muted-foreground">
                                      +{profile.previous_clubs.length - 3} more clubs
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Stats */}
                            {profile.stats && Object.keys(profile.stats).length > 0 && (
                              <div>
                                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                                  <Award className="h-3 w-3" />
                                  Stats
                                </span>
                                <div className="mt-1 grid grid-cols-3 gap-2">
                                  {profile.stats.appearances !== undefined && (
                                    <div className="rounded-md bg-muted/50 p-2 text-center">
                                      <p className="text-lg font-bold text-primary">{profile.stats.appearances}</p>
                                      <p className="text-xs text-muted-foreground">Apps</p>
                                    </div>
                                  )}
                                  {profile.stats.goals !== undefined && (
                                    <div className="rounded-md bg-muted/50 p-2 text-center">
                                      <p className="text-lg font-bold text-primary">{profile.stats.goals}</p>
                                      <p className="text-xs text-muted-foreground">Goals</p>
                                    </div>
                                  )}
                                  {profile.stats.assists !== undefined && (
                                    <div className="rounded-md bg-muted/50 p-2 text-center">
                                      <p className="text-lg font-bold text-primary">{profile.stats.assists}</p>
                                      <p className="text-xs text-muted-foreground">Assists</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Achievements */}
                            {profile.achievements && profile.achievements.length > 0 && (
                              <div>
                                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                                  <Trophy className="h-3 w-3" />
                                  Achievements
                                </span>
                                <ul className="mt-1 space-y-1">
                                  {profile.achievements.slice(0, 3).map((achievement, idx) => (
                                    <li key={idx} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                                      <Trophy className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary" />
                                      {achievement}
                                    </li>
                                  ))}
                                  {profile.achievements.length > 3 && (
                                    <p className="text-xs text-muted-foreground">
                                      +{profile.achievements.length - 3} more
                                    </p>
                                  )}
                                </ul>
                              </div>
                            )}

                            {/* Preferred Leagues */}
                            {profile.preferred_leagues && profile.preferred_leagues.length > 0 && (
                              <div>
                                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                                  <Globe className="h-3 w-3" />
                                  Preferred Leagues
                                </span>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {profile.preferred_leagues.map((league, idx) => (
                                    <span key={idx} className="inline-flex rounded-md bg-secondary px-2 py-0.5 text-xs">
                                      {league}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Highlight Video */}
                            {profile.highlight_video_url && (
                              <div>
                                <a
                                  href={profile.highlight_video_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                >
                                  <Video className="h-3.5 w-3.5" />
                                  Watch Highlight Reel
                                </a>
                              </div>
                            )}

                            {/* View Full Profile */}
                            <Link href={`/players/${profile.id}`}>
                              <Button size="sm" variant="outline" className="w-full">
                                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                                View Full Profile
                              </Button>
                            </Link>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Player profile not available
                          </p>
                        )}
                      </div>

                      {/* ─── Application & Match Details ────────────── */}
                      <div className="space-y-4">
                        {/* Opportunity Info */}
                        {opportunity && (
                          <div>
                            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                              <Swords className="h-4 w-4 text-primary" />
                              Opportunity
                            </h4>
                            <div className="rounded-md bg-muted/50 p-3">
                              <p className="font-medium">{opportunity.title}</p>
                              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                {opportunity.position && (
                                  <div>
                                    <span className="text-xs text-muted-foreground">Position</span>
                                    <p className="font-medium">{POSITION_LABELS[opportunity.position] ?? opportunity.position}</p>
                                  </div>
                                )}
                                {opportunity.playing_level && (
                                  <div>
                                    <span className="text-xs text-muted-foreground">Level</span>
                                    <p className="font-medium">{PLAYING_LEVEL_LABELS[opportunity.playing_level as keyof typeof PLAYING_LEVEL_LABELS] ?? opportunity.playing_level}</p>
                                  </div>
                                )}
                                {opportunity.league && (
                                  <div>
                                    <span className="text-xs text-muted-foreground">League</span>
                                    <p className="font-medium">{opportunity.league}</p>
                                  </div>
                                )}
                                {opportunity.location && (
                                  <div>
                                    <span className="text-xs text-muted-foreground">Location</span>
                                    <p className="font-medium">{opportunity.location}</p>
                                  </div>
                                )}
                                {opportunity.availability && (
                                  <div>
                                    <span className="text-xs text-muted-foreground">Availability</span>
                                    <p className="font-medium">{AVAILABILITY_LABELS[opportunity.availability as keyof typeof AVAILABILITY_LABELS] ?? opportunity.availability}</p>
                                  </div>
                                )}
                                {opportunity.compensation && (
                                  <div>
                                    <span className="text-xs text-muted-foreground">Compensation</span>
                                    <p className="font-medium">{opportunity.compensation}</p>
                                  </div>
                                )}
                              </div>
                              <Link href={`/opportunities/${opportunity.id}`}>
                                <Button size="sm" variant="ghost" className="mt-2 h-7 text-xs">
                                  <ExternalLink className="mr-1 h-3 w-3" />
                                  View Opportunity
                                </Button>
                              </Link>
                            </div>
                          </div>
                        )}

                        {/* Cover Message */}
                        {app.cover_message && (
                          <div>
                            <h4 className="mb-1 flex items-center gap-1 text-sm font-semibold">
                              <MessageSquare className="h-4 w-4 text-primary" />
                              Application Message
                            </h4>
                            <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                              {app.cover_message}
                            </p>
                          </div>
                        )}

                        {/* Match Score */}
                        {app.match_result && (
                          <div>
                            <h4 className="mb-2 text-sm font-semibold">
                              Match Analysis
                            </h4>
                            <MatchDetails
                              matchResult={app.match_result}
                              compact
                              showBreakdown
                              showReasons
                              showSuggestions={false}
                              showWhyCallout={false}
                            />
                          </div>
                        )}

                        {/* Dates */}
                        <div className="space-y-1 text-xs text-muted-foreground">
                          <p className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Applied: {formatDate(app.created_at)}
                          </p>
                          <p className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Last updated: {formatDate(app.updated_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}