import { describe, it, expect } from "vitest";

import {
  buildCompetitionRegistrationEmail,
  buildCompetitionRegistrationEmailSubject,
  formatCompetitionEventDate,
} from "@/lib/email/templates/competition-registration";

/**
 * COMP-EMAIL-001 — competition registration confirmation email template.
 */

const QR_IMAGE_URL =
  "https://fom-sports.com/api/competitions/verify-qr/opaque-token-123";

describe("COMP-EMAIL-001: competition-registration email template", () => {
  it("renders the competition, event details, code and the QR image", () => {
    const email = buildCompetitionRegistrationEmail({
      to: "player@example.com",
      competitionName: "City Finals",
      eventDate: "2026-10-03T18:30:00.000Z",
      location: "Riverside Pitches, Cape Town",
      description: "Bring water and arrive 30 minutes early.",
      challengeName: "Juggle Challenge",
      verificationCode: "ABCD2345",
      qrImageUrl: QR_IMAGE_URL,
      participantName: "Alex Doe",
    });

    expect(email.to.email).toBe("player@example.com");
    expect(email.to.name).toBe("Alex Doe");
    expect(email.subject).toBe("You're registered for City Finals");
    expect(email.html).toContain("City Finals");
    expect(email.html).toContain("Riverside Pitches, Cape Town");
    expect(email.html).toContain("Juggle Challenge");
    expect(email.html).toContain("Bring water and arrive 30 minutes early.");
    // Exact verification code, formatted the same way the pass screen shows it.
    expect(email.html).toContain("ABCD-2345");
    // The QR is a HOSTED https image (renders in Gmail) — not a data: URI.
    expect(email.html).toContain(`<img src="${QR_IMAGE_URL}"`);
    expect(email.html).not.toContain("data:image");
    expect(email.html).toContain('alt="Your registration QR code"');
    // UTC is stated explicitly.
    expect(email.html).toContain("UTC");
    // Plain-text fallback carries the code too.
    expect(email.text).toContain("ABCD-2345");
  });

  it("includes the check-in fallback instructions", () => {
    const email = buildCompetitionRegistrationEmail({
      to: "player@example.com",
      competitionName: "City Finals",
      eventDate: null,
      location: null,
      description: null,
      challengeName: null,
      verificationCode: null,
      qrImageUrl: QR_IMAGE_URL,
      participantName: null,
    });

    expect(email.html.toLowerCase()).toContain("check-in");
    expect((email.text ?? "").toLowerCase()).toContain("check-in");
    expect(email.html).toContain("Hi there,");
  });

  it("gracefully omits unavailable optional event fields", () => {
    const email = buildCompetitionRegistrationEmail({
      to: "player@example.com",
      competitionName: "City Finals",
      eventDate: null,
      location: null,
      description: null,
      challengeName: null,
      verificationCode: null,
      qrImageUrl: QR_IMAGE_URL,
      participantName: null,
    });

    expect(email.html).not.toContain("undefined");
    expect(email.html).not.toContain("Where:");
    expect(email.html).not.toContain("Challenge:");
    // Still renders the (possibly null) competition name and the QR.
    expect(email.html).toContain("City Finals");
    expect(email.html).toContain(QR_IMAGE_URL);
  });

  it("falls back to a generic subject when the name is missing", () => {
    expect(
      buildCompetitionRegistrationEmailSubject({ competitionName: "" }),
    ).toBe("Your FOM Sports competition registration is confirmed");
  });

  it("escapes untrusted competition copy", () => {
    const email = buildCompetitionRegistrationEmail({
      to: "player@example.com",
      competitionName: "<script>alert(1)</script>",
      eventDate: null,
      location: "<img src=x onerror=alert(1)>",
      description: "<b>notes</b>",
      challengeName: null,
      verificationCode: "ABCD2345",
      qrImageUrl: QR_IMAGE_URL,
      participantName: "<b>Bob</b>",
    });

    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(email.html).not.toContain("<b>Bob</b>");
    expect(email.html).not.toContain("<b>notes</b>");
  });

  it("formats event dates with an explicit UTC timezone label", () => {
    expect(formatCompetitionEventDate(null)).toBeNull();
    expect(formatCompetitionEventDate("not-a-date")).toBeNull();

    const formatted = formatCompetitionEventDate("2026-10-03T18:30:00.000Z");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("UTC");
  });
});
