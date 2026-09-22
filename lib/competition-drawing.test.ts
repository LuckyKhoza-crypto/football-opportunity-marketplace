import { describe, it, expect } from "vitest";

import {
  COMPETITION_DRAWABLE_STATUSES,
  isEventDrawable,
  getDrawingUnavailableReason,
} from "@/lib/competition-drawing";

describe("COMP-006: drawing eligibility (pure)", () => {
  it("allows active and prepared (drawing) events", () => {
    expect(COMPETITION_DRAWABLE_STATUSES).toEqual(["active", "drawing"]);
    expect(isEventDrawable("active")).toBe(true);
    expect(isEventDrawable("drawing")).toBe(true);
  });

  it("rejects every other lifecycle status", () => {
    expect(isEventDrawable("draft")).toBe(false);
    expect(isEventDrawable("completed")).toBe(false);
    expect(isEventDrawable("cancelled")).toBe(false);
  });

  it("returns a null reason only for drawable statuses", () => {
    expect(getDrawingUnavailableReason("active")).toBeNull();
    expect(getDrawingUnavailableReason("drawing")).toBeNull();
  });

  it("returns a human-readable reason for non-drawable statuses", () => {
    expect(getDrawingUnavailableReason("draft")).toMatch(/activate/i);
    expect(getDrawingUnavailableReason("completed")).toMatch(/completed/i);
    expect(getDrawingUnavailableReason("cancelled")).toMatch(/cancelled/i);
  });
});