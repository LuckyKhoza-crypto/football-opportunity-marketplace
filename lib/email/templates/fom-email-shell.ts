/**
 * Minimal, reusable HTML shell for FOM Sports transactional emails.
 *
 * Deliberately simple and email-client safe:
 * - table-based layout
 * - inline styles only (no Tailwind / no external CSS)
 * - no images required
 * - a plain-text fallback is generated alongside the HTML
 *
 * Scope (EMAIL-001): branding, title, body content, an optional primary CTA
 * button, and a footer. No marketing/unsubscribe design is added here.
 */

/** Brand accent (orange), kept in sync with the app's primary brand colour. */
const BRAND_COLOR = "#ea580c";
const TEXT_COLOR = "#1f2937";
const MUTED_COLOR = "#6b7280";
const BORDER_COLOR = "#e5e7eb";
const PAGE_BG = "#f3f4f6";

// Ampersand expressed as a unicode escape so these entity/escape mappings
// survive formatters and are never rewritten as literal HTML entities.
const AMP = "\u0026";

export interface FomEmailCta {
  label: string;
  href: string;
}

export interface FomEmailShellOptions {
  /** The email headline (also used as the plain-text lead). */
  title: string;
  /** HTML body content. Callers are responsible for escaping untrusted input. */
  bodyHtml: string;
  /** Optional primary call-to-action button. */
  cta?: FomEmailCta;
  /** Optional preheader text (hidden preview snippet). */
  preheader?: string;
  /** Optional plain-text body override; defaults to a simple derivation. */
  bodyText?: string;
}

export interface FomEmailShell {
  html: string;
  text: string;
}

/** Escape a string for safe interpolation into HTML text/attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, `${AMP}amp;`)
    .replace(/</g, `${AMP}lt;`)
    .replace(/>/g, `${AMP}gt;`)
    .replace(/"/g, `${AMP}quot;`)
    .replace(/'/g, `${AMP}#39;`);
}

/** Very small HTML-to-text reduction for the plain-text fallback. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(new RegExp(`${AMP}nbsp;`, "g"), " ")
    .replace(new RegExp(`${AMP}lt;`, "g"), "<")
    .replace(new RegExp(`${AMP}gt;`, "g"), ">")
    .replace(new RegExp(`${AMP}quot;`, "g"), '"')
    .replace(new RegExp(`${AMP}#39;`, "g"), "'")
    .replace(new RegExp(`${AMP}amp;`, "g"), AMP)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Build the FOM Sports email shell.
 *
 * Returns both an email-safe HTML document and a plain-text version.
 */
export function buildFomEmailShell({
  title,
  bodyHtml,
  cta,
  preheader,
  bodyText,
}: FomEmailShellOptions): FomEmailShell {
  const safeTitle = escapeHtml(title);
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
        preheader,
      )}</div>`
    : "";

  const ctaHtml = cta
    ? `
              <tr>
                <td style="padding:8px 32px 8px 32px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td style="border-radius:6px;background-color:${BRAND_COLOR};">
                        <a href="${escapeHtml(cta.href)}" target="_blank" rel="noopener noreferrer"
                           style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">
                          ${escapeHtml(cta.label)}
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${PAGE_BG};">
    ${preheaderHtml}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${PAGE_BG};">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid ${BORDER_COLOR};border-radius:8px;overflow:hidden;">
            <!-- Brand header -->
            <tr>
              <td style="background-color:${BRAND_COLOR};padding:20px 32px;">
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:0.3px;">
                  FOM Sports
                </span>
              </td>
            </tr>
            <!-- Title -->
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;color:${TEXT_COLOR};">
                  ${safeTitle}
                </h1>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:8px 32px 20px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${TEXT_COLOR};">
                ${bodyHtml}
              </td>
            </tr>${ctaHtml}
            <!-- Footer -->
            <tr>
              <td style="padding:24px 32px;border-top:1px solid ${BORDER_COLOR};">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${MUTED_COLOR};">
                  This email was sent by FOM Sports.
                </p>
                <p style="margin:6px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${MUTED_COLOR};">
                  You are receiving this transactional message about your FOM Sports account or activity.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textParts = [title, "", bodyText ?? htmlToText(bodyHtml)];
  if (cta) {
    textParts.push("", `${cta.label}: ${cta.href}`);
  }
  textParts.push("", "—", "This email was sent by FOM Sports.");

  return { html, text: textParts.join("\n") };
}