/**
 * Canonical PUBLIC app origin for participant QR payloads (COMP-EMAIL-001).
 *
 * The participant's verification URL is shown on the on-screen pass AND is what
 * the emailed **hosted** QR image encodes. The email image is fetched
 * ANONYMOUSLY by the recipient's mail image proxy (Gmail routes images through
 * `…googleusercontent.com/meips/…`), so the origin embedded in the QR must be a
 * publicly reachable HTTPS URL — never `localhost`, an internal host, a Vercel
 * preview URL guarded by Deployment Protection, or a redirecting apex host.
 *
 * Both the pass-token handler (`lib/competition-attempt-api.ts`) and the public
 * QR image route (`app/api/competitions/verify-qr/[token]/route.ts`) resolve the
 * origin through THIS helper, so the emailed QR and the on-screen pass QR encode
 * an identical payload even when the request arrived on a non-canonical host.
 *
 * Preference order:
 *   1. `NEXT_PUBLIC_APP_URL` — explicit canonical public app URL.
 *   2. `NEXTAUTH_URL`        — documented "Production URL".
 *   3. the request origin    — fallback (local dev / tests).
 *
 * No secrets are read; only the public app origin.
 */
export function resolvePublicAppOrigin(requestOrigin: string): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "";
  if (!configured) return requestOrigin;

  try {
    const { protocol, host } = new URL(configured);
    return `${protocol}//${host}`;
  } catch {
    return requestOrigin;
  }
}
