"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSelectedTeamIdFromLocalStorage } from "@/lib/team-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Send, X } from "lucide-react";

interface ContactPlayerDialogProps {
  playerProfileId: string;
  onClose: () => void;
}

interface TeamOpportunity {
  id: string;
  title: string;
  position: string | null;
  status: string;
}

export function ContactPlayerDialog({ playerProfileId, onClose }: ContactPlayerDialogProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const teamId = searchParams.get("team") ?? getSelectedTeamIdFromLocalStorage();
  const [opportunities, setOpportunities] = useState<TeamOpportunity[]>([]);
  const [selectedOpportunity, setSelectedOpportunity] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingOpps, setLoadingOpps] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/team/opportunities${teamId ? `?team_id=${teamId}` : ""}`);
        const data = await res.json();
        if (res.ok) {
          const active = (data.opportunities ?? []).filter((o: TeamOpportunity) =>
            o.status === "active",
          );
          setOpportunities(active);
          if (active.length > 0) setSelectedOpportunity(active[0].id);
        }
      } catch {
        // ignore
      } finally {
        setLoadingOpps(false);
      }
    })();
  }, [teamId]);

  const handleSubmit = useCallback(async () => {
    if (!selectedOpportunity || !message.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_profile_id: playerProfileId,
          opportunity_id: selectedOpportunity,
          message: message.trim(),
          team_id: teamId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send message");
        return;
      }
      router.push(`/messages/${data.conversation_id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [selectedOpportunity, message, loading, playerProfileId, router]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Contact Player</h3>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label className="mb-1 block text-sm font-medium">Opportunity</Label>
            {loadingOpps ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading opportunities...
              </div>
            ) : opportunities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You need an active opportunity to contact players.
              </p>
            ) : (
              <select
                value={selectedOpportunity}
                onChange={(e) => setSelectedOpportunity(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                    {o.position ? ` (${o.position})` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <Label className="mb-1 block text-sm font-medium">Message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Introduce your team and explain why you're interested in this player..."
              rows={5}
              maxLength={5000}
              className="w-full"
            />
            <p className="mt-1 text-right text-[10px] text-muted-foreground">
              {message.length}/5000
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!selectedOpportunity || !message.trim() || loading || loadingOpps}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send Message
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}