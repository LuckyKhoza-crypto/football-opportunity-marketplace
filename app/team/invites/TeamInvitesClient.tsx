"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Link2, Plus, RefreshCw, ShieldOff, Check } from "lucide-react";

export interface InviteListItem {
  id: string;
  team_profile_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  state: "pending" | "revoked" | "expired";
}

interface TeamInvitesClientProps {
  teamId: string;
  initialInvites: InviteListItem[];
}

export function TeamInvitesClient({
  teamId,
  initialInvites,
}: TeamInvitesClientProps) {
  const [invites, setInvites] = useState<InviteListItem[]>(initialInvites);
  const [creating, setCreating] = useState(false);
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleCreateInvite() {
    setCreating(true);
    setError(null);
    setNewInviteUrl(null);

    try {
      const response = await fetch("/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_profile_id: teamId }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Failed to create invite link.");
        return;
      }

      const fullUrl = `${window.location.origin}${data.join_url}`;
      setNewInviteUrl(fullUrl);

      // Refresh the invite list
      const listResponse = await fetch(`/api/team/invites?team_id=${teamId}`);
      if (listResponse.ok) {
        const listData = await listResponse.json();
        setInvites(listData.invites ?? []);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!newInviteUrl) return;
    try {
      await navigator.clipboard.writeText(newInviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; fall back to selecting the input
      setCopied(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    setRevokingId(inviteId);
    setError(null);

    try {
      const response = await fetch(`/api/team/invites/${inviteId}/revoke`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Failed to revoke invite link.");
        return;
      }

      // Update local state
      setInvites((prev) =>
        prev.map((inv) =>
          inv.id === inviteId
            ? { ...inv, revoked_at: new Date().toISOString(), state: "revoked" }
            : inv,
        ),
      );
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setRevokingId(null);
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div className="space-y-6">
      {/* Create new invite */}
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Create a new invite link</h3>
          <Button
            onClick={handleCreateInvite}
            disabled={creating}
            size="sm"
          >
            {creating ? (
              <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            {creating ? "Creating…" : "Create Link"}
          </Button>
        </div>

        {newInviteUrl && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Share this link with players. It remains usable until it expires
              or you revoke it.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={newInviteUrl}
                onFocus={(e) => e.target.select()}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopy}
                title="Copy link"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-orange-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            {copied && (
              <p className="text-xs text-orange-600">Copied to clipboard!</p>
            )}
          </div>
        )}

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      {/* Invite list */}
      <div>
        <h3 className="mb-3 font-medium">Existing invite links</h3>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No invite links yet. Create one above to start recruiting players.
          </p>
        ) : (
          <div className="space-y-3">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {invite.state === "pending" ? "Active" : invite.state === "revoked" ? "Revoked" : "Expired"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDate(invite.created_at)} · Expires{" "}
                      {formatDate(invite.expires_at)}
                    </p>
                  </div>
                </div>
                {invite.state === "pending" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRevoke(invite.id)}
                    disabled={revokingId === invite.id}
                  >
                    {revokingId === invite.id ? (
                      <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldOff className="mr-1 h-4 w-4" />
                    )}
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}