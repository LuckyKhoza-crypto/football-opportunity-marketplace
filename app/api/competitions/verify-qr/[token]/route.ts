import { NextResponse } from "next/server";
import { buildCompetitionVerifyUrl } from "@/lib/competition-join";
import { resolvePublicAppOrigin } from "@/lib/competition-public-origin";
import { renderVerificationQrPng } from "@/lib/email/qr";

/**
 * COMP-EMAIL-001 — Public hosted verification-QR image.
 *
 * The competition-registration confirmation email references this route with a
 * plain `<img src="https://…/api/competitions/verify-qr/<token>">`:
 *   * Gmail strips `data:` URI images from the HTML body, and
 *   * Brevo's transactional API does not support Content-ID (`cid:`) inline
 *     images (it never sets a Content-ID header),
 * so a hosted image is the only embedding that renders in Gmail.
 *
 * The PNG is re-rendered from the SAME opaque token the participant pass uses —
 * via `buildCompetitionVerifyUrl` (the single source of truth for the payload) —
 * so the emailed QR and the on-screen pass QR encode an identical payload. Only
 * the opaque token is read; no profile id, participant id, email or event id is
 * used or embedded.
 *
 * This route is intentionally PUBLIC (mail image proxies are unauthenticated).
 *
 * SECURITY:
 *   * The token is never logged and never echoed in an error body.
 *   * Responses are `no-store` so intermediaries do not cache the token-bearing
 *     image. (The recipient's mail provider still fetches the URL — that is
 *     inherent to any hosted-image approach. The visible verification code in
 *     the email remains the fallback when images are blocked.)
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token?.trim()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    // Build the payload from the SAME canonical public origin the pass/email use
    // (not the raw fetch host), so the emailed QR and the on-screen pass QR encode
    // an identical payload even behind an apex→www redirect or a proxy.
    const origin = resolvePublicAppOrigin(new URL(request.url).origin);
    const payload = buildCompetitionVerifyUrl(origin, token);
    const png = await renderVerificationQrPng(payload);

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "Content-Disposition": 'inline; filename="registration-qr.png"',
      },
    });
  } catch {
    // Never surface or log the token.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
