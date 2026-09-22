"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * COMP-003 — Register-for-competition button.
 *
 * Sends ONLY the opaque join token to the protected
 * POST /api/competitions/join. The server derives the event, ambassador and
 * profile — the client can never spoof event_id/profile_id/ambassador_id.
 * On success the participant is taken to their private pass.
 */
export function JoinCompetitionButton({ token }: { token: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/competitions/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to register for competition");
      }

      router.push(
        `/competitions/join/${encodeURIComponent(token)}/pass`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-3 text-center">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        size="lg"
        className="w-full sm:w-auto"
        onClick={handleJoin}
        disabled={submitting}
      >
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Enter Competition
      </Button>
    </div>
  );
}