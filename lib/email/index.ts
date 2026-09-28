/**
 * Public entry points for the server-only FOM Sports email infrastructure.
 *
 * Import from `@/lib/email` in server code. The Brevo provider detail lives in
 * `@/lib/email/providers/brevo` and should not be imported directly by feature
 * code.
 */

export type {
  EmailRecipient,
  TransactionalEmail,
  SendTransactionalEmailResult,
} from "@/lib/email/types";

export {
  EmailConfigError,
  EmailError,
  EmailProviderError,
  EmailProviderRequestError,
  EmailRecipientError,
} from "@/lib/email/errors";
export type { EmailErrorCode } from "@/lib/email/errors";

export { getEmailConfig, isEmailConfigured } from "@/lib/email/config";
export type { EmailConfig } from "@/lib/email/config";

export {
  sendTransactionalEmail,
  isValidRecipientEmail,
} from "@/lib/email/email-service";

export { buildFomEmailShell, escapeHtml } from "@/lib/email/templates/fom-email-shell";
export type {
  FomEmailCta,
  FomEmailShell,
  FomEmailShellOptions,
} from "@/lib/email/templates/fom-email-shell";