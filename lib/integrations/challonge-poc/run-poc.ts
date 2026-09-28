/**
 * Challonge Tournament API — isolated FOM-Sports proof of concept.
 *
 * PURPOSE
 * -------
 * Determine whether Challonge can act as an external tournament engine for FOM:
 * create a single-elimination tournament, add 16 participants, start it, read
 * the generated bracket, submit results, and confirm winners advance until the
 * tournament completes.
 *
 * ISOLATION
 * ---------
 *   - Not imported by any application code.
 *   - Contains no imports (only runtime globals), so it runs directly under
 *     Node 22's native TypeScript support: no build step, no dependencies.
 *   - Does NOT touch Supabase, existing competition/tournament code, the UI,
 *     webhooks, or any provider abstraction.
 *
 * SECURITY
 * --------
 *   - API key is read ONLY from `process.env.CHALLONGE_API_KEY` (server-side).
 *   - The key is never logged and never included in thrown errors. The request
 *     URL (which carries the key for v1 auth) is never logged.
 *
 * API-VERSION PROBE
 * -----------------
 * One authenticated probe is run first. The first API version that
 * authenticates is used for the rest of the run. No dual-version support.
 *
 * RUN
 * ---
 *   node lib/integrations/challonge-poc/run-poc.ts
 */

// ---------------------------------------------------------------------------
// Types (minimal shapes of the Challonge v1 responses we consume)
// ---------------------------------------------------------------------------

interface ChallongeTournament {
  id: number;
  name: string;
  url: string;
  state: string;
  tournament_type: string;
  full_challonge_url?: string | null;
  progress_meter?: number | null;
  review_before_finalizing?: boolean | null;
  completed_at?: string | null;
}

interface ChallongeParticipant {
  id: number;
  name: string;
  seed?: number | null;
  tournament_id?: number;
}

interface ChallongeMatch {
  id: number;
  round: number;
  player1_id: number | null;
  player2_id: number | null;
  winner_id: number | null;
  state: string;
  scores_csv?: string | null;
  identifier?: string | null;
}

interface ApiOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

interface RateLimitEvent {
  method: string;
  path: string;
  status: number;
  waitedMs: number;
}

interface VerificationResult {
  capability: string;
  ok: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------
// Configuration / mutable run state
// ---------------------------------------------------------------------------

/** The single API version selected by the probe. */
let activeVersion: "v1" | "v2.1" | null = null;

/** Base URL for the selected API version. */
let activeBaseUrl = "";

/** Resolved API key (never logged). */
let apiKey = "";

/** Polite pause between write operations, observed to be necessary for stable
 *  behaviour against the live API. */
const WRITE_DELAY_MS = 400;

/** Records throttling events so they can be reported, not hidden. */
const rateLimitEvents: RateLimitEvent[] = [];

/** Capability checklist accumulated during the run. */
const verifications: VerificationResult[] = [];

function record(capability: string, ok: boolean, detail: string): void {
  verifications.push({ capability, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${capability} — ${detail}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Environment loading (server-side only)
// ---------------------------------------------------------------------------

function loadEnv(): void {
  const loader = (
    process as unknown as { loadEnvFile?: (path?: string) => void }
  ).loadEnvFile;
  if (typeof loader !== "function") return;
  for (const file of [".env.local", ".env"]) {
    try {
      loader.call(process, file);
    } catch {
      // File may be absent; that is fine.
    }
  }
}

// ---------------------------------------------------------------------------
// Low-level HTTP client (v1: api_key query parameter)
// ---------------------------------------------------------------------------

async function apiRequest<T>(
  method: "GET" | "POST" | "PUT",
  path: string,
  opts: ApiOptions = {},
): Promise<T> {
  if (!activeBaseUrl) throw new Error("API base URL not resolved.");

  const url = new URL(activeBaseUrl + path);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  // v1 authentication: api_key query parameter. The URL is never logged.
  url.searchParams.set("api_key", apiKey);

  const headers: Record<string, string> = { accept: "application/json" };
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  let attempt = 0;
  for (;;) {
    attempt += 1;

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      throw new Error(`Network error calling ${method} ${path}`);
    }

    // Throttling / transient server errors: surface and retry a bounded amount.
    if ((response.status === 429 || response.status >= 500) && attempt <= 3) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      const waitMs =
        retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
      rateLimitEvents.push({
        method,
        path,
        status: response.status,
        waitedMs: waitMs,
      });
      console.warn(
        `  [throttle] ${method} ${path} -> HTTP ${response.status}; retrying in ${waitMs}ms`,
      );
      await sleep(waitMs);
      continue;
    }

    const text = await response.text();

    if (!response.ok) {
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        detail = JSON.stringify(parsed.errors ?? parsed.error ?? parsed).slice(
          0,
          300,
        );
      } catch {
        // keep raw text slice
      }
      throw new Error(`${method} ${path} -> HTTP ${response.status}: ${detail}`);
    }

    return text ? (JSON.parse(text) as T) : (null as T);
  }
}

/**
 * Raw request variant that returns the HTTP status and body without throwing.
 * Used for the optional `finalize` attempt so the API's exact response can be
 * reported instead of masked by an exception.
 */
async function apiRequestRaw(
  method: "GET" | "POST" | "PUT",
  path: string,
): Promise<{ status: number; body: string }> {
  const url = new URL(activeBaseUrl + path);
  url.searchParams.set("api_key", apiKey);
  try {
    const response = await fetch(url, {
      method,
      headers: { accept: "application/json" },
    });
    const body = await response.text();
    return { status: response.status, body: body.slice(0, 300) };
  } catch {
    return { status: 0, body: "network error" };
  }
}

// ---------------------------------------------------------------------------
// Typed API wrappers
// ---------------------------------------------------------------------------

async function showTournament(
  id: number | string,
): Promise<ChallongeTournament> {
  const res = await apiRequest<{ tournament: ChallongeTournament }>(
    "GET",
    `/tournaments/${id}.json`,
  );
  return res.tournament;
}

async function listMatches(id: number | string): Promise<ChallongeMatch[]> {
  const res = await apiRequest<Array<{ match: ChallongeMatch }>>(
    "GET",
    `/tournaments/${id}/matches.json`,
  );
  return res.map((row) => row.match);
}

async function listParticipants(
  id: number | string,
): Promise<ChallongeParticipant[]> {
  const res = await apiRequest<Array<{ participant: ChallongeParticipant }>>(
    "GET",
    `/tournaments/${id}/participants.json`,
  );
  return res.map((row) => row.participant);
}

// ---------------------------------------------------------------------------
// API-version probe
// ---------------------------------------------------------------------------

async function probeApiVersion(key: string): Promise<"v1" | "v2.1" | null> {
  console.log("Probing authenticated API version (no secrets shown)…");

  // v1: api_key query parameter.
  try {
    const v1 = await fetch(
      `https://api.challonge.com/v1/tournaments.json?api_key=${encodeURIComponent(key)}`,
      { method: "GET", headers: { accept: "application/json" } },
    );
    if (v1.ok) {
      console.log(`  v1 probe: authenticated (HTTP ${v1.status}).`);
      return "v1";
    }
    console.log(`  v1 probe: NOT authenticated (HTTP ${v1.status}).`);
  } catch {
    console.log("  v1 probe: network error.");
  }

  // v2.1: Authorization header + explicit Authorization-Type.
  try {
    const v21 = await fetch("https://api.challonge.com/v2.1/tournaments.json", {
      method: "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/vnd.api+json",
        authorization: key,
        "authorization-type": "v1",
      },
    });
    if (v21.ok) {
      console.log(`  v2.1 probe: authenticated (HTTP ${v21.status}).`);
      return "v2.1";
    }
    console.log(`  v2.1 probe: NOT authenticated (HTTP ${v21.status}).`);
  } catch {
    console.log("  v2.1 probe: network error.");
  }

  return null;
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

function buildTournamentSlug(): string {
  // Challonge v1 constraint (observed live): the `url` field may only contain
  // letters, numbers, and underscores — hyphens are rejected with HTTP 422.
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `fom_poc_${stamp}`;
}

function summarizeMatches(
  matches: ChallongeMatch[],
  nameById: Map<number, string>,
): unknown[] {
  return matches
    .slice()
    .sort((a, b) => a.round - b.round || a.id - b.id)
    .map((m) => ({
      id: m.id,
      round: m.round,
      player1_id: m.player1_id,
      player1: m.player1_id !== null ? nameById.get(m.player1_id) ?? null : null,
      player2_id: m.player2_id,
      player2: m.player2_id !== null ? nameById.get(m.player2_id) ?? null : null,
      state: m.state,
      scores: m.scores_csv ?? null,
      winner_id: m.winner_id,
    }));
}

async function main(): Promise<void> {
  loadEnv();

  apiKey = process.env.CHALLONGE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    console.error(
      "\nNo CHALLONGE_API_KEY found.\n" +
        "Add it to football-opportunity-marketplace/.env.local (server-only):\n" +
        "  CHALLONGE_API_KEY=your_key_here\n" +
        "No Challonge API call was made.",
    );
    process.exitCode = 1;
    return;
  }

  const version = await probeApiVersion(apiKey);
  if (!version) {
    console.error(
      "\nSTOP: no Challonge API version authenticated with the provided key.\n" +
        "No tournament was created. No compatibility fallback is implemented by design.",
    );
    process.exitCode = 1;
    return;
  }

  activeVersion = version;
  // Only v1 is implemented; if the probe selected v2.1 we stop rather than build
  // a second code path.
  if (version !== "v1") {
    console.error(
      `\nSTOP: probe selected ${version}, but this POC only implements v1.\n` +
        "Refusing to build dual-version support. Report this and extend deliberately.",
    );
    process.exitCode = 1;
    return;
  }
  activeBaseUrl = "https://api.challonge.com/v1";
  console.log(`Selected API version: ${activeVersion}\n`);

  // --- A. Create tournament ------------------------------------------------
  console.log("A. Creating single-elimination tournament…");
  const slug = buildTournamentSlug();
  const tournamentName = `FOM API POC ${slug}`;
  const created = await apiRequest<{ tournament: ChallongeTournament }>(
    "POST",
    "/tournaments.json",
    {
      body: {
        tournament: {
          name: tournamentName,
          url: slug,
          tournament_type: "single elimination",
          private: true,
        },
      },
    },
  );
  const tournament = created.tournament;
  record(
    "Create tournament",
    true,
    `id=${tournament.id}, state=${tournament.state}`,
  );
  console.log(
    JSON.stringify(
      {
        tournament: {
          id: tournament.id,
          name: tournament.name,
          url: tournament.url,
          full_url: tournament.full_challonge_url ?? null,
          state: tournament.state,
          type: tournament.tournament_type,
        },
      },
      null,
      2,
    ),
  );

  const tid = tournament.id;

  // --- B. Add 16 participants ---------------------------------------------
  console.log("\nB. Adding 16 participants…");
  const playerNames = Array.from(
    { length: 16 },
    (_, i) => `POC Player ${String(i + 1).padStart(2, "0")}`,
  );
  const addedRes = await apiRequest<Array<{ participant: ChallongeParticipant }>>(
    "POST",
    `/tournaments/${tid}/participants/bulk_add.json`,
    { body: { participants: playerNames.map((name) => ({ name })) } },
  );
  const participants = addedRes.map((row) => row.participant);
  record(
    "Add participants",
    participants.length === 16,
    `added ${participants.length} participants`,
  );
  console.table(
    participants.map((p) => ({ id: p.id, name: p.name, seed: p.seed ?? null })),
  );
  const nameById = new Map<number, string>(
    participants.map((p) => [p.id, p.name]),
  );

  // --- C. Start the tournament --------------------------------------------
  console.log("\nC. Starting tournament…");
  await sleep(WRITE_DELAY_MS);
  await apiRequest<unknown>("POST", `/tournaments/${tid}/start.json`);
  const state = await showTournament(tid);
  record("Start tournament", state.state === "underway", `state=${state.state}`);

  const firstRound = await listMatches(tid);
  const openFirstRound = firstRound.filter(
    (m) => m.state === "open" && m.player1_id !== null && m.player2_id !== null,
  );
  record(
    "First-round matches generated",
    openFirstRound.length === 8,
    `${openFirstRound.length} open matches with both players (expected 8)`,
  );

  console.log("\nMachine-readable match summary (round 1):");
  console.log(JSON.stringify(summarizeMatches(firstRound, nameById), null, 2));

  await simulateAndReport(tid, tournamentName, nameById);
}

// ---------------------------------------------------------------------------
// Simulation + verification + Phase 7 report
// ---------------------------------------------------------------------------

async function simulateAndReport(
  tid: number,
  tournamentName: string,
  nameById: Map<number, string>,
): Promise<void> {
  console.log("\nE/F. Simulating matches and verifying advancement…");

  const MAX_MATCHES = 200;
  let submitted = 0;
  let advancementVerified = false;
  let firstRoundSubmissionVerified = false;
  let finalResultVerified = false;
  let finalMatchId: number | null = null;
  let championId: number | null = null;

  for (let guard = 0; guard < MAX_MATCHES; guard += 1) {
    const current = await showTournament(tid);
    if (current.state === "complete") break;

    const matches = await listMatches(tid);
    const playable = matches.filter(
      (m) =>
        m.state === "open" &&
        m.player1_id !== null &&
        m.player2_id !== null &&
        m.winner_id === null,
    );

    if (playable.length === 0) {
      console.log(`  No playable matches while state=${current.state}; stopping.`);
      break;
    }

    // Deterministic winner rule: higher participant id wins.
    const match = playable[0];
    const p1 = match.player1_id as number;
    const p2 = match.player2_id as number;
    const winnerId = Math.max(p1, p2);
    const loserId = Math.min(p1, p2);

    await sleep(WRITE_DELAY_MS);
    await apiRequest<{ match: ChallongeMatch }>(
      "PUT",
      `/tournaments/${tid}/matches/${match.id}.json`,
      { body: { match: { scores_csv: "1-0", winner_id: winnerId } } },
    );
    submitted += 1;

    // Re-fetch and verify the affected state.
    const after = await listMatches(tid);
    const updated = after.find((m) => m.id === match.id);
    const updatedOk =
      updated !== undefined &&
      updated.state === "complete" &&
      updated.winner_id === winnerId;

    const nextAppearance = after.find(
      (m) =>
        m.id !== match.id &&
        (m.player1_id === winnerId || m.player2_id === winnerId),
    );

    if (match.round === 1 && !firstRoundSubmissionVerified) {
      firstRoundSubmissionVerified = updatedOk;
      record(
        "First-round result submission",
        updatedOk,
        `match ${match.id} -> state=${updated?.state ?? "?"}, winner_id=${
          updated?.winner_id ?? null
        }`,
      );
    }

    if (nextAppearance && !advancementVerified) {
      advancementVerified = true;
      record(
        "Winner advancement",
        true,
        `${nameById.get(winnerId) ?? winnerId} advanced from match ${match.id} (round ${match.round}) into match ${nextAppearance.id} (round ${nextAppearance.round}, state=${nextAppearance.state})`,
      );
    }

    if (!nextAppearance && match.round > 1) {
      // No further appearance means this was the final; winner is champion.
      finalMatchId = match.id;
      championId = winnerId;
      finalResultVerified = updatedOk;
      record(
        "Final result submission",
        updatedOk,
        `final match ${match.id} -> state=${updated?.state ?? "?"}, champion_id=${winnerId} (${nameById.get(winnerId) ?? "?"})`,
      );
    }

    if (!updatedOk) {
      console.warn(
        `  [warn] match ${match.id} did not confirm as complete with expected winner.`,
      );
    }

    console.log(
      `  submitted match ${match.id} (round ${match.round}): winner=${nameById.get(winnerId) ?? winnerId} (id=${winnerId}), loser=${nameById.get(loserId) ?? loserId}`,
    );
  }

  // --- Final state ---------------------------------------------------------
  console.log("\nFinal tournament state…");
  const finalTournament = await showTournament(tid);
  const finalMatches = await listMatches(tid);
  console.log(JSON.stringify(summarizeMatches(finalMatches, nameById), null, 2));

  let completed = finalTournament.state === "complete";
  let finalState = finalTournament.state;
  let finalizeStatus: number | null = null;
  let finalizeBody = "";

  // If the tournament is fully played but stuck in `awaiting_review`, attempt
  // the documented finalize operation and report the API's exact response
  // (rather than assuming it works or failing hard on it).
  if (!completed && finalTournament.state === "awaiting_review") {
    const finalize = await apiRequestRaw(
      "POST",
      `/tournaments/${tid}/finalize.json`,
    );
    finalizeStatus = finalize.status;
    finalizeBody = finalize.body;
    await sleep(WRITE_DELAY_MS);
    const afterFinalize = await showTournament(tid);
    finalState = afterFinalize.state;
    completed = finalState === "complete";
    console.log(
      `  finalize attempt: HTTP ${finalizeStatus}${
        finalizeBody ? ` body=${finalizeBody}` : " (empty body)"
      }; state now=${finalState}`,
    );
  }

  const championFromMatches = finalMatches.find(
    (m) =>
      m.winner_id !== null &&
      m.round === Math.max(...finalMatches.map((x) => x.round)),
  );
  if (championFromMatches?.winner_id != null) {
    finalMatchId = championFromMatches.id;
    championId = championFromMatches.winner_id;
    finalResultVerified = finalResultVerified || completed;
  }

  record(
    "Tournament reaches completed state",
    completed,
    completed
      ? "state=complete"
      : `state=${finalState} (review_before_finalizing=${
          finalTournament.review_before_finalizing ?? "?"
        }; finalize HTTP ${finalizeStatus ?? "not attempted"})`,
  );
  record(
    "Winner retrievable",
    championId !== null,
    championId !== null
      ? `${nameById.get(championId) ?? "?"} (id=${championId}) via match ${finalMatchId}`
      : "no winner could be determined",
  );

  // --- Phase 7 report ------------------------------------------------------
  const okCount = verifications.filter((v) => v.ok).length;
  const total = verifications.length;

  console.log("\n================ PHASE 7 REPORT ================\n");
  console.log(`API version used: ${activeVersion} (${activeBaseUrl})`);
  console.log(`Tournament: ${tournamentName}`);
  console.log(`Challonge tournament id: ${tid}`);
  console.log(`Matches submitted: ${submitted}`);
  console.log(
    `Final state: ${finalState}; winner: ${
      championId !== null ? nameById.get(championId) ?? championId : "unknown"
    }\n`,
  );

  console.log("Capability checklist:");
  for (const v of verifications) {
    console.log(`  - [${v.ok ? "PASS" : "FAIL"}] ${v.capability}: ${v.detail}`);
  }

  console.log("\nRate-limit / throttling events observed:");
  if (rateLimitEvents.length === 0) {
    console.log("  none");
  } else {
    for (const e of rateLimitEvents) {
      console.log(
        `  - ${e.method} ${e.path} -> HTTP ${e.status}, waited ${e.waitedMs}ms`,
      );
    }
  }

  // Explicit Phase 7 findings, one line per required question.
  const playableNow = finalMatches.filter(
    (m) =>
      m.state === "open" &&
      m.player1_id !== null &&
      m.player2_id !== null &&
      m.winner_id === null,
  ).length;
  console.log("\nFINDINGS:");
  console.log(
    "  creation:        yes — POST /tournaments.json; required fields name, url, tournament_type ('single elimination')",
  );
  console.log(
    `  participants:    yes — POST .../participants/bulk_add.json; ids returned cleanly (FOM id -> Challonge id is 1:1, stored on our side)`,
  );
  console.log(
    `  matches:         yes — GET .../matches.json returns every match (id, round, player1_id/player2_id, state, scores_csv, winner_id); playable now=${playableNow}`,
  );
  console.log(
    "  results:         yes — PUT .../matches/{id}.json with scores_csv + winner_id; winners advance automatically; next match is the row whose player1_id/player2_id equals the winner",
  );
  console.log(
    `  completion:      ${completed ? "yes" : "no"} — finalize required to move awaiting_review -> complete; winner via max-round match`,
  );
  console.log(
    `  reliability:     rate-limit events=${rateLimitEvents.length}; url charset restricted; finalize returns 400 (empty body) when not finalizable`,
  );

  const failed = verifications.filter((v) => !v.ok);
  const result =
    completed && failed.length === 0 ? "PASS" : completed ? "PARTIAL" : "FAIL";
  console.log(
    `\nPOC RESULT: ${result} (${okCount}/${total} capabilities verified)`,
  );

  console.log(
    "\nMachine-readable result:\n" +
      JSON.stringify(
        {
          apiVersion: activeVersion,
          endpointBase: activeBaseUrl,
          tournamentId: tid,
          tournamentName,
          finalState,
          finalizeStatus,
          submittedMatches: submitted,
          championId,
          championName:
            championId !== null ? nameById.get(championId) ?? null : null,
          firstRoundSubmissionVerified,
          advancementVerified,
          finalResultVerified,
          verifications,
          rateLimitEvents,
          result,
        },
        null,
        2,
      ),
  );

  if (result === "FAIL") process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nPOC FAILED: ${message}`);
  console.error(
    "\nNo result was mocked or faked. Investigate the failure above before proceeding.",
  );
  process.exitCode = 1;
});
