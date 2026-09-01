"use client";

import Link from "next/link";
import { POSITION_LABELS, PLAYING_LEVEL_LABELS, AVAILABILITY_LABELS, type Opportunity } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Swords, Users, ArrowRight } from "lucide-react";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface OpportunityCardProps {
  opportunity: Opportunity;
  teamName?: string;
  teamLogo?: string | null;
}

export function OpportunityCard({ opportunity, teamName, teamLogo }: OpportunityCardProps) {
  const positionLabel = opportunity.position
    ? POSITION_LABELS[opportunity.position] ?? opportunity.position
    : "Any Position";

  const levelLabel = opportunity.playing_level
    ? PLAYING_LEVEL_LABELS[opportunity.playing_level as keyof typeof PLAYING_LEVEL_LABELS] ?? opportunity.playing_level
    : null;

  const availabilityLabel = opportunity.availability
    ? AVAILABILITY_LABELS[opportunity.availability as keyof typeof AVAILABILITY_LABELS] ?? opportunity.availability
    : null;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex flex-col gap-4">
          {/* Team Info */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
              {teamLogo ? (
                <img
                  src={teamLogo}
                  alt={`${teamName ?? "Team"} logo`}
                  className="h-10 w-10 rounded-lg object-cover"
                />
              ) : (
                <Users className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold">{teamName ?? "Unknown Team"}</p>
              {levelLabel && (
                <p className="text-xs text-muted-foreground">
                  {levelLabel}
                  {opportunity.league && <span> &middot; {opportunity.league}</span>}
                </p>
              )}
            </div>
          </div>

          {/* Opportunity Details */}
          <div>
            <h3 className="text-base font-bold">{opportunity.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {positionLabel}
              </span>
              {opportunity.role && (
                <span className="text-xs text-muted-foreground">{opportunity.role}</span>
              )}
            </div>
          </div>

          {/* Meta Info */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {opportunity.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {opportunity.location}
              </span>
            )}
            {availabilityLabel && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {availabilityLabel}
              </span>
            )}
            {opportunity.tryout_date && (
              <span className="flex items-center gap-1">
                <Swords className="h-3.5 w-3.5" />
                Tryout: {formatDate(opportunity.tryout_date)}
              </span>
            )}
            {opportunity.compensation && (
              <span className="text-xs">{opportunity.compensation}</span>
            )}
          </div>

          {/* CTA */}
          <div className="pt-1">
            <Link href={`/opportunities/${opportunity.id}`}>
              <Button variant="outline" size="sm" className="group">
                View Opportunity
                <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}