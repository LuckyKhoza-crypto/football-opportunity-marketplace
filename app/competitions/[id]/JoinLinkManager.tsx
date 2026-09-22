"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, QrCode, Copy, Check, Trash2, Link2 } from "lucide-react";
import type { CompetitionAmbassadorWithProfile } from "@/types";

/**
 * COMP-003 — Competition join link & QR management (creator only).
 *
 * The event creator generates a reusable join link per ambassador. The RAW
 * token is returned by the server exactly once (at creation) and is embedded in
 * the public join URL and QR code — it is never fetched again. Revoking a link
 * disables registration without deleting its history.
 *
 * All authorization is re-checked server-side; this UI is only rendered for the
 * event creator.
 */

/**
 * The public shape returned by the join-link list API. It deliberately omits
 * token_hash (never exposed after creation).
 */
interface JoinLinkWithAmbassador {
  id: string;
  event_id: string;
  ambassador_id: string;
  revoked_at: string | null;
  created_at: string;
  ambassador: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
}

export function JoinLinkManager({
  eventId,
  ambassadors,
  initialLinks,
}: {
  eventId: string;
  ambassadors: CompetitionAmbassadorWithProfile[];
  initialLinks: JoinLinkWithAmbassador[];
}) {
  const router = useRouter();
  const [links, setLinks] = useState<JoinLinkWithAmbassador[]>(initialLinks);
  // Raw tokens are kept only in-memory for links created in THIS session.
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (ambassadorId: string) => {
    setCreatingFor(ambassadorId);
    setError(null);
    try {
      const res = await fetch(`/api/competitions/${eventId}/join-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ambassadorId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate link");
      }

      const link = data.link as JoinLinkWithAmbassador;
      setTokens((prev) => ({ ...prev, [link.id]: data.token as string }));
      setLinks((prev) => [link, ...prev]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreatingFor(null);
    }
  };

  const handleRevoke = async (linkId: string) => {
    if (!confirm("Revoke this competition join link?")) return;
    setRevokingId(linkId);
    setError(null);
    try {
      const res = await fetch(
        `/api/competitions/${eventId}/join-links/${linkId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to revoke link");
      }
      setLinks((prev) =>
        prev.map((l) =>
          l.id === linkId ? { ...l, revoked_at: new Date().toISOString() } : l,
        ),
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Link2 className="h-5 w-5 text-primary" />
          Competition Join Links
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Generate a reusable join link and QR code for each ambassador. Players
          scan the QR to enter the competition. Links stay valid until revoked.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {ambassadors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add an ambassador above to generate a join link.
          </p>
        ) : (
          <ul className="space-y-4">
            {ambassadors.map((ambassador) => {
              const ambassadorLinks = links.filter(
                (l) => l.ambassador_id === ambassador.id,
              );
              return (
                <li key={ambassador.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                      size="sm"
                      onClick={() => handleGenerate(ambassador.id)}
                      disabled={creatingFor === ambassador.id}
                    >
                      {creatingFor === ambassador.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <QrCode className="mr-2 h-4 w-4" />
                      )}
                      Generate Link
                    </Button>
                  </div>

                  {ambassadorLinks.length > 0 && (
                    <div className="mt-4 space-y-4">
                      {ambassadorLinks.map((link) => (
                        <JoinLinkRow
                          key={link.id}
                          link={link}
                          rawToken={tokens[link.id] ?? null}
                          revoking={revokingId === link.id}
                          onRevoke={() => handleRevoke(link.id)}
                        />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function JoinLinkRow({
  link,
  rawToken,
  revoking,
  onRevoke,
}: {
  link: JoinLinkWithAmbassador;
  rawToken: string | null;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const revoked = link.revoked_at != null;

  const joinUrl = rawToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/competitions/join/${encodeURIComponent(rawToken)}`
    : null;

  useEffect(() => {
    if (!joinUrl) return;
    let cancelled = false;
    QRCode.toDataURL(joinUrl, { width: 220, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  const handleCopy = async () => {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the input below remains selectable.
    }
  };

  return (
    <div className={`rounded-md bg-muted/40 p-3 ${revoked ? "opacity-60" : ""}`}>
      {rawToken && joinUrl ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center gap-2">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="Competition join QR code"
                className="h-40 w-40 rounded bg-white p-1"
              />
            ) : (
              <div className="flex h-40 w-40 items-center justify-center rounded bg-white">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={joinUrl} className="text-xs" />
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied ? (
                  <Check className="mr-1 h-3.5 w-3.5" />
                ) : (
                  <Copy className="mr-1 h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy Link"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This is the only time the full link is shown — copy or save the QR
              now.
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {revoked
            ? "This link has been revoked."
            : "Full link hidden for security. Generate a new link to get a QR code."}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Created {new Date(link.created_at).toLocaleDateString("en-US")}
          {revoked ? " · Revoked" : " · Active"}
        </span>
        {!revoked && (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={onRevoke}
            disabled={revoking}
          >
            {revoking ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3.5 w-3.5" />
            )}
            Revoke
          </Button>
        )}
      </div>
    </div>
  );
}