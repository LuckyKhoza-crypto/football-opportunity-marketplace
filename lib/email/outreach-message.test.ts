import { describe, it, expect } from "vitest";

import {
  buildOutreachMessageEmail,
  buildOutreachEmailSubject,
} from "@/lib/email/templates/outreach-message";

const CONVERSATION_URL = "https://fomsports.example/messages/conv-123";

describe("EMAIL-003: outreach email template", () => {
  it("renders team name, opportunity title and a conversation CTA", () => {
    const email = buildOutreachMessageEmail({
      to: "player@example.com",
      conversationUrl: CONVERSATION_URL,
      data: {
        kind: "outreach",
        teamName: "Northside FC",
        opportunityTitle: "First Team Striker",
        opportunityRole: "ST",
        playerName: "Alex Doe",
      },
    });

    expect(email.to.email).toBe("player@example.com");
    expect(email.subject).toContain("Northside FC");
    expect(email.html).toContain("Northside FC");
    expect(email.html).toContain("First Team Striker");
    expect(email.html).toContain("Alex Doe");
    expect(email.html).toContain(CONVERSATION_URL);
    expect(email.text).toContain("View Conversation");
    expect(email.text).toContain(CONVERSATION_URL);
  });

  it("uses a dedicated subject that reads as a marketplace notification", () => {
    const subject = buildOutreachEmailSubject({
      kind: "outreach",
      teamName: "Northside FC",
    });
    expect(subject).toBe("Northside FC contacted you on FOM Sports");
  });

  it("never exposes internal identifiers as visible text", () => {
    const email = buildOutreachMessageEmail({
      to: "player@example.com",
      conversationUrl: CONVERSATION_URL,
      data: {
        kind: "outreach",
        teamName: "Northside FC",
        opportunityTitle: "First Team Striker",
        playerName: "Alex Doe",
      },
    });

    // The conversation id is an internal id. It is allowed ONLY as the CTA link
    // target (so the button navigates correctly), never as visible copy. Strip
    // the anchor href, then assert it is gone from the body.
    const withoutHrefs = email.html.replace(/href="[^"]*"/g, "");
    expect(withoutHrefs).not.toContain("conv-123");
    // The subject is pure presentation copy (never an id).
    expect(email.subject).not.toContain("conv-123");
  });

  it("degrades gracefully when player name is missing", () => {
    const email = buildOutreachMessageEmail({
      to: "player@example.com",
      conversationUrl: CONVERSATION_URL,
      data: {
        kind: "outreach",
        teamName: "Northside FC",
        opportunityTitle: "First Team Striker",
      },
    });

    expect(email.html).toContain("Hi there,");
    expect(email.html).not.toContain("undefined");
  });

  it("degrades gracefully when team and opportunity are missing", () => {
    const email = buildOutreachMessageEmail({
      to: "player@example.com",
      conversationUrl: CONVERSATION_URL,
      data: { kind: "outreach" },
    });

    expect(email.subject).toBe("A team contacted you on FOM Sports");
    expect(email.html).toContain("A team");
    expect(email.html).not.toContain("undefined");
  });

  it("omits the CTA when the conversation URL cannot be resolved", () => {
    const email = buildOutreachMessageEmail({
      to: "player@example.com",
      conversationUrl: null,
      data: { kind: "outreach", teamName: "Northside FC" },
    });

    expect(email.html).not.toContain("View Conversation");
    expect(email.text).not.toContain("View Conversation");
  });

  it("escapes untrusted team/opportunity/player copy in the HTML", () => {
    const email = buildOutreachMessageEmail({
      to: "player@example.com",
      conversationUrl: CONVERSATION_URL,
      data: {
        kind: "outreach",
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