/**
 * EMAIL-003 — Typed notification `data` payload.
 *
 * `notifications.data` is a nullable JSONB blob carrying ONLY non-sensitive,
 * email-safe presentation metadata. It exists so downstream consumers (notably
 * the email layer) can reliably identify and render specialized notifications
 * WITHOUT resorting to fragile text heuristics.
 *
 * Rules:
 *   * `data.kind` is the discriminator. It is an explicit, closed set.
 *   * Never store internal identifiers, secrets, or recipient emails here.
 *   * Every field is optional presentation copy — consumers must degrade
 *     gracefully when fields are missing.
 *
 * This module is intentionally dependency-free so it can be imported from both
 * client and server code.
 */

/** Discriminator for typed notification payloads. */
export type NotificationDataKind = "outreach" | "application_status_changed";

/**
 * Payload for an outreach-originated `message_received` notification:
 * a team contacted a player about an opportunity.
 */
export interface OutreachNotificationData {
  kind: "outreach";
  /** Public team display name (never the team's internal id). */
  teamName?: string;
  /** Opportunity title shown to the player. */
  opportunityTitle?: string;
  /** Opportunity role/position label, when available. */
  opportunityRole?: string | null;
  /** Player display name, when available. */
  playerName?: string;
}

/**
 * The closed set of application statuses that may appear in an
 * `application_status_changed` payload. Mirrors the application model so a
 * payload can be validated without importing the (heavier) `@/types` module.
 */
export type ApplicationStatusValue =
  | "pending"
  | "reviewing"
  | "accepted"
  | "rejected"
  | "withdrawn";

const APPLICATION_STATUS_VALUES: readonly ApplicationStatusValue[] = [
  "pending",
  "reviewing",
  "accepted",
  "rejected",
  "withdrawn",
];

/**
 * EMAIL-004 payload for an `application_status_changed` notification: a player's
 * application moved to a new status.
 *
 * `status` carries the ACTUAL enum value (e.g. `"rejected"`), never a
 * re-worded label — downstream copy may phrase it differently while the stored
 * value stays canonical.
 */
export interface ApplicationStatusNotificationData {
  kind: "application_status_changed";
  /** Canonical status value from the application model, when available. */
  status?: ApplicationStatusValue;
  /** Public team display name (never the team's internal id). */
  teamName?: string;
  /** Opportunity title, when available. */
  opportunityTitle?: string;
  /** Opportunity position code (e.g. "ST"), when available. */
  opportunityRole?: string | null;
  /** Player display name, when available. */
  playerName?: string;
}

/** Any typed notification payload currently supported. */
export type NotificationData =
  | OutreachNotificationData
  | ApplicationStatusNotificationData;

/**
 * Narrow an unknown JSON value (as read back from JSONB) to a typed payload.
 *
 * Returns null unless the value is a plain object with a recognized `kind`.
 * This is deliberately strict so unknown/future payloads fall back to the
 * generic rendering path rather than being misinterpreted.
 */
export function parseNotificationData(value: unknown): NotificationData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "outreach") {
    return {
      kind: "outreach",
      teamName: asOptionalString(record.teamName),
      opportunityTitle: asOptionalString(record.opportunityTitle),
      opportunityRole: asOptionalString(record.opportunityRole),
      playerName: asOptionalString(record.playerName),
    };
  }
  if (record.kind === "application_status_changed") {
    return {
      kind: "application_status_changed",
      status: asApplicationStatus(record.status),
      teamName: asOptionalString(record.teamName),
      opportunityTitle: asOptionalString(record.opportunityTitle),
      opportunityRole: asOptionalString(record.opportunityRole),
      playerName: asOptionalString(record.playerName),
    };
  }
  return null;
}

/** Whether a payload represents an outreach-originated notification. */
export function isOutreachNotificationData(
  value: unknown,
): value is OutreachNotificationData {
  return parseNotificationData(value)?.kind === "outreach";
}

/** Whether a payload represents an application-status-changed notification. */
export function isApplicationStatusNotificationData(
  value: unknown,
): value is ApplicationStatusNotificationData {
  return parseNotificationData(value)?.kind === "application_status_changed";
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Narrow an unknown value to a canonical application status, else undefined. */
function asApplicationStatus(
  value: unknown,
): ApplicationStatusValue | undefined {
  if (typeof value !== "string") return undefined;
  return APPLICATION_STATUS_VALUES.includes(value as ApplicationStatusValue)
    ? (value as ApplicationStatusValue)
    : undefined;
}
