"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CompetitionDrawingView } from "@/types/competition-drawing";
import type { CompetitionEventStatus } from "@/types";
import { isEventDrawable } from "@/lib/competition-drawing";
import { Trophy, Loader2, Users, CheckCircle2 } from "lucide-react";

/**
 * COMP-006 — Competition drawing.
 *
 * Shown to the event creator AND assigned ambassadors. Two states:
 *
 *   * No drawing yet + a drawable event + qualified participants:
 *       a "Start Drawing" action with a confirmation step that shows how many
 *       qualified participants are eligible.
 *   * A drawing exists:
 *       the immutable winner result (name, drawn at, eligible count).
 *
 * The browser never selects the winner or the eligible count — both are
 * produced server-side. This component only collects the intent to draw and
 * renders the server result.
 */

export function DrawingPanel({
  eventId,
  status,
  qualifiedCount,
  initialDrawing,
}: {
  eventId: string;
  status: CompetitionEventStatus;
  qualifiedCount: number;
  initialDrawing: CompetitionDrawingView | null;
}) {
  const router = useRouter();
  const [drawing, setDrawing] = useState<CompetitionDrawingView | null>(
    initialDrawing,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startDrawing = async () => {
    const prompt =
      `Start Drawing?\n\n` +
      `There are ${qualifiedCount} qualified participant${
        qualifiedCount === 1 ? "" : "s"
      } eligible to win.\n\n` +
      `Once the drawing starts, the winner will be selected and cannot be ` +
      `changed.`;
    if (!confirm(prompt)) return;

    setPending(true);
    setError(null);
    try {
      // The POST body is intentionally empty: the winner is chosen server-side.
      const res = await fetch(`/api/competitions/${eventId}/draw`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to start the drawing");
      }
      setDrawing(data.drawing as CompetitionDrawingView);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  };

  // ── Result state ───────────────────────────────────────────────
  if (drawing) {
    return (
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="h-5 w-5 text-primary" />
            Competition Drawing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-primary/5 px-4 py-6 text-center">
            <p className="text-sm font-medium text-muted-foreground">Winner</p>
            <p className="mt-1 text-3xl font-bold">
              {drawing.winnerName ?? "Participant"}
            </p>
          </div>
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              Drawing completed {formatDateTime(drawing.drawnAt)}
            </p>
            <p className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              {drawing.qualifiedParticipantCount} qualified participant
              {drawing.qualifiedParticipantCount === 1 ? "" : "s"} were eligible
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Start-drawing state ────────────────────────────────────────
  const drawable = isEventDrawable(status);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Trophy className="h-5 w-5 text-primary" />
          Start Drawing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {qualifiedCount > 0
            ? `${qualifiedCount} qualified participant${
                qualifiedCount === 1 ? "" : "s"
              } eligible to win. Starting the drawing selects one winner at random.`
            : "No qualified participants yet. Participants must pass the challenge before a drawing can run."}
        </p>

        {drawable && qualifiedCount > 0 ? (
          <Button onClick={startDrawing} disabled={pending}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trophy className="mr-2 h-4 w-4" />
            )}
            Start Drawing
          </Button>
        ) : (
          <Button disabled>
            <Trophy className="mr-2 h-4 w-4" />
            Start Drawing
          </Button>
        )}

        {!drawable && (
          <p className="text-sm text-muted-foreground">
            This competition is not currently in a state that can be drawn.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}