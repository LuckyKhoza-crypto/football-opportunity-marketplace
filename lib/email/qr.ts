/**
 * Server-side helper for rendering a QR code as an email-compatible PNG.
 *
 * Why this exists (COMP-EMAIL-001):
 *   * Gmail renders `data:` URI images inconsistently — its webmail strips them
 *     from the HTML body, which is why the inline `data:image/png;base64,…`
 *     embedding did not display.
 *   * Brevo's v3 transactional API does NOT support Content-ID (`cid:`) inline
 *     images — it never sets a Content-ID MIME header, so a `cid:` reference
 *     arrives as a dangling/broken attachment.
 *
 * The QR is therefore rendered here and served from a PUBLIC app route
 * (`app/api/competitions/verify-qr/[token]/route.ts`) that the email references
 * with a plain `<img src="https://…">` — the only approach that renders in Gmail.
 *
 * The app's existing QR rendering (`app/competitions/join/[token]/pass/PassQr.tsx`
 * and `app/competitions/[id]/JoinLinkManager.tsx`) is CLIENT-only. The `qrcode`
 * dependency it uses is also usable in Node (it renders PNGs via the bundled
 * `pngjs`), so the server produces the identical QR payload as the pass without
 * adding a dependency or a second credential. Nothing here is persisted.
 */

import "server-only";
import QRCode from "qrcode";

/** Matches the participant pass QR dimensions (see PassQr.tsx). */
export const VERIFICATION_QR_WIDTH = 220;
export const VERIFICATION_QR_MARGIN = 1;

/**
 * Render the EXACT payload string (e.g. a verification URL) as PNG bytes.
 *
 * Callers must pass the same string that was displayed on the participant pass
 * so the encoded content is byte-for-byte identical.
 *
 * @throws when the payload is empty or the QR cannot be rendered.
 */
export async function renderVerificationQrPng(payload: string): Promise<Buffer> {
  const value = payload?.trim();
  if (!value) {
    throw new Error("A QR payload is required.");
  }

  return QRCode.toBuffer(value, {
    type: "png",
    width: VERIFICATION_QR_WIDTH,
    margin: VERIFICATION_QR_MARGIN,
  });
}
