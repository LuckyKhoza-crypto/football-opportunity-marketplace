import { describe, it, expect } from "vitest";

import {
  buildApplicationStatusEmail,
  buildApplicationStatusEmailSubject,
} from "@/lib/email/templates/application-status";

const APPLICATION_URL = "https://fomsports.example/player/applications/app-123";

describe("EMAIL-004: application-status email template", () => {
  it("renders accepted copy with team, opportunity and a CTA", () => {
    const email = buildApplicationStatusEmail({
      to: "player@example.com",
      applicationUrl: APPLICATION_URL,
      data: {
        kind: "application_status_changed",
        status: "accepted",
        teamName: "Phoenix Pro Stars FC",
        opportunityTitle: "First Team Striker",
        playerName: "Alex Doe",
      },
    });

    expect(email.to.email).toBe("player@example.com");
    expect(email.subject).toBe(
      "Your application to Phoenix Pro Stars FC was accepted",
    );
    expect(email.html).toContain("Phoenix Pro Stars FC");
    expect(email.html).toContain("First Team Striker");
    expect(email.html).toContain("Alex Doe");
    expect(email.html).toContain(APPLICATION_URL);
    expect(email.text).toContain("View Application");
    expect(email.text).toContain(APPLICATION_URL);
  });

  it("uses status-specific subjects, keeping the canonical enum value", () => {
    expect(
      buildApplicationStatusEmailSubject({
        kind: "application_status_changed",
        status: "accepted",
        teamName: "Northside FC",
      }),
    ).toBe("Your application to Northside FC was accepted");

    // Canonical status is `rejected`; user-facing copy says "declined".
    expect(
      buildApplicationStatusEmailSubject({
        kind: "application_status_changed",
        status: "rejected",
        teamName: "Northside FC",
      }),
    ).toBe("Your application to Northside FC was declined");

    expect(
      buildApplicationStatusEmailSubject({
        kind: "application_status_changed",
        status: "reviewing",
        teamName: "Northside FC",
      }),
    ).toBe("Your application to Northside FC is being reviewed");

    expect(
      buildApplicationStatusEmailSubject({
        kind: "application_status_changed",
        status: "withdrawn",
        teamName: "Northside FC",
      }),
    ).toBe("Your application to Northside FC was withdrawn");
  });

  it("falls back to a generic subject when the status is unknown", () => {
    expect(
      buildApplicationStatusEmailSubject({
        kind: "application_status_changed",
        teamName: "Northside FC",
      }),
    ).toBe("Your application status was updated");
  });

  it("renders rejected copy that reads as declined", () => {
    const email = buildApplicationStatusEmail({
      to: "player@example.com",
      applicationUrl: APPLICATION_URL,
      data: {
        kind: "application_status_changed",
        status: "rejected",
        teamName: "Phoenix Pro Stars FC",
        opportunityTitle: "First Team Striker",
      },
    });

    expect(email.subject).toBe(
      "Your application to Phoenix Pro Stars FC was declined",
    );
    expect(email.html).toContain("declined");
    expect(email.html).not.toContain("rejected");
  });

  it("never exposes internal identifiers as visible text", () => {
    const email = buildApplicationStatusEmail({
      to: "player@example.com",
      applicationUrl: APPLICATION_URL,
      data: {
        kind: "application_status_changed",
        status: "accepted",
        teamName: "Phoenix Pro Stars FC",
        opportunityTitle: "First Team Striker",
        playerName: "Alex Doe",
      },
    });

    // The application id is an internal id. It is allowed ONLY as the CTA link
    // target (so the button navigates correctly), never as visible copy. Strip
    // the anchor href, then assert it is gone from the body.
    const withoutHrefs = email.html.replace(/href="[^"]*"/g, "");
    expect(withoutHrefs).not.toContain("app-123");
    expect(email.subject).not.toContain("app-123");
  });

  it("degrades gracefully when player name is missing", () => {
    const email = buildApplicationStatusEmail({
      to: "player@example.com",
      applicationUrl: APPLICATION_URL,
      data: {
        kind: "application_status_changed",
        status: "reviewing",
        teamName: "Northside FC",
        opportunityTitle: "First Team Striker",
      },
    });

    expect(email.html).toContain("Hi there,");
    expect(email.html).not.toContain("undefined");
  });

  it("degrades gracefully when team and opportunity are missing", () => {
    const email = buildApplicationStatusEmail({
      to: "player@example.com",
      applicationUrl: APPLICATION_URL,
      data: { kind: "application_status_changed", status: "accepted" },
    });

    expect(email.subject).toBe("Your application was accepted");
    expect(email.html).toContain("The team");
    expect(email.html).toContain("this opportunity");
    expect(email.html).not.toContain("undefined");
  });

  it("omits the CTA when the application URL cannot be resolved", () => {
    const email = buildApplicationStatusEmail({
      to: "player@example.com",
      applicationUrl: null,
      data: {
        kind: "application_status_changed",
        status: "accepted",
        teamName: "Northside FC",
      },
    });

    expect(email.html).not.toContain("View Application");
    expect(email.text).not.toContain("View Application");
  });

  it("escapes untrusted team/opportunity/player copy in the HTML", () => {
    const email = buildApplicationStatusEmail({
      to: "player@example.com",
      applicationUrl: APPLICATION_URL,
      data: {
        kind: "application_status_changed",
        status: "rejected",
        teamName: "<script>alert(1)</script>",
        opportunityTitle: "<img src=x onerror=alert(1)>",
        playerName: "<b>Bob</b>",
      },
    });

    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(email.html).not.toContain("<b>Bob</b>");
  });
});