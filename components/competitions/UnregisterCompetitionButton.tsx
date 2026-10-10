"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  UserMinus,
} from "lucide-react";

/**
 * T-REM-2 — Player self-unregistration action.
 *
 * Shared by the competition pass (`/competitions/join/[token]/pass`) and the
 * participant entry page (`/competitions/[id]/entry`). Follows the existing
 * player-facing withdrawal pattern (`ApplicationDetailClient`): an explicit
 * confirmation step, a loading state, a success state and a clear server error.
 * `canWithdraw` / `blockedReason` are computed SERVER-SIDE, but the client is
 * never the gate — the withdraw route re-applies every eligibility rule and its
 * response is authoritative.
 *
 * The button posts to `/api/competitions/[id]/withdraw` with NO body: the event
 * comes from the URL and the player from the authenticated session, so no
 * profile id is ever sent from the browser.
 */
export function UnregisterCompetitionButton({
  eventId,
  canWithdraw,
  blockedReason,
}: {
  eventId: string;
  canWithdraw: boolean;
  blockedReason: string | null;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleWithdraw = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/competitions/${eventId}/withdraw`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data.error || "Failed to unregister from this competition",
        );
      }

      setSuccess(true);
      setShowConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  // The server response is authoritative: once it succeeds the participant is
  // no longer registered, regardless of what the page was rendered with.
  if (success) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 rounded-md bg-secondary px-3 py-2 text-sm"
      >
        <CheckCircle2 className="h-4 w-4 text-primary" />
        <span className="font-medium">
          You&apos;ve unregistered from this competition.
        </span>
      </div>
    );
  }

  if (!canWithdraw) {
    if (!blockedReason) return null;
    return (
      <p className="text-center text-xs text-muted-foreground">{blockedReason}</p>
    );
  }

  if (showConfirm) {
    return (
      <div className="space-y-3">
        <p className="text-center text-sm font-medium text-destructive">
          Unregister from this competition?
        </p>
        <p className="text-center text-xs text-muted-foreground">
          This cannot be undone. You will no longer be registered and event
          staff will not be able to check you in.
        </p>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-center gap-2">
          <Button
            variant="destructive"
            onClick={handleWithdraw}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Unregistering...
              </>
            ) : (
              <>
                <UserMinus className="mr-2 h-4 w-4" />
                Yes, Unregister
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setShowConfirm(false);
              setError(null);
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <Button
        variant="outline"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setShowConfirm(true)}
      >
        <UserMinus className="mr-2 h-4 w-4" />
        Unregister
      </Button>
    </div>
  );
}
