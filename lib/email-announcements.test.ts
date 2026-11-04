import { describe, it, expect } from "vitest";
import {
  ANNOUNCEMENT_AUDIENCE_TYPES,
  deriveAnnouncementState,
  hasAnnouncementImageToken,
  isAnnouncementAudienceType,
  isAnnouncementId,
  normalizeAnnouncementAudience,
  renderAnnouncementBodyHtml,
  renderAnnouncementBodyText,
  resolveAnnouncementAudience,
  validateAnnouncementInput,
} from "@/lib/email-announcements";
import {
  EMAIL_ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
  EMAIL_ANNOUNCEMENT_SUBJECT_MAX_LENGTH,
} from "@/types/email-announcement";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — pure helper tests.
 *
 * Covers input validation, audience resolution (dedupe / invalid / exclusion)
 * and the formatting-preserving renderer (the critical requirement), including
 * HTML-injection safety.
 */

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROFILE_1 = "11111111-1111-4111-8111-111111111111";
const PROFILE_2 = "22222222-2222-4222-8222-222222222222";
const PROFILE_3 = "33333333-3333-4333-8333-333333333333";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    subject: "A subject",
    message: "A message",
    audienceType: "all_users",
    previousCompetitionId: null,
    promotionCompetitionId: null,
    imageUrl: null,
    ...overrides,
  };
}

describe("FOM-EMAIL-ANNOUNCEMENTS-001: ids and audience types", () => {
  it("accepts only UUID-shaped ids", () => {
    expect(isAnnouncementId(EVENT_A)).toBe(true);
    expect(isAnnouncementId("not-a-uuid")).toBe(false);
    expect(isAnnouncementId("")).toBe(false);
    expect(isAnnouncementId(42)).toBe(false);
  });

  it("supports exactly two audiences", () => {
    expect([...ANNOUNCEMENT_AUDIENCE_TYPES]).toEqual([
      "all_users",
      "previous_competition",
    ]);
    expect(isAnnouncementAudienceType("all_users")).toBe(true);
    expect(isAnnouncementAudienceType("previous_competition")).toBe(true);
    expect(isAnnouncementAudienceType("custom_group")).toBe(false);
  });
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: input validation", () => {
  it("requires a subject and a message", () => {
    expect(validateAnnouncementInput(baseInput({ subject: "  " })).ok).toBe(
      false,
    );
    expect(validateAnnouncementInput(baseInput({ message: "\n \n" })).ok).toBe(
      false,
    );
  });

  it("rejects a multi-line subject (header-injection guard)", () => {
    const result = validateAnnouncementInput(
      baseInput({ subject: "Hi\nBcc: someone@example.com" }),
    );
    expect(result.ok).toBe(false);
  });

  it("enforces the subject and message length limits", () => {
    expect(
      validateAnnouncementInput(
        baseInput({
          subject: "x".repeat(EMAIL_ANNOUNCEMENT_SUBJECT_MAX_LENGTH + 1),
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateAnnouncementInput(
        baseInput({
          message: "x".repeat(EMAIL_ANNOUNCEMENT_MESSAGE_MAX_LENGTH + 1),
        }),
      ).ok,
    ).toBe(false);
  });

  it("requires a competition for the previous-competition audience", () => {
    const result = validateAnnouncementInput(
      baseInput({ audienceType: "previous_competition" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/previous competition/i);
  });

  it("normalizes a valid previous-competition audience", () => {
    const result = validateAnnouncementInput(
      baseInput({
        audienceType: "previous_competition",
        previousCompetitionId: EVENT_A,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previousCompetitionId).toBe(EVENT_A);
      expect(result.promotionCompetitionId).toBeNull();
    }
  });

  it("rejects promoting the same competition as the audience", () => {
    const result = validateAnnouncementInput(
      baseInput({
        audienceType: "previous_competition",
        previousCompetitionId: EVENT_A,
        promotionCompetitionId: EVENT_A,
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts an independent promoted competition", () => {
    const result = validateAnnouncementInput(
      baseInput({
        audienceType: "previous_competition",
        previousCompetitionId: EVENT_A,
        promotionCompetitionId: EVENT_B,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previousCompetitionId).toBe(EVENT_A);
      expect(result.promotionCompetitionId).toBe(EVENT_B);
    }
  });

  it("validates the optional image URL", () => {
    expect(
      validateAnnouncementInput(baseInput({ imageUrl: "not-a-url" })).ok,
    ).toBe(false);
    const result = validateAnnouncementInput(
      baseInput({ imageUrl: "https://cdn.example.com/a.png" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.imageUrl).toBe("https://cdn.example.com/a.png");
  });

  it("normalizes CRLF in the message body", () => {
    const result = validateAnnouncementInput(
      baseInput({ message: "line1\r\nline2" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toBe("line1\nline2");
  });
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: audience normalization", () => {
  it("accepts all users without a competition", () => {
    const result = normalizeAnnouncementAudience({
      audienceType: "all_users",
      previousCompetitionId: null,
      promotionCompetitionId: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.previousCompetitionId).toBeNull();
  });

  it("rejects an unknown audience", () => {
    expect(
      normalizeAnnouncementAudience({
        audienceType: "everyone_ever",
        previousCompetitionId: null,
        promotionCompetitionId: null,
      }).ok,
    ).toBe(false);
  });

  it("validates the promoted competition id", () => {
    expect(
      normalizeAnnouncementAudience({
        audienceType: "all_users",
        previousCompetitionId: null,
        promotionCompetitionId: "nope",
      }).ok,
    ).toBe(false);
  });
});


describe("FOM-EMAIL-ANNOUNCEMENTS-001: audience resolution", () => {
  it("keeps deliverable, unique recipients and reports the base count", () => {
    const { recipients, summary } = resolveAnnouncementAudience(
      [
        { profileId: PROFILE_1, email: "one@example.com", fullName: "One" },
        { profileId: PROFILE_2, email: "two@example.com", fullName: null },
      ],
      { audienceType: "all_users" },
    );
    expect(recipients).toHaveLength(2);
    expect(summary.baseCount).toBe(2);
    expect(summary.eligibleCount).toBe(2);
    expect(summary.invalidCount).toBe(0);
    expect(summary.duplicateCount).toBe(0);
  });

  it("skips missing and invalid addresses with a count", () => {
    const { recipients, summary } = resolveAnnouncementAudience(
      [
        { profileId: PROFILE_1, email: null, fullName: null },
        { profileId: PROFILE_2, email: "  ", fullName: null },
        { profileId: PROFILE_3, email: "not-an-email", fullName: null },
      ],
      { audienceType: "all_users" },
    );
    expect(recipients).toHaveLength(0);
    expect(summary.invalidCount).toBe(3);
  });

  it("deduplicates by normalized address (case + whitespace)", () => {
    const { recipients, summary } = resolveAnnouncementAudience(
      [
        { profileId: PROFILE_1, email: "One@Example.com", fullName: null },
        { profileId: PROFILE_2, email: " one@example.com ", fullName: null },
      ],
      { audienceType: "all_users" },
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0].email).toBe("one@example.com");
    expect(summary.duplicateCount).toBe(1);
  });

  it("excludes profiles already registered for the promoted competition by identity", () => {
    const { recipients, summary } = resolveAnnouncementAudience(
      [
        { profileId: PROFILE_1, email: "one@example.com", fullName: null },
        { profileId: PROFILE_2, email: "two@example.com", fullName: null },
      ],
      {
        audienceType: "previous_competition",
        promotionEventId: EVENT_B,
        registeredProfileIds: new Set([PROFILE_1]),
      },
    );
    expect(recipients.map((r) => r.profileId)).toEqual([PROFILE_2]);
    expect(summary.excludedRegisteredCount).toBe(1);
    expect(summary.promotionEventId).toBe(EVENT_B);
  });

  it("handles an empty audience", () => {
    const { recipients, summary } = resolveAnnouncementAudience([], {
      audienceType: "all_users",
    });
    expect(recipients).toHaveLength(0);
    expect(summary.eligibleCount).toBe(0);
    expect(summary.baseCount).toBe(0);
  });
});


describe("FOM-EMAIL-ANNOUNCEMENTS-001: formatting-preserving rendering", () => {
  it("turns blank lines into separate paragraphs", () => {
    const html = renderAnnouncementBodyHtml(
      "First paragraph\n\nSecond paragraph",
    );
    expect(html.match(/<p /g)).toHaveLength(2);
    expect(html).toContain("First paragraph");
    expect(html).toContain("Second paragraph");
  });

  it("preserves single line breaks as hard breaks inside a paragraph", () => {
    const html = renderAnnouncementBodyHtml("line one\nline two");
    expect(html.match(/<p /g)).toHaveLength(1);
    expect(html).toContain("line one<br />line two");
  });

  it("keeps multiple consecutive blank lines as separate paragraphs", () => {
    const html = renderAnnouncementBodyHtml("A\n\n\n\nB");
    expect(html.match(/<p /g)).toHaveLength(2);
  });

  it("preserves leading indentation and pre-wrapped whitespace", () => {
    const html = renderAnnouncementBodyHtml("    indented text");
    expect(html).toContain(">    indented text<");
    expect(html).toContain("white-space:pre-wrap");
  });

  it("renders bullet lists (and keeps their indentation)", () => {
    const html = renderAnnouncementBodyHtml("- one\n- two\n  - nested");
    expect(html).toContain("<ul ");
    expect(html).toContain("<li ");
    expect(html).toContain(">one</li>");
    expect(html).toContain(">two</li>");
    expect(html).toContain("margin-left:20px");
    expect(html).not.toContain("<ol ");
  });

  it("renders numbered lists", () => {
    const html = renderAnnouncementBodyHtml("1. first\n2. second");
    expect(html).toContain("<ol ");
    expect(html).toContain(">first</li>");
    expect(html).toContain(">second</li>");
  });

  it("supports **bold** and *italic* after escaping", () => {
    const html = renderAnnouncementBodyHtml("**bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("escapes HTML and prevents script injection", () => {
    const html = renderAnnouncementBodyHtml(
      '<script>alert("x")</script> & <img src=x onerror=alert(1)>',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("does not let inline markers smuggle markup", () => {
    const html = renderAnnouncementBodyHtml("**<b>hi</b>**");
    expect(html).not.toContain("<b>");
    expect(html).toContain("<strong>&lt;b&gt;hi&lt;/b&gt;</strong>");
  });

  it("places the image exactly where the [image] token appears", () => {
    const html = renderAnnouncementBodyHtml("Before\n\n[image]\n\nAfter", {
      imageUrl: "https://cdn.example.com/pic.png",
    });
    const before = html.indexOf("Before");
    const img = html.indexOf("<img ");
    const after = html.indexOf("After");
    expect(before).toBeGreaterThanOrEqual(0);
    expect(img).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(img);
    expect(html).toContain('src="https://cdn.example.com/pic.png"');
    expect(html).not.toContain("[image]");
  });

  it("appends the image when no token is present", () => {
    const html = renderAnnouncementBodyHtml("Body only", {
      imageUrl: "https://cdn.example.com/pic.png",
    });
    expect(html.indexOf("<img ")).toBeGreaterThan(html.indexOf("Body only"));
  });

  it("drops the token line when no image is attached", () => {
    const html = renderAnnouncementBodyHtml("Before\n\n[image]\n\nAfter");
    expect(html).not.toContain("[image]");
    expect(html).not.toContain("<img ");
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });

  it("detects the image token", () => {
    expect(hasAnnouncementImageToken("a\n[image]\nb")).toBe(true);
    expect(hasAnnouncementImageToken("a\nb")).toBe(false);
  });

  it("produces a plain-text alternative that keeps line breaks and lists", () => {
    const text = renderAnnouncementBodyText(
      "**Bold** intro\nline two\n\n- item one\n- item two\n\n1. step\n",
      { imageUrl: "https://cdn.example.com/pic.png" },
    );
    expect(text).toContain("Bold intro");
    expect(text).toContain("line two");
    expect(text).toContain("- item one");
    expect(text).toContain("1. step");
    expect(text).not.toContain("**");
    expect(text).toContain("Image: https://cdn.example.com/pic.png");
    expect(text).not.toMatch(/\n{3,}/);
  });
});

describe("FOM-EMAIL-ANNOUNCEMENTS-001: batch state derivation", () => {
  it("derives empty/processing/sent/partial/failed", () => {
    expect(
      deriveAnnouncementState({
        eligibleCount: 0,
        acceptedCount: 0,
        failedCount: 0,
        pendingCount: 0,
      }),
    ).toBe("empty");
    expect(
      deriveAnnouncementState({
        eligibleCount: 3,
        acceptedCount: 1,
        failedCount: 0,
        pendingCount: 2,
      }),
    ).toBe("processing");
    expect(
      deriveAnnouncementState({
        eligibleCount: 3,
        acceptedCount: 3,
        failedCount: 0,
        pendingCount: 0,
      }),
    ).toBe("sent");
    expect(
      deriveAnnouncementState({
        eligibleCount: 3,
        acceptedCount: 2,
        failedCount: 1,
        pendingCount: 0,
      }),
    ).toBe("partial");
    expect(
      deriveAnnouncementState({
        eligibleCount: 3,
        acceptedCount: 0,
        failedCount: 3,
        pendingCount: 0,
      }),
    ).toBe("failed");
  });
});

