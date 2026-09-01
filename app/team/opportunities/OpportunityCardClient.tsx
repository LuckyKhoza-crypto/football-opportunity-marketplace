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
import { Plus, Eye, Pencil, XCircle, Trash2, Calendar, MapPin, Swords } from "lucide-react";

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const statusColor = OPPORTUNITY_STATUS_COLORS[opportunity.status] ?? "";
  const positionLabel = opportunity.position
    ? POSITION_LABELS[opportunity.position] ?? opportunity.position
    : "Any Position";

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">{opportunity.title}</h3>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
              >
                {OPPORTUNITY_STATUS_LABELS[opportunity.status]}
              </span>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Swords className="h-3.5 w-3.5" />
                {positionLabel}
              </span>
              {opportunity.playing_level && (
                <span>
                  {PLAYING_LEVEL_LABELS[opportunity.playing_level as keyof typeof PLAYING_LEVEL_LABELS] ?? opportunity.playing_level}
                </span>
              )}
              {opportunity.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {opportunity.location}
                </span>
              )}
              {opportunity.tryout_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  Tryout: {formatDate(opportunity.tryout_date)}
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Created {formatDate(opportunity.created_at)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Link href={`/team/opportunities/${opportunity.id}`}>
              <Button variant="outline" size="sm">
                <Eye className="mr-1 h-3.5 w-3.5" />
                View
              </Button>
            </Link>
            <Link href={`/team/opportunities/${opportunity.id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Edit
              </Button>
            </Link>
            {opportunity.status === "active" && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
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
                className="text-destructive hover:text-destructive"
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

export function EmptyState({ status }: { status: string }) {
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
          <Link href="/team/opportunities/new">
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