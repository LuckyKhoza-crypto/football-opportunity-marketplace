"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  COMPETITION_EVENT_STATUS_LABELS,
  COMPETITION_EVENT_STATUS_COLORS,
} from "@/types";
import type { PublicCompetitionResult } from "@/types/competition-public";
import { Calendar, MapPin, Target, Trophy, CheckCircle2 } from "lucide-react";

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

/**
 * Render a participant's name — linked to /players/[id] only when a player
 * profile exists. The existing public player profile route is /players/[id]
 * where id is the player_profiles.id. If there is no player profile we show the
 * plain name (never a broken link); competition participation does not require
 * one (COMP-003).
 */
function ParticipantName({
  displayName,
  playerProfileId,
  className,
}: {
  displayName: string;
  playerProfileId: string | null;
  className?: string;
}) {
  if (playerProfileId) {
    return (
      <Link
        href={`/players/${playerProfileId}`}
        className={`font-medium text-primary underline-offset-4 hover:underline ${className ?? ""}`}
      >
        {displayName}
      </Link>
    );
  }
  return <span className={`font-medium ${className ?? ""}`}>{displayName}</span>;
}

export function PublicCompetitionResultCard({
  result,
}: {
  result: PublicCompetitionResult;
}) {
  const statusColor = COMPETITION_EVENT_STATUS_COLORS[result.status] ?? "";

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold">{result.name}</h2>
            <span
              className={`inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
            >
              {COMPETITION_EVENT_STATUS_LABELS[result.status]}
            </span>
          </div>

          {result.description && (
            <p className="text-sm text-muted-foreground">{result.description}</p>
          )}

          {/* Meta */}
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>{result.location ?? "Location not set"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>{formatDate(result.eventDate)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 flex-shrink-0 text-primary" />
              <span>{result.challengeName}</span>
            </div>
          </div>

          {/* Qualified participants */}
          <div className="border-t pt-4">
            <div className="mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">
                Qualified Participants
                {result.qualifiedCount > 0 && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {result.qualifiedCount} qualified
                  </span>
                )}
              </h3>
            </div>

            {result.qualifiedParticipants.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {result.qualifiedParticipants.map((participant, index) => (
                  <li
                    key={`${participant.displayName}-${index}`}
                    className="inline-flex items-center gap-2 rounded-full border bg-muted/40 py-1 pl-1 pr-3 text-sm"
                  >
                    {participant.avatarUrl ? (
                      <img
                        src={participant.avatarUrl}
                        alt=""
                        className="h-6 w-6 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                        {participant.displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <ParticipantName
                      displayName={participant.displayName}
                      playerProfileId={participant.playerProfileId}
                    />
                    {participant.isWinner && (
                      <Trophy className="h-3.5 w-3.5 text-amber-500" />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No qualified participants yet
              </p>
            )}
          </div>

          {/* Winner */}
          <div className="border-t pt-4">
            <h3 className="mb-2 text-sm font-semibold">Winner</h3>
            {result.winner ? (
              <div className="flex items-center gap-3 rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
                <Trophy className="h-6 w-6 flex-shrink-0 text-amber-500" />
                {result.winner.avatarUrl ? (
                  <img
                    src={result.winner.avatarUrl}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                    {result.winner.displayName.charAt(0).toUpperCase()}
                  </span>
                )}
                <ParticipantName
                  displayName={result.winner.displayName}
                  playerProfileId={result.winner.playerProfileId}
                  className="text-base"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Drawing pending</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}