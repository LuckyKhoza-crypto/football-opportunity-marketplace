import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BULK_EMAIL_MESSAGE_MAX_LENGTH,
  BULK_EMAIL_SUBJECT_MAX_LENGTH,
} from "@/types/competition-bulk-email";
import { isValidRecipientEmail } from "@/lib/email/email-service";
import {
  deriveBatchState,
  isDeliverableRecipientEmail,
  messageToHtml,
  normalizeRecipientEmail,
  resolveBulkEmailAudience,
  validateBulkEmailInput,
} from "@/lib/competition-bulk-email";

/**
 * T-BULK-1 — pure helpers.
 *
 * These are the policy pieces shared by the UI and the server: input validation,
 * address normalization/deduplication, audience resolution (the T-REM-1/4 active
 * rule), HTML escaping and the outcome-state derivation.
 */

describe("T-BULK-1: subject/message validation", () => {
  it("accepts and trims a valid subject and message", () => {
    const result = validateBulkEmailInput({
      subject: "  Arrival instructions  ",
      message: "  Bring boots.\n  ",
    });
    expect(result).toEqual({
      ok: true,
      subject: "Arrival instructions",
      message: "Bring boots.",
    });
  });

  it("rejects a missing/empty/blank subject or message", () => {
    expect(validateBulkEmailInput({ subject: "", message: "x" }).ok).toBe(false);
    expect(validateBulkEmailInput({ subject: "   ", message: "x" }).ok).toBe(
      false,
    );
    expect(validateBulkEmailInput({ subject: "x", message: "" }).ok).toBe(false);
    expect(
      validateBulkEmailInput({ subject: "x", message: "   \n  " }).ok,
    ).toBe(false);
    expect(validateBulkEmailInput({ subject: 5, message: null }).ok).toBe(false);
  });

  it("rejects a subject containing a line break (header injection guard)", () => {
    const result = validateBulkEmailInput({
      subject: "Reminder\r\nBcc: someone@example.com",
      message: "hello",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/single line/i);
  });

  it("limits the subject and the message length", () => {
    const longSubject = validateBulkEmailInput({
      subject: "s".repeat(BULK_EMAIL_SUBJECT_MAX_LENGTH + 1),
      message: "hello",
    });
    expect(longSubject.ok).toBe(false);
    if (!longSubject.ok) {
      expect(longSubject.error).toContain(
        String(BULK_EMAIL_SUBJECT_MAX_LENGTH),
      );
    }

    const longMessage = validateBulkEmailInput({
      subject: "ok",
      message: "m".repeat(BULK_EMAIL_MESSAGE_MAX_LENGTH + 1),
    });
    expect(longMessage.ok).toBe(false);

    // Exactly at the limit is allowed.
    expect(
      validateBulkEmailInput({
        subject: "s".repeat(BULK_EMAIL_SUBJECT_MAX_LENGTH),
        message: "m".repeat(BULK_EMAIL_MESSAGE_MAX_LENGTH),
      }).ok,
    ).toBe(true);
  });
});

describe("T-BULK-1: recipient address handling", () => {
  it("normalizes by trimming and lowercasing", () => {
    expect(normalizeRecipientEmail("  Player@Example.COM ")).toBe(
      "player@example.com",
    );
    expect(normalizeRecipientEmail("   ")).toBeNull();
    expect(normalizeRecipientEmail(null)).toBeNull();
    expect(normalizeRecipientEmail(undefined)).toBeNull();
  });

  it("rejects missing/malformed addresses", () => {
    expect(isDeliverableRecipientEmail("player@example.com")).toBe(true);
    expect(isDeliverableRecipientEmail(" player@example.com ")).toBe(true);
    expect(isDeliverableRecipientEmail("nope")).toBe(false);
    expect(isDeliverableRecipientEmail("no@domain")).toBe(false);
    expect(isDeliverableRecipientEmail("a b@example.com")).toBe(false);
    expect(isDeliverableRecipientEmail("")).toBe(false);
    expect(isDeliverableRecipientEmail(null)).toBe(false);
    expect(isDeliverableRecipientEmail(`${"a".repeat(320)}@example.com`)).toBe(
      false,
    );
  });

  it("agrees with the EMAIL-001 validator (no divergent policy)", () => {
    const samples = [
      "player@example.com",
      "Player@Example.com",
      "nope",
      "no@domain",
      "a b@example.com",
      "",
      "x@y.z",
    ];
    for (const sample of samples) {
      expect(isDeliverableRecipientEmail(sample)).toBe(
        isValidRecipientEmail(sample),
      );
    }
  });
});

describe("T-BULK-1: audience resolution", () => {
  const row = (
    overrides: Partial<{
      profileId: string;
      email: string | null;
      fullName: string | null;
      removedAt: string | null;
    }> = {},
  ) => ({
    profileId: overrides.profileId ?? "p1",
    email: overrides.email === undefined ? "player@example.com" : overrides.email,
    fullName: overrides.fullName ?? "Ada",
    removedAt: overrides.removedAt ?? null,
  });

  it("includes active participants (check-in state is irrelevant)", () => {
    const { recipients, summary } = resolveBulkEmailAudience([
      row({ profileId: "p1", email: "one@example.com" }),
      row({ profileId: "p2", email: "two@example.com" }),
    ]);

    expect(recipients.map((r) => r.email)).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
    expect(summary).toEqual({
      activeCount: 2,
      eligibleCount: 2,
      invalidCount: 0,
      duplicateCount: 0,
    });
  });

  it("excludes soft-removed participants (removed_at IS NOT NULL)", () => {
    const { recipients, summary } = resolveBulkEmailAudience([
      row({ profileId: "p1", email: "one@example.com" }),
      row({
        profileId: "p2",
        email: "removed@example.com",
        removedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);

    expect(recipients.map((r) => r.email)).toEqual(["one@example.com"]);
    expect(summary.activeCount).toBe(1);
    expect(summary.eligibleCount).toBe(1);
  });

  it("skips missing/invalid addresses and reports the count", () => {
    const { recipients, summary } = resolveBulkEmailAudience([
      row({ profileId: "p1", email: "one@example.com" }),
      row({ profileId: "p2", email: null }),
      row({ profileId: "p3", email: "   " }),
      row({ profileId: "p4", email: "not-an-email" }),
    ]);

    expect(recipients.map((r) => r.profileId)).toEqual(["p1"]);
    expect(summary).toEqual({
      activeCount: 4,
      eligibleCount: 1,
      invalidCount: 3,
      duplicateCount: 0,
    });
  });

  it("deduplicates by normalized address and reports skipped duplicates", () => {
    const { recipients, summary } = resolveBulkEmailAudience([
      row({ profileId: "p1", email: "Player@Example.com" }),
      row({ profileId: "p2", email: " player@example.COM " }),
    ]);

    expect(recipients).toEqual([
      { profileId: "p1", email: "player@example.com", name: "Ada" },
    ]);
    expect(summary).toEqual({
      activeCount: 2,
      eligibleCount: 1,
      invalidCount: 0,
      duplicateCount: 1,
    });
  });

  it("returns an empty, all-zero resolution for no rows", () => {
    expect(resolveBulkEmailAudience([])).toEqual({
      recipients: [],
      summary: {
        activeCount: 0,
        eligibleCount: 0,
        invalidCount: 0,
        duplicateCount: 0,
      },
    });
  });
});


describe("T-BULK-1: message rendering escapes untrusted input", () => {
  it("escapes HTML and keeps paragraph/line structure", () => {
    const html = messageToHtml(
      "Hi <b>all</b> & welcome.\nArrive early.\n\n<script>alert('x')</script> then go.",
    );

    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;all&lt;/b&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("<br />");
    expect(html.match(/<p style=/g)?.length).toBe(2);
  });

  it("never allows an injected anchor or image", () => {
    const html = messageToHtml('<a href="https://evil.example">click</a>');
    expect(html).not.toContain("<a ");
    expect(html).toContain("&lt;a href=");
  });
});

describe("T-BULK-1: batch state derivation", () => {
  it("never implies delivery for pending or partial batches", () => {
    expect(
      deriveBatchState({
        eligibleCount: 0,
        acceptedCount: 0,
        failedCount: 0,
        pendingCount: 0,
      }),
    ).toBe("empty");
    expect(
      deriveBatchState({
        eligibleCount: 3,
        acceptedCount: 1,
        failedCount: 0,
        pendingCount: 2,
      }),
    ).toBe("processing");
    expect(
      deriveBatchState({
        eligibleCount: 3,
        acceptedCount: 3,
        failedCount: 0,
        pendingCount: 0,
      }),
    ).toBe("sent");
    expect(
      deriveBatchState({
        eligibleCount: 3,
        acceptedCount: 2,
        failedCount: 1,
        pendingCount: 0,
      }),
    ).toBe("partial");
    expect(
      deriveBatchState({
        eligibleCount: 3,
        acceptedCount: 0,
        failedCount: 3,
        pendingCount: 0,
      }),
    ).toBe("failed");
  });
});

