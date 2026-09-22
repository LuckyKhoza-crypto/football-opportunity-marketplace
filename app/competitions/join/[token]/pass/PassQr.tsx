"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Loader2, QrCode } from "lucide-react";

/**
 * COMP-004 — Participant pass QR.
 *
 * Renders a QR encoding ONLY the opaque verification URL
 * (/competitions/verify/<opaque-token>). The token is minted on demand by
 * POST /api/competitions/[id]/pass-token for the AUTHENTICATED participant's
 * own row — no profile id, participant id, email or event id is ever embedded
 * in the QR. Only the token's SHA-256 digest is stored server-side.
 */
export function PassQr({ eventId }: { eventId: string }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/competitions/${eventId}/pass-token`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to load QR code");
        }
        const token = data.token as string;
        const verifyUrl = `${window.location.origin}/competitions/verify/${encodeURIComponent(token)}`;
        const dataUrl = await QRCode.toDataURL(verifyUrl, {
          width: 220,
          margin: 1,
        });
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load QR code");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return (
    <div className="flex flex-col items-center gap-2">
      {error ? (
        <p className="text-xs text-muted-foreground">{error}</p>
      ) : qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={qrDataUrl}
          alt="Participant verification QR code"
          className="h-44 w-44 rounded bg-white p-1"
        />
      ) : (
        <div className="flex h-44 w-44 items-center justify-center rounded bg-white">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <QrCode className="h-3.5 w-3.5" />
        Event staff can scan this to verify you.
      </p>
    </div>
  );
}