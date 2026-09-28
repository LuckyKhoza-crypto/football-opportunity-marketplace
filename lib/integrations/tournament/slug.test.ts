import { describe, it, expect } from "vitest";

import {
  buildTournamentName,
  buildTournamentSlug,
  MAX_TOURNAMENT_NAME_LENGTH,
  MAX_TOURNAMENT_SLUG_LENGTH,
  TOURNAMENT_SLUG_PREFIX,
} from "@/lib/integrations/tournament/slug";
import { TournamentProviderError } from "@/lib/integrations/tournament/errors";

/**
 * TOURN-001 — Slug/name derivation.
 *
 * The slug is the duplicate-creation guard: it must be deterministic for a given
 * competition and contain only characters every provider accepts (Challonge v1
 * rejects hyphens with HTTP 422).
 */

const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("TOURN-001: buildTournamentSlug", () => {
  it("derives a deterministic slug from the competition id", () => {
    const slug = buildTournamentSlug(EVENT_A);
    // The slug is the competition id with every non-alphanumeric character
    // removed, prefixed with FOM's namespace.
    const compactId = EVENT_A.replace(/[^a-z0-9]/g, "");

    expect(slug).toBe(`${TOURNAMENT_SLUG_PREFIX}${compactId}`);
    // Same competition ⇒ same slug, even on a retry after a crash.
    expect(buildTournamentSlug(EVENT_A)).toBe(slug);
  });

  it("uses only letters, numbers and underscores (Challonge v1 charset)", () => {
    const slug = buildTournamentSlug(EVENT_A);

    expect(slug).toMatch(/^[a-z0-9_]+$/);
    expect(slug).not.toContain("-");
  });

  it("normalises any casing or separator a caller supplies", () => {
    expect(buildTournamentSlug("AAAA-BBBB")).toBe(
      `${TOURNAMENT_SLUG_PREFIX}aaaabbbb`,
    );
  });

  it("produces different slugs for different competitions", () => {
    expect(buildTournamentSlug(EVENT_A)).not.toBe(buildTournamentSlug(EVENT_B));
  });

  it("never exceeds the provider slug limit", () => {
    const slug = buildTournamentSlug("a".repeat(120) + "-1234");

    expect(slug.length).toBeLessThanOrEqual(MAX_TOURNAMENT_SLUG_LENGTH);
  });

  it("rejects an id with no usable characters", () => {
    expect(() => buildTournamentSlug("---")).toThrow(TournamentProviderError);

    try {
      buildTournamentSlug("---");
    } catch (error) {
      expect((error as TournamentProviderError).code).toBe(
        "tournament_invalid_input",
      );
    }
  });
});

describe("TOURN-001: buildTournamentName", () => {
  const slug = buildTournamentSlug(EVENT_A);

  it("uses the competition name", () => {
    expect(buildTournamentName("FOM Finals Night", slug)).toBe(
      "FOM Finals Night",
    );
  });

  it("collapses whitespace and trims", () => {
    expect(buildTournamentName("  FOM   Finals \n Night ", slug)).toBe(
      "FOM Finals Night",
    );
  });

  it("falls back to the slug when the name is blank", () => {
    expect(buildTournamentName("   ", slug)).toBe(slug);
    expect(buildTournamentName("", slug)).toBe(slug);
  });

  it("bounds the name length", () => {
    const name = buildTournamentName("n".repeat(400), slug);

    expect(name.length).toBeLessThanOrEqual(MAX_TOURNAMENT_NAME_LENGTH);
  });
});
