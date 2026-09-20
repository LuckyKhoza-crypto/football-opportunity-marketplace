"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import {
  OPPORTUNITY_STATUS_LABELS,
  OPPORTUNITY_STATUS_COLORS,
  POSITION_LABELS,
  PLAYING_LEVEL_LABELS,
  type Opportunity,
} from "@/types";
import { Plus, Eye, Pencil, XCircle, Trash2, Calendar, MapPin, Swords, ArrowRight } from "lucide-react";

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function OpportunityCard({
  opportunity,
  teamId,
}: {
  opportunity: Opportunity;
  teamId?: string | null;
}) {
  const statusColor = OPPORTUNITY_STATUS_COLORS[opportunity.status] ?? "";
  const positionLabel = opportunity.position
    ? POSITION_LABELS[opportunity.position] ?? opportunity.position
    : "Any Position";

  const levelLabel = opportunity.playing_level
    ? PLAYING_LEVEL_LABELS[opportunity.playing_level as keyof typeof PLAYING_LEVEL_LABELS] ??
      opportunity.playing_level
    : null;

  return (
    <Card className="relative overflow-hidden border-[rgba(255,255,255,0.14)] transition-shadow hover:shadow-md">
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/images/home-page-im3.jpg')" }}
        aria-hidden="true"
      />

      <CardContent className="relative z-10 p-6">
        <div className="flex flex-col gap-4">
          {/* Title & status */}
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-bold text-white">{opportunity.title}</h3>
            <span
              className={`inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
            >
              {OPPORTUNITY_STATUS_LABELS[opportunity.status]}
            </span>
          </div>

          {/* Position badge & role */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground shadow-sm">
              {positionLabel}
            </span>
            {opportunity.role && (
              <span className="text-xs text-[#D1D5DB]">{opportunity.role}</span>
            )}
          </div>

          {/* Meta info */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-primary/80">
            {opportunity.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                {opportunity.location}
              </span>
            )}
            {levelLabel && <span>{levelLabel}</span>}
            {opportunity.tryout_date && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-primary" />
                Tryout: {formatDate(opportunity.tryout_date)}
              </span>
            )}
            <span className="text-xs text-[#D1D5DB]">
              Created {formatDate(opportunity.created_at)}
            </span>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href={`/team/opportunities/${opportunity.id}${teamId ? `?team=${teamId}` : ""}`}>
              <Button
                size="sm"
                className="group border-0 bg-primary text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground"
              >
                <Eye className="mr-1 h-3.5 w-3.5" />
                View
                <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link href={`/team/opportunities/${opportunity.id}/edit${teamId ? `?team=${teamId}` : ""}`}>
              <Button
                variant="outline"
                size="sm"
                className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Edit
              </Button>
            </Link>
            {opportunity.status === "active" && (
              <Button
                variant="outline"
                size="sm"
                className="border-white/40 bg-white/10 text-white hover:bg-destructive hover:text-white"
                onClick={async () => {
                  if (
                    !confirm(
                      "Close this opportunity? It will no longer be available to players.",
                    )
                  )
                    return;
                  try {
                    const res = await fetch(
                      `/api/team/opportunities/${opportunity.id}`,
                      {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ status: "closed" }),
                      },
                    );
                    if (res.ok) window.location.reload();
                  } catch (err) {
                    console.error("Failed to close opportunity:", err);
                  }
                }}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" />
                Close
              </Button>
            )}
            {(opportunity.status === "draft" || opportunity.status === "closed") && (
              <Button
                variant="outline"
                size="sm"
                className="border-white/40 bg-white/10 text-white hover:bg-destructive hover:text-white"
                onClick={async () => {
                  if (
                    !confirm(
                      "Delete this opportunity? This action cannot be undone.",
                    )
                  )
                    return;
                  try {
                    const res = await fetch(
                      `/api/team/opportunities/${opportunity.id}`,
                      { method: "DELETE" },
                    );
                    if (res.ok) window.location.reload();
                  } catch (err) {
                    console.error("Failed to delete opportunity:", err);
                  }
                }}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  status,
  teamId,
}: {
  status: string;
  teamId?: string | null;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Swords className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-lg font-semibold">
          No {status} opportunities
        </h3>
        <p className="mb-6 text-sm text-muted-foreground">
          {status === "draft"
            ? "Save an opportunity as a draft to come back to it later."
            : status === "active"
              ? "Post an opportunity to start finding players."
              : "No closed opportunities yet."}
        </p>
        {status === "active" && (
          <Link href={`/team/opportunities/new${teamId ? `?team=${teamId}` : ""}`}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Post Your First Opportunity
            </Button>
          </Link>
        )}
      </CardContent>
    </Card>
  );
}