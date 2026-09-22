"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, X, Loader2, Users } from "lucide-react";
import type { CompetitionAmbassadorWithProfile } from "@/types";

/**
 * COMP-002 — Ambassador management (creator only).
 *
 * The event creator can add an existing account as an ambassador by email and
 * remove ambassadors. Ambassador access comes exclusively from
 * competition_ambassadors — never from profiles.role. All authorization is
 * re-checked server-side; this UI is only rendered for the creator.
 */
export function AmbassadorManager({
  eventId,
  ambassadors,
}: {
  eventId: string;
  ambassadors: CompetitionAmbassadorWithProfile[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleAdd = async () => {
    const identifier = email.trim();
    if (!identifier) {
      setError("Enter an email address.");
      return;
    }

    setAdding(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/competitions/${eventId}/ambassadors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: identifier }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Failed to add ambassador");
      }

      setEmail("");
      setSuccess(
        `${data.profile?.full_name || data.profile?.email || "Ambassador"} added.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (profileId: string) => {
    if (!confirm("Remove this ambassador from the event?")) return;

    setRemovingId(profileId);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/competitions/${eventId}/ambassadors/${profileId}`,
        { method: "DELETE" },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove ambassador");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5 text-primary" />
          Ambassadors
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="ambassador-email">
            Add an existing account by email
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="ambassador-email"
              type="email"
              placeholder="ambassador@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
            <Button onClick={handleAdd} disabled={adding}>
              {adding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The account must already exist. Ambassadors can view the event but
            cannot edit it or manage ambassadors.
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-primary">{success}</p>}

        {ambassadors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No ambassadors assigned yet.
          </p>
        ) : (
          <ul className="divide-y">
            {ambassadors.map((ambassador) => (
              <li
                key={ambassador.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {ambassador.profile?.full_name ||
                      ambassador.profile?.email ||
                      "Unknown account"}
                  </p>
                  {ambassador.profile?.email && (
                    <p className="truncate text-xs text-muted-foreground">
                      {ambassador.profile.email}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={removingId === ambassador.profile_id}
                  onClick={() => handleRemove(ambassador.profile_id)}
                >
                  {removingId === ambassador.profile_id ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="mr-1 h-3.5 w-3.5" />
                  )}
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
