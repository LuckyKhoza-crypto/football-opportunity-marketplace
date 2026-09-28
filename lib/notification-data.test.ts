import { describe, it, expect } from "vitest";

import {
  parseNotificationData,
  isOutreachNotificationData,
  isApplicationStatusNotificationData,
} from "@/lib/notification-data";

describe("EMAIL-003: notification data payload", () => {
  it("recognizes and normalizes an outreach payload", () => {
    const parsed = parseNotificationData({
      kind: "outreach",
      teamName: "  Northside FC  ",
      opportunityTitle: "First Team Striker",
      opportunityRole: "ST",
      playerName: "Alex Doe",
    });

    expect(parsed).toEqual({
      kind: "outreach",
      teamName: "Northside FC",
      opportunityTitle: "First Team Striker",
      opportunityRole: "ST",
      playerName: "Alex Doe",
    });
    expect(isOutreachNotificationData(parsed)).toBe(true);
  });

  it("drops empty/whitespace-only optional fields", () => {
    const parsed = parseNotificationData({
      kind: "outreach",
      teamName: "   ",
      opportunityTitle: "",
    });
    expect(parsed).toEqual({
      kind: "outreach",
      teamName: undefined,
      opportunityTitle: undefined,
      opportunityRole: undefined,
      playerName: undefined,
    });
  });

  it("returns null for unknown or non-object payloads (safe fallback)", () => {
    expect(parseNotificationData(null)).toBeNull();
    expect(parseNotificationData(undefined)).toBeNull();
    expect(parseNotificationData("outreach")).toBeNull();
    expect(parseNotificationData([{ kind: "outreach" }])).toBeNull();
    expect(parseNotificationData({ kind: "something_else" })).toBeNull();
    expect(isOutreachNotificationData({ kind: "application" })).toBe(false);
  });
});

describe("EMAIL-004: application-status payload", () => {
  it("recognizes and normalizes an application-status payload", () => {
    const parsed = parseNotificationData({
      kind: "application_status_changed",
      status: "accepted",
      teamName: "  Phoenix Pro Stars FC  ",
      opportunityTitle: "First Team Striker",
      opportunityRole: "ST",
      playerName: "Alex Doe",
    });

    expect(parsed).toEqual({
      kind: "application_status_changed",
      status: "accepted",
      teamName: "Phoenix Pro Stars FC",
      opportunityTitle: "First Team Striker",
      opportunityRole: "ST",
      playerName: "Alex Doe",
    });
    expect(isApplicationStatusNotificationData(parsed)).toBe(true);
  });

  it("keeps the canonical enum value (rejected stays rejected)", () => {
    const parsed = parseNotificationData({
      kind: "application_status_changed",
      status: "rejected",
    });
    expect(parsed).toEqual({
      kind: "application_status_changed",
      status: "rejected",
      teamName: undefined,
      opportunityTitle: undefined,
      opportunityRole: undefined,
      playerName: undefined,
    });
  });

  it("drops an invalid status value rather than trusting it", () => {
    const parsed = parseNotificationData({
      kind: "application_status_changed",
      status: "declined",
    });
    expect(parsed).toEqual({
      kind: "application_status_changed",
      status: undefined,
      teamName: undefined,
      opportunityTitle: undefined,
      opportunityRole: undefined,
      playerName: undefined,
    });
  });

  it("still parses the existing outreach payload (backward compatible)", () => {
    expect(isOutreachNotificationData({ kind: "outreach" })).toBe(true);
    expect(
      isApplicationStatusNotificationData({ kind: "outreach" }),
    ).toBe(false);
    expect(isOutreachNotificationData({ kind: "application_status_changed" })).toBe(
      false,
    );
  });

  it("returns null for a non-object application-status payload", () => {
    expect(parseNotificationData("application_status_changed")).toBeNull();
    expect(parseNotificationData([{ kind: "application_status_changed" }])).toBeNull();
  });
});
