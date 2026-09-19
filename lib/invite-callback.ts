/**
 * Safe callback URL validation for authentication continuation.
 *
 * TEAM-003 uses NextAuth's existing `callbackUrl` mechanism to preserve
 * the original invite URL through the login flow. This helper ensures
 * the callback can never be an open redirect: only relative internal
 * paths are accepted.
 *
 * Rejected forms:
 *   - absolute URLs            https://malicious-site.com
 *   - protocol-relative URLs   //malicious-site.com
 *   - scheme-relative URLs     javascript:alert(1)
 *   - backslash tricks         \/\/malicious-site.com
 *   - empty / whitespace
 */

/**
 * True when the given value is a safe relative internal path.
 *
 * A safe path:
 *   - is a non-empty string
 *   - starts with a single "/"
 *   - does NOT start with "//" (protocol-relative)
 *   - does NOT contain a backslash (browser normalization trick)
 *   - does NOT contain a scheme like "http:", "https:", "javascript:", etc.
 */
export function isSafeCallbackUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  if (trimmed.includes("\\")) return false;
  // Reject any scheme-looking prefix (e.g. "http:", "https:", "javascript:").
  // A relative path like "/team/join/abc" never contains ":" in the first segment.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;
  // Reject any embedded "://" anywhere in the path (e.g. "/team/join/https://evil.com").
  if (trimmed.includes("://")) return false;
  return true;
}

/**
 * Return the safe callback URL, or the fallback when the value is unsafe.
 */
export function getSafeCallbackUrl(
  value: string | null | undefined,
  fallback: string,
): string {
  return isSafeCallbackUrl(value) ? value!.trim() : fallback;
}