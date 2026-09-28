import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CHALLONGE_API_BASE_URL } from "@/lib/integrations/tournament/providers/challonge";
import { resolveTournamentProvider } from "@/lib/integrations/tournament/registry";
import { isChallongeConfigured } from "@/lib/integrations/tournament/config";
import { TOURNAMENT_FORMATS } from "@/lib/integrations/tournament/contract";

/**
 * TOURN-001 — LIVE Challonge integration check (manual, opt-in).
 *
 * This hits the REAL Challonge v1 API through the production adapter. It is
 * skipped unless explicitly enabled, so a normal `npm test` never performs
 * network calls:
 *
 *   TOURNAMENT_LIVE_TEST=1 \
 *   CHALLONGE_LIVE_TOURNAMENT_ID=<id-or-slug> \
 *   node --env-file=.env.local node_modules/vitest/vitest.mjs run \
 *     lib/integrations/tournament/providers/challonge.live.test.ts
 *
 * MODES
 *  1. Default (read-only): verifies authentication against the live API and —
 *     when CHALLONGE_LIVE_TOURNAMENT_ID points at a real tournament — that
 *     tournaments, participants and matches translate into FOM-neutral types.
 *     An unknown id is fine: a definitive 404 must map to `null`, not an error.
 *  2. Creation (`TOURNAMENT_LIVE_CREATE=1`): additionally creates a real
 *     PRIVATE tournament, adds the participants in
 *     CHALLONGE_LIVE_PARTICIPANTS (comma separated, default two), starts it,
 *     reports results and finalizes it. It NEVER touches Supabase or any FOM
 *     data, and it leaves the created tournament on the Challonge account
 *     (nothing is deleted).
 *
 * The full end-to-end workflow remains verified by the isolated POC in
 * lib/integrations/challonge-poc/.
 */

const LIVE = process.env.TOURNAMENT_LIVE_TEST === "1";
const CREATE = process.env.TOURNAMENT_LIVE_CREATE === "1";
const TARGET = process.env.CHALLONGE_LIVE_TOURNAMENT_ID?.trim() ?? "";
const LIVE_TIMEOUT_MS = 60_000;

function provider() {
  return resolveTournamentProvider("challonge");
}

function liveSlug(): string {
  // Challonge v1 accepts letters, numbers and underscores only.
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `fom_live_check_${stamp}`;
}

describe.skipIf(!LIVE)("TOURN-001: live Challonge integration (opt-in)", () => {
  it("is configured with a server-only API key", () => {
    expect(isChallongeConfigured()).toBe(true);
  });

  it(
    "authenticates against the live API and reads a tournament if it exists",
    async () => {
      const slug = TARGET || `fom_live_check_missing_${Date.now()}`;
      const tournament = await provider().getTournament(slug);

      if (!tournament) {
        // A definitive 404 must be a null result, never an exception.
        expect(tournament).toBeNull();
        return;
      }

      // Translation invariants that hold for any real tournament.
      expect(typeof tournament.providerTournamentId).toBe("string");
      expect(TOURNAMENT_FORMATS).toContain(tournament.format);
      expect(["created", "started", "completed", "unknown"]).toContain(
        tournament.state,
      );

      const participants = await provider().getParticipants(slug);
      for (const participant of participants) {
        expect(typeof participant.providerParticipantId).toBe("string");
        expect(participant).not.toHaveProperty("seed");
      }

      const matches = await provider().getMatches(slug);
      for (const match of matches) {
        expect(match).not.toHaveProperty("player1_id");
        expect(match).not.toHaveProperty("scores_csv");
        expect(match).not.toHaveProperty("winner_id");
      }

      const winner = await provider().getWinner(slug);
      if (tournament.state !== "completed") {
        expect(winner).toBeNull();
      }
    },
    LIVE_TIMEOUT_MS,
  );
});

describe.skipIf(!LIVE || !CREATE)(
  "TOURN-001: live Challonge create/start/result/finalize (opt-in)",
  () => {
    it(
      "creates, fills, starts, reports and finalizes a real tournament",
      async () => {
        const challonge = provider();
        const slug = liveSlug();
        const names = (
          process.env.CHALLONGE_LIVE_PARTICIPANTS?.split(",") ?? [
            "FOM Live One",
            "FOM Live Two",
          ]
        )
          .map((name) => name.trim())
          .filter(Boolean);

        const created = await challonge.createTournament({
          name: `FOM live check ${slug}`,
          slug,
          config: { format: "single_elimination" },
        });

        expect(created.providerTournamentId).toBeTruthy();
        expect(created.state).toBe("created");
        // The requested format is the format the live tournament reports, and it
        // is a format this adapter advertises as creatable.
        expect(created.format).toBe("single_elimination");
        expect(challonge.supportsFormat(created.format)).toBe(true);

        // Participants are correlated by FOM's own reference id.
        const added = await challonge.addParticipants(
          created.providerTournamentId,
          names.map((displayName, index) => ({
            ref: `live-${index + 1}`,
            displayName,
          })),
        );
        expect(added).toHaveLength(names.length);
        expect(added[0].ref).toBe("live-1");

        const started = await challonge.startTournament(
          created.providerTournamentId,
        );
        expect(started.state).toBe("started");

        const matches = await challonge.getMatches(
          created.providerTournamentId,
        );
        expect(matches.length).toBeGreaterThan(0);

        const playable = matches.find(
          (match) =>
            match.state === "ready" &&
            match.participant1Id !== null &&
            match.participant2Id !== null,
        );
        expect(playable).toBeDefined();

        const reported = await challonge.reportMatchResult(
          created.providerTournamentId,
          {
            matchId: playable!.matchId,
            participant1Score: 1,
            participant2Score: 0,
            winnerParticipantId: playable!.participant1Id as string,
          },
        );
        expect(reported.winnerParticipantId).toBe(playable!.participant1Id);

        // A running tournament has no champion.
        expect(
          await challonge.getWinner(created.providerTournamentId),
        ).toBeNull();

        // Play out the rest of the bracket so it can be finalized.
        for (let guard = 0; guard < 24; guard += 1) {
          const current = await challonge.getTournament(
            created.providerTournamentId,
          );
          if (!current || current.state !== "started") break;

          const next = (
            await challonge.getMatches(created.providerTournamentId)
          ).find(
            (match) =>
              match.state === "ready" &&
              match.participant1Id !== null &&
              match.participant2Id !== null,
          );
          if (!next) break;

          await challonge.reportMatchResult(created.providerTournamentId, {
            matchId: next.matchId,
            participant1Score: 1,
            participant2Score: 0,
            winnerParticipantId: next.participant1Id as string,
          });
        }

        const finalized = await challonge.finalizeTournament(
          created.providerTournamentId,
        );
        expect(finalized.state).toBe("completed");

        const winner = await challonge.getWinner(created.providerTournamentId);
        expect(winner?.providerParticipantId).toBeTruthy();
      },
      LIVE_TIMEOUT_MS * 4,
    );
  },
);

describe.skipIf(LIVE)("TOURN-001: live check disabled", () => {
  it("does not run unless explicitly enabled", () => {
    expect(LIVE).toBe(false);
    expect(CHALLONGE_API_BASE_URL).toBe("https://api.challonge.com/v1");
  });
});
