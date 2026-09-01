"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
  APPLICATION_STATUS_DESCRIPTIONS,
  ACTIVE_APPLICATION_STATUSES,
  PAST_APPLICATION_STATUSES,
  type ApplicationStatus,
  POSITION_LABELS,
  PLAYING_LEVEL_LABELS,
  AVAILABILITY_LABELS,
} from "@/types";
import type { MatchResult, MatchQuality } from "@/lib/matching";
import {
  Loader2,
  AlertCircle,
  Inbox,
  ExternalLink,
  XCircle,
  MapPin,
  Calendar,
  Building,
  CheckCircle2,
  HelpCircle,
  Swords,
  Eye,
  Filter,
  ChevronDown,
  ChevronUp,
  Clock,
  ArrowUpDown,
  Star,
} from "lucide-react";
import { MatchDetails } from "@/components/marketplace/match-details";

interface ApplicationWithDetails {
  id: string;
  opportunity_id: string;
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
    formation: string | null;
    age_min: number | null;
    age_max: number | null;
    playing_level: string | null;
    league: string | null;
    location: string | null;
    radius: number | null;
    preferred_foot: string | null;
    availability: string | null;
    compensation: string | null;
    housing: string | null;
    travel_requirements: string | null;
    visa_requirements: string | null;
    contract_length: string | null;
    tryout_date: string | null;
    description: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    team: {
      id: string;
      team_name: string;
      logo_url: string | null;
      location: string | null;
      league: string | null;
      playing_level: string | null;
      description: string | null;
      website_url: string | null;
    };
  } | null;
  match_result: MatchResult | null;
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

const STATUS_OPTIONS: Array<ApplicationStatus | "all"> = [
  "all",
  "pending",
  "reviewing",
  "accepted",
  "rejected",
  "withdrawn",
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "highest_match", label: "Highest Match" },
  { value: "lowest_match", label: "Lowest Match" },
];

const MATCH_QUALITY_LABELS: Record<string, string> = {
  excellent: "Excellent",
  strong: "Strong",
  possible: "Possible",
  weak: "Weak",
  poor: "Poor",
};

const MATCH_QUALITY_COLORS: Record<string, string> = {
  excellent:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  strong:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  possible:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  weak: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  poor: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

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

function MatchScoreBadge({
  score,
  classification,
}: {
  score: number;
  classification: string;
}) {
  const color =
    MATCH_QUALITY_COLORS[classification] ?? "bg-muted text-muted-foreground";
  const label =
    MATCH_QUALITY_LABELS[classification] ?? classification;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}
    >
      <Star className="h-3 w-3" />
      {score}% {label}
    </span>
  );
}

export function ApplicationsClient() {
  const [applications, setApplications] = useState<ApplicationWithDetails[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">(
    "all",
  );
  const [sortBy, setSortBy] = useState("newest");
  const [showFilters, setShowFilters] = useState(false);

  // Withdraw state
  const [withdrawDialog, setWithdrawDialog] = useState<{
    isOpen: boolean;
    applicationId: string;
  }>({ isOpen: false, applicationId: "" });
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  // Expanded detail state
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchApplications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ context: "player" });
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      params.set("sort", sortBy);

      const res = await fetch(`/api/applications?${params}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to fetch applications");
        return;
      }

      setApplications(data.applications ?? []);
    } catch {
      setError("Failed to load applications. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sortBy]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleWithdrawConfirm = async () => {
    if (!withdrawDialog.applicationId) return;

    setWithdrawingId(withdrawDialog.applicationId);
    try {
      const res = await fetch(
        `/api/applications/${withdrawDialog.applicationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "withdrawn" }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to withdraw application");
        return;
      }

      // Optimistic update
      setApplications((prev) =>
        prev.map((app) =>
          app.id === withdrawDialog.applicationId
            ? { ...app, status: "withdrawn" as ApplicationStatus }
            : app,
        ),
      );
      setWithdrawDialog({ isOpen: false, applicationId: "" });
    } catch {
      alert("Failed to withdraw application. Please try again.");
    } finally {
      setWithdrawingId(null);
    }
  };

  // Compute filtered and sorted applications
  const filteredApps =
    statusFilter === "all"
      ? applications
      : applications.filter((a) => a.status === statusFilter);

  // Split into active and past
  const activeApps = filteredApps.filter((a) =>
    ACTIVE_APPLICATION_STATUSES.includes(a.status),
  );
  const pastApps = filteredApps.filter((a) =>
    PAST_APPLICATION_STATUSES.includes(a.status),
  );

  // Counts for filter buttons
  const counts = {
    all: applications.length,
    pending: applications.filter((a) => a.status === "pending").length,
    reviewing: applications.filter((a) => a.status === "reviewing").length,
    accepted: applications.filter((a) => a.status === "accepted").length,
    rejected: applications.filter((a) => a.status === "rejected").length,
    withdrawn: applications.filter((a) => a.status === "withdrawn").length,
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">Loading applications...</p>
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
  if (applications.length === 0 && statusFilter === "all") {
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
                {status === "all"
                  ? "All"
                  : APPLICATION_STATUS_LABELS[status]}
                <span className="ml-1.5 text-xs opacity-70">(0)</span>
              </button>
            );
          })}
        </div>

        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Inbox className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-xl font-bold">
              You haven't applied to any opportunities yet.
            </h2>
            <p className="mb-6 max-w-md text-muted-foreground">
              Start by finding a team that matches your profile and submit your
              first application.
            </p>
            <Link href="/player/find-team">
              <Button size="lg">
                <Swords className="mr-2 h-5 w-5" />
                Find a Team
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No applications match the filter
  if (filteredApps.length === 0) {
    return (
      <div className="space-y-6">
        {/* Status Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((status) => {
            const isActive = statusFilter === status;
            const count =
              status === "all"
                ? applications.length
                : applications.filter((a) => a.status === status).length;

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
                {status === "all"
                  ? "All"
                  : APPLICATION_STATUS_LABELS[status]}
                <span className="ml-1.5 text-xs opacity-70">({count})</span>
              </button>
            );
          })}
        </div>

        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Filter className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-xl font-bold">
              No applications match this filter.
            </h2>
            <p className="mb-6 max-w-md text-muted-foreground">
              Try selecting a different status filter to see more results.
            </p>
            <Button
              variant="outline"
              onClick={() => setStatusFilter("all")}
            >
              Clear Filter
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Withdraw Confirmation Dialog */}
      <ConfirmDialog
        isOpen={withdrawDialog.isOpen}
        title="Withdraw Application"
        message="Are you sure you want to withdraw this application? This action cannot be undone."
        confirmLabel="Withdraw Application"
        confirmVariant="destructive"
        onConfirm={handleWithdrawConfirm}
        onCancel={() =>
          setWithdrawDialog({ isOpen: false, applicationId: "" })
        }
        loading={withdrawingId === withdrawDialog.applicationId}
      />

      {/* Status Filter Buttons */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((status) => {
          const isActive = statusFilter === status;
          const count =
            status === "all"
              ? applications.length
              : applications.filter((a) => a.status === status).length;

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
              {status === "all"
                ? "All"
                : APPLICATION_STATUS_LABELS[status]}
              <span className="ml-1.5 text-xs opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Sort Controls */}
      <div className="rounded-lg border bg-card p-4">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex w-full items-center justify-between text-sm font-medium"
        >
          <span className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4" />
            Sorting & Filters
            {sortBy !== "newest" && (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                1
              </span>
            )}
          </span>
          {showFilters ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {showFilters && (
          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Sort by
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
        )}
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {filteredApps.length} application
          {filteredApps.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Active Applications Section */}
      {activeApps.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold">
            Active Applications ({activeApps.length})
          </h2>
          <div className="space-y-4">
            {activeApps.map((app) => {
              const statusColor =
                APPLICATION_STATUS_COLORS[app.status] ??
                "bg-gray-100 text-gray-800";
              const statusLabel =
                APPLICATION_STATUS_LABELS[app.status] ?? app.status;
              const statusDescription =
                APPLICATION_STATUS_DESCRIPTIONS[app.status] ?? "";
              const positionLabel = app.opportunity?.position
                ? POSITION_LABELS[app.opportunity.position] ??
                  app.opportunity.position
                : "Any Position";
              const opportunityClosed =
                app.opportunity?.status &&
                app.opportunity.status !== "active";
              const isExpanded = expandedId === app.id;

              return (
                <Card
                  key={app.id}
                  className="transition-shadow hover:shadow-md"
                >
                  <CardContent className="p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1 space-y-3">
                        {/* Opportunity Title & Status */}
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/opportunities/${app.opportunity_id}`}
                            className="text-base font-semibold hover:text-primary"
                          >
                            {app.opportunity?.title ?? "Unknown Opportunity"}
                          </Link>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
                          >
                            {statusLabel}
                          </span>
                          {opportunityClosed && (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                              Opportunity Closed
                            </span>
                          )}
                        </div>

                        {/* Position & Team */}
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          <span>{positionLabel}</span>
                          {app.opportunity?.team && (
                            <span className="flex items-center gap-1">
                              <Building className="h-3.5 w-3.5" />
                              {app.opportunity.team.team_name}
                            </span>
                          )}
                          {app.opportunity?.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {app.opportunity.location}
                            </span>
                          )}
                        </div>

                        {/* Match Score */}
                        {app.match_result && (
                          <MatchScoreBadge
                            score={app.match_result.score}
                            classification={app.match_result.classification}
                          />
                        )}

                        {/* Status Description */}
                        <p className="text-sm text-muted-foreground">
                          {statusDescription}
                        </p>

                        {/* Opportunity Closed Notice */}
                        {opportunityClosed && (
                          <div className="flex items-start gap-2 rounded-md bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-900/20 dark:text-gray-400">
                            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <span>
                              This opportunity is no longer accepting
                              applications, but your application remains
                              visible.
                            </span>
                          </div>
                        )}

                        {/* Cover Message Preview */}
                        {app.cover_message && !isExpanded && (
                          <p className="line-clamp-2 text-sm text-muted-foreground">
                            {app.cover_message}
                          </p>
                        )}

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

                      {/* Actions */}
                      <div className="flex flex-col gap-2 sm:items-end">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/player/applications/${app.id}`}
                          >
                            <Button variant="outline" size="sm">
                              <Eye className="mr-1 h-3.5 w-3.5" />
                              View Details
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedId(isExpanded ? null : app.id)
                            }
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </div>

                        {/* Withdraw Button */}
                        {(app.status === "pending" ||
                          app.status === "reviewing") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20"
                            onClick={() =>
                              setWithdrawDialog({
                                isOpen: true,
                                applicationId: app.id,
                              })
                            }
                            disabled={withdrawingId === app.id}
                          >
                            <XCircle className="mr-1 h-3.5 w-3.5" />
                            Withdraw
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Detail: Match Details */}
                    {isExpanded && app.match_result && (
                      <div className="mt-4 border-t pt-4">
                        <MatchDetails
                          matchResult={app.match_result}
                          compact
                          showBreakdown
                          showReasons
                          showSuggestions={false}
                          showWhyCallout
                          completeProfileHref="/player/profile/edit"
                        />
                      </div>
                    )}

                    {/* Expanded: Cover Message */}
                    {isExpanded && app.cover_message && (
                      <div className="mt-4 border-t pt-4">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          Your Message
                        </p>
                        <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                          {app.cover_message}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Past Applications Section */}
      {pastApps.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold">
            Past Applications ({pastApps.length})
          </h2>
          <div className="space-y-4">
            {pastApps.map((app) => {
              const statusColor =
                APPLICATION_STATUS_COLORS[app.status] ??
                "bg-gray-100 text-gray-800";
              const statusLabel =
                APPLICATION_STATUS_LABELS[app.status] ?? app.status;
              const statusDescription =
                APPLICATION_STATUS_DESCRIPTIONS[app.status] ?? "";
              const positionLabel = app.opportunity?.position
                ? POSITION_LABELS[app.opportunity.position] ??
                  app.opportunity.position
                : "Any Position";
              const isExpanded = expandedId === app.id;

              return (
                <Card
                  key={app.id}
                  className="transition-shadow hover:shadow-md opacity-80"
                >
                  <CardContent className="p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1 space-y-3">
                        {/* Opportunity Title & Status */}
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/opportunities/${app.opportunity_id}`}
                            className="text-base font-semibold hover:text-primary"
                          >
                            {app.opportunity?.title ?? "Unknown Opportunity"}
                          </Link>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
                          >
                            {statusLabel}
                          </span>
                        </div>

                        {/* Position & Team */}
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          <span>{positionLabel}</span>
                          {app.opportunity?.team && (
                            <span className="flex items-center gap-1">
                              <Building className="h-3.5 w-3.5" />
                              {app.opportunity.team.team_name}
                            </span>
                          )}
                          {app.opportunity?.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {app.opportunity.location}
                            </span>
                          )}
                        </div>

                        {/* Match Score */}
                        {app.match_result && (
                          <MatchScoreBadge
                            score={app.match_result.score}
                            classification={app.match_result.classification}
                          />
                        )}

                        {/* Status Description */}
                        <p className="text-sm text-muted-foreground">
                          {statusDescription}
                        </p>

                        {/* Accepted Experience */}
                        {app.status === "accepted" && (
                          <div className="flex items-start gap-2 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950/20 dark:text-green-400">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <div>
                              <p className="font-medium">
                                Your application was accepted by this team.
                              </p>
                              <p className="mt-1 text-green-600 dark:text-green-500">
                                No further actions are available at this time.
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Rejected Experience */}
                        {app.status === "rejected" && (
                          <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-400">
                            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <div>
                              <p className="font-medium">
                                Your application was not selected for this
                                position.
                              </p>
                              <p className="mt-1 text-red-600 dark:text-red-500">
                                You can continue exploring other opportunities.
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Withdrawn Experience */}
                        {app.status === "withdrawn" && (
                          <div className="flex items-start gap-2 rounded-md bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-900/20 dark:text-gray-400">
                            <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <span>
                              You withdrew this application. It is no longer
                              active.
                            </span>
                          </div>
                        )}

                        {/* Dates */}
                        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Applied {formatDate(app.created_at)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Updated {formatDate(app.updated_at)}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-2 sm:items-end">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/player/applications/${app.id}`}
                          >
                            <Button variant="outline" size="sm">
                              <Eye className="mr-1 h-3.5 w-3.5" />
                              View Details
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedId(isExpanded ? null : app.id)
                            }
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        <Link
                          href={`/opportunities/${app.opportunity_id}`}
                        >
                          <Button variant="outline" size="sm">
                            <ExternalLink className="mr-1 h-3.5 w-3.5" />
                            View Opportunity
                          </Button>
                        </Link>
                      </div>
                    </div>

                    {/* Expanded: Match Details */}
                    {isExpanded && app.match_result && (
                      <div className="mt-4 border-t pt-4">
                        <MatchDetails
                          matchResult={app.match_result}
                          compact
                          showBreakdown
                          showReasons
                          showSuggestions={false}
                          showWhyCallout
                          completeProfileHref="/player/profile/edit"
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}