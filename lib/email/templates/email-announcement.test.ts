import { describe, it, expect } from "vitest";
import { buildEmailAnnouncementEmail } from "@/lib/email/templates/email-announcement";

/**
 * FOM-EMAIL-ANNOUNCEMENTS-001 — announcement email template tests.
 *
 * The template is the SAME one the delivery processor uses, so these assertions
 * cover what a recipient actually receives: the greeting, the preserved
 * formatting, the optional image, the optional promotion CTA/link, the
 * plain-text alternative and escaping.
 */

const PROMO_URL = "https://fom.example.com/competitions/join/token-123";

describe("FOM-EMAIL-ANNOUNCEMENTS-001: announcement email", () => {
  it("greets a named recipient and uses the subject as the title", () => {
    const email = buildEmailAnnouncementEmail({
      to: "player@example.com",
      recipientName: "Ada",
      subject: "You're invited",
      message: "Hello world",
      imageUrl: null,
      promotion: null,
    });

    expect(email.subject).toBe("You're invited");
    expect(email.to).toEqual({ email: "player@example.com", name: "Ada" });
    expect(email.html).toContain("Hi Ada,");
    expect(email.text).toContain("Hi Ada,");
  });

  it("falls back to an unnamed greeting", () => {
    const email = buildEmailAnnouncementEmail({
      to: "player@example.com",
      recipientName: null,
      subject: "Hello",
      message: "Body",
      imageUrl: null,
      promotion: null,
    });
    expect(email.html).toContain("Hi there,");
    expect(email.to).toEqual({ email: "player@example.com" });
  });

  it("preserves the message formatting in the HTML and the text alternative", () => {
    const email = buildEmailAnnouncementEmail({
      to: "player@example.com",
      recipientName: null,
      subject: "News",
      message: "Para one\n\nline two\nline three\n\n- bullet\n\n1. step",
      imageUrl: null,
      promotion: null,
    });

    expect(email.html).toContain("<p ");
    expect(email.html).toContain("line two<br />line three");
    expect(email.html).toContain("<ul ");
    expect(email.html).toContain("<ol ");
    expect(email.text).toContain("line two\nline three");
    expect(email.text).toContain("- bullet");
    expect(email.text).toContain("1. step");
  });

  it("escapes untrusted message content", () => {
    const email = buildEmailAnnouncementEmail({
      to: "player@example.com",
      recipientName: null,
      subject: "News",
      message: '<script>alert("x")</script>',
      imageUrl: null,
      promotion: null,
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("renders the uploaded image at the token position", () => {
    const email = buildEmailAnnouncementEmail({
      to: "player@example.com",
      recipientName: null,
      subject: "News",
      message: "Before\n\n[image]\n\nAfter",
      imageUrl: "https://cdn.example.com/pic.png",
      promotion: null,
    });

    const before = email.html.indexOf("Before");
    const img = email.html.indexOf('src="https://cdn.example.com/pic.png"');
    const after = email.html.indexOf("After");
    expect(img).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(img);
    expect(email.text).toContain("Image: https://cdn.example.com/pic.png");
  });

  it("adds a prominent registration CTA and link when promoting a competition", () => {
    const email = buildEmailAnnouncementEmail({
      to: "player@example.com",
      recipientName: null,
      subject: "Join us",
      message: "Body",
      imageUrl: null,
      promotion: { name: "Spring Cup", url: PROMO_URL },
    });

    // A visible CTA button plus the plain link, in both HTML and text.
    expect(email.html).toContain(PROMO_URL);
    expect(email.html).toContain("Spring Cup");
    expect(email.html).toContain(`href="${PROMO_URL}"`);
    expect(email.text).toContain(PROMO_URL);
    expect(email.text).toContain("Spring Cup");
  });

  it("adds no registration link when no competition is promoted", () => {
    const email = buildEmailAnnouncementEmail({
      to: "player@example.com",
      recipientName: null,
      subject: "Join us",
      message: "Body",
      imageUrl: null,
      promotion: null,
    });
    expect(email.html).not.toContain("/competitions/join/");
    expect(email.text).not.toContain("/competitions/join/");
  });

  it("uses the shared FOM Sports shell", () => {
    const email = buildEmailAnnouncementEmail({
      to: "player@example.com",
      recipientName: null,
      subject: "News",
      message: "Body",
      imageUrl: null,
      promotion: null,
    });
    expect(email.html).toContain("FOM Sports");
    expect(email.html).toContain("<!DOCTYPE html>");
  });
});
