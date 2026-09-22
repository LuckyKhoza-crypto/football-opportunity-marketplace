"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAllowedEventTransitions } from "@/lib/competition";
import {
  COMPETITION_EVENT_STATUS_LABELS,
  type CompetitionEventStatus,
} from "@/types";
import { Play, Trophy, Ban, RotateCcw, CheckCircle2, Loader2 } from "lucide-react";

/**
 * COMP-002 — Lifecycle controls.
 *
 * Only the transitions permitted from the current status are ever rendered,
 * and the server independently re-validates every transition. Disabled UI is
 * NOT the authorization boundary.
 *
 * The wording is deliberately careful:
 *  - moving to `drawing` PREPARES the event (no winner selection here)
 *  - `completed` is available from the lifecycle, but winner logic is owned
 *    by a later ticket.
 */

const TRANSITION_META: Record<
  CompetitionEventStatus,
  { label: string; icon: React.ReactNode; variant: "default" | "outline" | "destructive"; confirm?: string }
> = {
  active: {
    label: "Activate",
    icon: <Play className="mr-2 h-4 w-4" />,
    variant: "default",
    confirm: "Activate this event? Participants will be able to take part.",
  },
  drawing: {
    label: "Start Drawing",
    icon: <Trophy className="mr-2 h-4 w-4" />,
    variant: "default",
    confirm:
      "Move this event into Drawing? This prepares it for the raffle. Winner selection happens in a later step.",
  },
  completed: {
    label: "Mark Completed",
    icon: <CheckCircle2 className="mr-2 h-4 w-4" />,
    variant: "outline",
    confirm: "Mark this event as completed?",
  },
  cancelled: {
    label: "Cancel Event",
    icon: <Ban className="mr-2 h-4 w-4" />,
    variant: "destructive",
    confirm: "Cancel this event? This cannot be undone.",
  },
  draft: {
    label: "Revert to Draft",
    icon: <RotateCcw className="mr-2 h-4 w-4" />,
    variant: "outline",
  },
};

export function LifecycleControls({
  eventId,
  status,
}: {
  eventId: string;
  status: CompetitionEventStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<CompetitionEventStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const transitions = getAllowedEventTransitions(status);

  const handleTransition = async (next: CompetitionEventStatus) => {
    const meta = TRANSITION_META[next];
    if (meta?.confirm && !confirm(meta.confirm)) return;

    setPending(next);
    setError(null);
    try {
      const res = await fetch(`/api/competitions/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });

      if (!res.ok) {
        let message = "Failed to change status";
        try {
          const data = await res.json();
          message = data.error || message;
        } catch {
          // keep default
        }
        throw new Error(message);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Lifecycle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {transitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This event is in a terminal state and can no longer be changed.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {transitions.map((next) => {
              const meta = TRANSITION_META[next];
              return (
                <Button
                  key={next}
                  variant={meta?.variant ?? "outline"}
                  disabled={pending !== null}
                  onClick={() => handleTransition(next)}
                >
                  {pending === next ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    meta?.icon
                  )}
                  {meta?.label ?? COMPETITION_EVENT_STATUS_LABELS[next]}
                </Button>
              );
            })}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}