"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  COMPETITION_EVENT_STATUS_LABELS,
  COMPETITION_EVENT_STATUS_COLORS,
  type CompetitionEvent,
} from "@/types";
import { Calendar, MapPin, Target, Repeat, ArrowRight, Trophy } from "lucide-react";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Date not set";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CompetitionCard({ event }: { event: CompetitionEvent }) {
  const statusColor = COMPETITION_EVENT_STATUS_COLORS[event.status] ?? "";

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-bold">{event.name}</h3>
            <span
              className={`inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
            >
              {COMPETITION_EVENT_STATUS_LABELS[event.status]}
            </span>
          </div>

          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>{event.location ?? "Location not set"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>{formatDate(event.event_date)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>
                {event.challenge_name} · target {event.challenge_threshold}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>
                {event.max_attempts}{" "}
                {event.max_attempts === 1 ? "attempt" : "attempts"} max
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Link href={`/competitions/${event.id}`}>
              <Button size="sm">
                <Trophy className="mr-1 h-3.5 w-3.5" />
                Manage
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyCompetitions({
  variant,
}: {
  variant: "managed" | "ambassador";
}) {
  const isManaged = variant === "managed";
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Trophy className="h-6 w-6 text-muted-foreground" />
        </div>
        {isManaged ? (
          <>
            <h3 className="mb-2 text-lg font-semibold">
              You haven&apos;t created any competitions yet.
            </h3>
            <p className="mb-6 max-w-md text-sm text-muted-foreground">
              Create your first competition to start managing an event,
              challenge, and ambassadors.
            </p>
            <Link href="/competitions/new">
              <Button>Create your first competition</Button>
            </Link>
          </>
        ) : (
          <>
            <h3 className="mb-2 text-lg font-semibold">No ambassador events</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              When an event creator adds you as an ambassador, their event will
              appear here.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}