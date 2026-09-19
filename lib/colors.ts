/**
 * Centralized color tokens for the app.
 *
 * To change the brand accent color across the entire app, update the
 * `--primary` CSS variable in `app/globals.css` (this controls all
 * default buttons, `text-primary`, `bg-primary`, etc.).
 *
 * For semantic colors that use Tailwind's built-in palette (e.g. status
 * badges, match classification badges, success messages), update the
 * constants below. All hardcoded green/emerald classes in the codebase
 * should reference these constants instead of using Tailwind classes
 * directly.
 */

// ─── Brand Accent ────────────────────────────────────────────────
// The primary brand color. Used by the `Button` default variant,
// `text-primary`, `bg-primary`, `ring-primary`, etc.
// Currently: Orange (hue ~30 in OKLCH)
export const BRAND = {
  primary: "bg-primary text-primary-foreground",
  primaryHover: "hover:bg-primary/90",
  text: "text-primary",
  bgSoft: "bg-primary/10",
  borderSoft: "border-primary/20",
  ring: "ring-primary",
} as const;

// ─── Semantic Status Colors ──────────────────────────────────────
// Used for status badges (opportunity status, application status).
// "active" / "accepted" use the brand accent color.
export const STATUS_COLORS = {
  active: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  accepted: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  reviewing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  closed: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  withdrawn: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
} as const;

// ─── Match Classification Colors ─────────────────────────────────
// Used for match quality badges (Excellent, Strong, Possible, etc.)
export const CLASSIFICATION_COLORS = {
  excellent: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  strong: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  possible: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  weak: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  poor: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
} as const;

// ─── Match Quality Text Colors ───────────────────────────────────
// Used for match quality text labels (e.g. "Excellent", "Good")
export const MATCH_QUALITY_TEXT_COLORS = {
  excellent: "text-orange-600 dark:text-orange-400",
  strong: "text-orange-600 dark:text-orange-400",
  possible: "text-blue-600 dark:text-blue-400",
  weak: "text-yellow-600 dark:text-yellow-400",
  poor: "text-red-600 dark:text-red-400",
} as const;

// ─── Match Quality Background Colors ─────────────────────────────
export const MATCH_QUALITY_BG_COLORS = {
  excellent: "bg-orange-100 dark:bg-orange-900/30",
  strong: "bg-orange-100 dark:bg-orange-900/30",
  possible: "bg-blue-100 dark:bg-blue-900/30",
  weak: "bg-yellow-100 dark:bg-yellow-900/30",
  poor: "bg-red-100 dark:bg-red-900/30",
} as const;

// ─── Success / Positive Feedback ─────────────────────────────────
// Used for success messages, "copied to clipboard", accepted states, etc.
export const SUCCESS_COLORS = {
  text: "text-orange-600 dark:text-orange-400",
  textStrong: "text-orange-800 dark:text-orange-300",
  textMuted: "text-orange-700 dark:text-orange-400",
  bg: "bg-orange-50 dark:bg-orange-950/20",
  border: "border-orange-200 dark:border-orange-900/50",
  icon: "text-orange-600 dark:text-orange-400",
  dot: "bg-orange-500",
  check: "text-orange-500",
} as const;

// ─── Notification Icon Colors ────────────────────────────────────
export const NOTIFICATION_ICON_COLORS = {
  applicationReceived: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  applicationStatusChanged: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  messageReceived: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  default: "bg-muted text-muted-foreground",
} as const;