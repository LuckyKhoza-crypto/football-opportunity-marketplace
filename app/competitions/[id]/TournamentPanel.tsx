"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  TOURNAMENT_FORMAT_COMING_SOON_SUFFIX,
  TOURNAMENT_FORMAT_LABELS,
  TOURNAMENT_MATCH_STATE_LABELS,
  TOURNAMENT_NOT_LINKED_CODE,
  TOURNAMENT_STATE_LABELS,
  type TournamentViewBracket,
  type TournamentViewFormatOption,
  type TournamentViewMatch,
  type TournamentViewMatchSide,
  type TournamentViewSummary,
} from "@/types/competition-tournament";
import type { TournamentFormat } from "@/lib/integrations/tournament/types";
import {
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  Swords,
  Trophy,
} from "lucide-react";

/**
 * TOURN-002 — Tournament management panel for a competition.
 * TOURN-002A — the organiser chooses the tournament format before creation.
 * TOURN-003 — the organiser reports match results and finalizes the tournament.
 *
 * Rendered on the existing competition page for the event creator AND assigned
 * ambassadors. It drives the whole workflow against the FOM tournament API:
 *
 *   not linked             → choose a format + "Create Tournament"
 *   linked, nobody synced  → "Sync Participants"
 *   linked, synced         → "Start Tournament" (+ "Sync Participants" for
 *                            players registered after the first sync)
 *   started                → the bracket, a result form per playable match, and
 *                            "Finalize Tournament"
 *   completed              → the bracket, every result, and the champion
 *
 * The UI never sees the tournament provider: every request and response is
 * provider-neutral, and authorization is enforced server-side (the panel only
 * renders the states/errors the server reports). Nothing here writes bracket or
 * match state — the tournament engine remains the source of truth, so a reported
 * result is followed by re-reading the bracket rather than by editing it here.
 *
 * The format selector is built from the capabilities the SERVER reports: only a
 * format the competition's provider can actually create is selectable, so an
 * unsupported format can neither be promised nor submitted.
 */

const START_CONFIRMATION =
  "Start the tournament?\n\n" +
  "The bracket will be generated from the participants synced so far, and the " +
  "tournament can no longer accept new participants.";

type PanelState =
  | { kind: "loading" }
  | { kind: "not_linked"; formats: TournamentViewFormatOption[] }
  | { kind: "denied"; message: string }
  | { kind: "error"; message: string }
  | { kind: "linked"; summary: TournamentViewSummary };

type TournamentAction = "create" | "sync" | "start" | "finalize";

/** FOM's label for a neutral format id (never provider wording). */
function formatLabel(format: TournamentFormat): string {
  return TOURNAMENT_FORMAT_LABELS[format] ?? String(format);
}

/**
 * The label for a format option. A format the provider cannot create yet says
 * so, instead of looking like something that would work.
 */
function formatOptionLabel(option: TournamentViewFormatOption): string {
  const label = formatLabel(option.format);
  return option.supported
    ? label
    : `${label} — ${TOURNAMENT_FORMAT_COMING_SOON_SUFFIX}`;
}

function participantCount(count: number): string {
  return `${count} participant${count === 1 ? "" : "s"}`;
}

function wasWere(count: number): string {
  return count === 1 ? "was" : "were";
}

/** Feedback for a successful action, in FOM terms only. */
function successMessage(
  action: TournamentAction,
  data: Record<string, unknown>,
): string {
  if (action === "create") return "Tournament created and linked.";
  if (action === "start") return "Tournament started.";
  if (action === "finalize") return "Tournament finalized.";

  const synced = Number(data.synced ?? 0);
  const alreadyMapped = Number(data.alreadyMapped ?? 0);

  if (synced === 0 && alreadyMapped === 0) {
    return "No participants to sync yet.";
  }

  if (synced === 0) {
    return `All ${participantCount(alreadyMapped)} ${wasWere(alreadyMapped)} already synced.`;
  }

  const alreadyNote =
    alreadyMapped > 0
      ? ` ${participantCount(alreadyMapped)} ${wasWere(alreadyMapped)} already synced.`
      : "";

  return `${participantCount(synced)} synced.${alreadyNote}`;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

export function TournamentPanel({ eventId }: { eventId: string }) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [bracket, setBracket] = useState<TournamentViewBracket | null>(null);
  const [bracketError, setBracketError] = useState<string | null>(null);
  const [pending, setPending] = useState<TournamentAction | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * The organiser's format choice. The initial selection comes from the
   * SERVER-reported capability list (never a format hard-coded here), so the UI
   * can only ever offer what the competition's provider can actually create.
   */
  const [chosenFormat, setChosenFormat] = useState<TournamentFormat | null>(null);
  const formatOptions = state.kind === "not_linked" ? state.formats : [];
  const supportedFormats = formatOptions.filter((option) => option.supported);
  const selectedFormat = chosenFormat ?? supportedFormats[0]?.format ?? null;

  const loadBracket = useCallback(async () => {
    try {
      const res = await fetch(`/api/competitions/${eventId}/tournament/matches`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBracket(null);
        setBracketError(data.error || "The tournament matches could not be loaded");
        return;
      }
      setBracket(data as TournamentViewBracket);
      setBracketError(null);
    } catch {
      setBracket(null);
      setBracketError("The tournament matches could not be loaded");
    }
  }, [eventId]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/competitions/${eventId}/tournament`);
      const data = await res.json().catch(() => ({}));

      if (res.status === 401 || res.status === 403) {
        setBracket(null);
        setState({
          kind: "denied",
          message:
            data.error ||
            "You are not authorized to manage this competition's tournament.",
        });
        return;
      }

      // 409 with the not-linked code is the "no tournament yet" state: it is
      // rendered as an actionable empty state rather than an error, and it also
      // carries the formats the organiser may choose between.
      if (res.status === 409 && data.code === TOURNAMENT_NOT_LINKED_CODE) {
        setBracket(null);
        setState({
          kind: "not_linked",
          formats: Array.isArray(data.formats)
            ? (data.formats as TournamentViewFormatOption[])
            : [],
        });
        return;
      }

      if (!res.ok) {
        setBracket(null);
        setState({
          kind: "error",
          message: data.error || "The tournament could not be loaded",
        });
        return;
      }

      setState({
        kind: "linked",
        summary: data.tournament as TournamentViewSummary,
      });
      await loadBracket();
    } catch {
      setBracket(null);
      setState({ kind: "error", message: "The tournament could not be loaded" });
    }
  }, [eventId, loadBracket]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Called after a result was accepted by the server: the bracket (and the
   * summary) are re-read, so a winner the tournament engine has advanced becomes
   * visible in the next round. FOM never advances a match itself.
   */
  const handleResultReported = useCallback(async () => {
    setActionError(null);
    setFeedback("Result reported.");
    await load();
  }, [load]);

  const runAction = async (action: TournamentAction) => {
    if (action === "start" && !confirm(START_CONFIRMATION)) return;
    // Never submit a choice the server told us is unavailable.
    if (action === "create" && !selectedFormat) return;

    setPending(action);
    setActionError(null);
    setFeedback(null);

    try {
      const url =
        action === "create"
          ? `/api/competitions/${eventId}/tournament`
          : action === "sync"
            ? `/api/competitions/${eventId}/tournament/participants`
            : action === "start"
              ? `/api/competitions/${eventId}/tournament/start`
              : `/api/competitions/${eventId}/tournament/finalize`;

      const init: RequestInit = { method: "POST" };

      // The ONLY thing the browser decides is the format the organiser picked;
      // every other tournament decision is made server-side.
      if (action === "create") {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify({ format: selectedFormat });
      }

      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "The tournament request failed");
      }

      setFeedback(successMessage(action, data));
      // Refresh the summary and the bracket so the displayed state is current.
      await load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setPending(null);
    }
  };

  const header = (
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-lg">
        <Swords className="h-5 w-5 text-primary" />
        Tournament
      </CardTitle>
    </CardHeader>
  );

  if (state.kind === "loading") {
    return (
      <Card>
        {header}
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading tournament…
        </CardContent>
      </Card>
    );
  }

  if (state.kind === "denied") {
    return (
      <Card>
        {header}
        <CardContent className="text-sm text-muted-foreground">
          {state.message}
        </CardContent>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card>
        {header}
        <CardContent className="space-y-3">
          <p className="text-sm text-destructive">{state.message}</p>
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={pending !== null}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === "not_linked") {
    return (
      <Card>
        {header}
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            No tournament has been created for this competition.
          </p>

          {formatOptions.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="tournament-format">Tournament Format</Label>
              <select
                id="tournament-format"
                value={selectedFormat ?? ""}
                onChange={(event) => {
                  const next = event.target.value as TournamentFormat;
                  // A value the server did not report as creatable can never
                  // become the selection, so an unavailable format cannot be
                  // submitted even if the selector is manipulated.
                  if (
                    !supportedFormats.some((option) => option.format === next)
                  ) {
                    return;
                  }
                  setChosenFormat(next);
                }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {formatOptions.map((option) => (
                  <option
                    key={option.format}
                    value={option.format}
                    disabled={!option.supported}
                  >
                    {formatOptionLabel(option)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Only formats this competition&apos;s tournament provider can
                create are selectable; the others are listed for reference and
                cannot be chosen yet.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              The available tournament formats could not be loaded, so a
              tournament cannot be created right now. Reload the page and try
              again.
            </p>
          )}

          <Button
            onClick={() => void runAction("create")}
            disabled={pending !== null || selectedFormat === null}
          >
            {pending === "create" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Swords className="mr-2 h-4 w-4" />
            )}
            Create Tournament
          </Button>
          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}
          {feedback && (
            <p className="text-sm text-muted-foreground">{feedback}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const syncedCount = bracket?.participants.length ?? 0;
  const tournamentState = state.summary.state;
  const notStarted = tournamentState === "created";
  const champion =
    state.summary.isComplete && state.summary.winnerParticipantId
      ? bracket?.participants.find(
          (participant) =>
            participant.participantId === state.summary.winnerParticipantId,
        )
      : undefined;

  return (
    <Card>
      {header}
      <CardContent className="space-y-4">
        {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        {feedback && <p className="text-sm text-muted-foreground">{feedback}</p>}

        <p className="text-sm text-muted-foreground">
          Format: {formatLabel(state.summary.format)}
        </p>

        {notStarted ? (
          <>
            <p className="text-sm text-muted-foreground">
              {syncedCount === 0
                ? "Tournament linked."
                : `${syncedCount} participant${plural(syncedCount)} synced.`}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {syncedCount > 0 && (
                <Button
                  onClick={() => void runAction("start")}
                  disabled={pending !== null}
                >
                  {pending === "start" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Start Tournament
                </Button>
              )}
              <Button
                variant={syncedCount === 0 ? "default" : "outline"}
                onClick={() => void runAction("sync")}
                disabled={pending !== null}
              >
                {pending === "sync" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Sync Participants
              </Button>
            </div>

            {syncedCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Sync again to include participants registered since the last
                sync.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm font-medium">
              {tournamentState === "unknown"
                ? "This tournament reported a state that is not recognised, so no management action is offered."
                : TOURNAMENT_STATE_LABELS[tournamentState]}
            </p>

            {champion && (
              <p className="text-sm text-muted-foreground">
                Winner: {champion.name}
              </p>
            )}

            <p className="text-sm text-muted-foreground">
              Report each result as it happens. The winning participant is
              advanced by the tournament engine, and the bracket below is re-read
              from it — nothing is calculated here.
            </p>

            {tournamentState === "started" && (
              <div className="space-y-1">
                <Button
                  onClick={() => void runAction("finalize")}
                  disabled={pending !== null}
                >
                  {pending === "finalize" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trophy className="mr-2 h-4 w-4" />
                  )}
                  Finalize Tournament
                </Button>
                <p className="text-xs text-muted-foreground">
                  Finalize once every result has been reported. Whether the
                  tournament is ready to be finalized is decided by the
                  tournament engine, so it is not offered for a tournament that
                  has already completed.
                </p>
              </div>
            )}

            {bracketError ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive">{bracketError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadBracket()}
                  disabled={pending !== null}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              </div>
            ) : (
              <Bracket
                matches={bracket?.matches ?? []}
                eventId={eventId}
                onReported={handleResultReported}
                disabled={pending !== null}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The bracket, grouped by the rounds the provider reported. Rounds are derived
 * from the data — never a fixed count, fixed names or an assumed bracket size —
 * so a different tournament format changes nothing here.
 */
function Bracket({
  matches,
  eventId,
  onReported,
  disabled,
}: {
  matches: TournamentViewMatch[];
  eventId: string;
  onReported: () => Promise<void>;
  disabled: boolean;
}) {
  if (matches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No matches yet. Matches appear here once the tournament starts.
      </p>
    );
  }

  const rounds = Array.from(new Set(matches.map((match) => match.round))).sort(
    (a, b) => a - b,
  );

  return (
    <div className="space-y-5">
      {rounds.map((round) => (
        <div key={round} className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Round {round}
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {matches
              .filter((match) => match.round === round)
              .map((match, index) => (
                <MatchCard
                  key={`${round}-${index}`}
                  match={match}
                  eventId={eventId}
                  onReported={onReported}
                  disabled={disabled}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One match: state, score, both sides and the winner when there is one — plus,
 * for a match the provider reports as ready, the result form.
 *
 * A match FOM cannot address (`matchRef` is null because a side is still
 * undecided or is not mapped to a participant) deliberately offers no form, and
 * neither does a completed match: the current provider contract has no notion of
 * correcting a settled result.
 */
function MatchCard({
  match,
  eventId,
  onReported,
  disabled,
}: {
  match: TournamentViewMatch;
  eventId: string;
  onReported: () => Promise<void>;
  disabled: boolean;
}) {
  const sideKey = (side: TournamentViewMatchSide | null): string | null => {
    if (!side) return null;
    return side.participantId ?? side.name;
  };

  const winnerKey = sideKey(match.winner);
  const isWinner = (side: TournamentViewMatchSide) =>
    winnerKey !== null && sideKey(side) === winnerKey;

  // A result can only be reported for a match the provider reports as ready AND
  // that FOM can address (both sides mapped to competition participants).
  const canReport = match.state === "ready" && match.matchRef !== null;

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{TOURNAMENT_MATCH_STATE_LABELS[match.state]}</span>
        {match.score && (
          <span>
            {match.score.participant1Score} – {match.score.participant2Score}
          </span>
        )}
      </div>
      <div className="space-y-1">
        <MatchSide
          side={match.participant1}
          winner={isWinner(match.participant1)}
        />
        <MatchSide
          side={match.participant2}
          winner={isWinner(match.participant2)}
        />
      </div>

      {match.state === "completed" && match.winner?.name && (
        <p className="mt-2 text-xs text-muted-foreground">
          Winner: {match.winner.name}
        </p>
      )}

      {canReport && match.matchRef && (
        <ReportResultForm
          eventId={eventId}
          matchRef={match.matchRef}
          participant1={match.participant1}
          participant2={match.participant2}
          onReported={onReported}
          disabled={disabled}
        />
      )}
    </div>
  );
}

/**
 * The result form for one playable match: each side's score and which of the two
 * FOM participants won.
 *
 * It submits FOM-neutral data only — the match reference, the winning
 * `competition_participants.id` and the two scores. Nothing about the tournament
 * provider is sent, and nothing is written locally: on success the panel re-reads
 * the bracket, so the provider's own advancement is what appears next.
 */
function ReportResultForm({
  eventId,
  matchRef,
  participant1,
  participant2,
  onReported,
  disabled,
}: {
  eventId: string;
  matchRef: string;
  participant1: TournamentViewMatchSide;
  participant2: TournamentViewMatchSide;
  onReported: () => Promise<void>;
  disabled: boolean;
}) {
  const [participant1Score, setParticipant1Score] = useState("0");
  const [participant2Score, setParticipant2Score] = useState("0");
  const [winnerParticipantId, setWinnerParticipantId] = useState<string | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only sides that are real FOM participants can be scored or selected — an
  // unmapped side has no id, so it can never become the winner.
  const sides = [participant1, participant2].flatMap((side) =>
    side.participantId ? [{ participantId: side.participantId, name: side.name }] : [],
  );

  const submit = async () => {
    setError(null);

    // The winner is chosen explicitly: FOM neither infers one nor accepts a draw.
    if (!winnerParticipantId) {
      setError("Select the winning participant.");
      return;
    }

    const score1 = Number(participant1Score);
    const score2 = Number(participant2Score);
    if (
      !Number.isInteger(score1) ||
      !Number.isInteger(score2) ||
      score1 < 0 ||
      score2 < 0
    ) {
      setError("Enter each side's score as a whole number.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/competitions/${eventId}/tournament/matches/${encodeURIComponent(
          matchRef,
        )}/result`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            winnerParticipantId,
            participant1Score: score1,
            participant2Score: score2,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "The result could not be reported");
      }

      setWinnerParticipantId(null);
      setParticipant1Score("0");
      setParticipant2Score("0");
      await onReported();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The result could not be reported",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || disabled;

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <span className="truncate">{participant1.name ?? "TBD"}</span>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label={`Score for ${participant1.name ?? "participant 1"}`}
          value={participant1Score}
          onChange={(event) => setParticipant1Score(event.target.value)}
          disabled={busy}
          className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
        />
        <span className="truncate">{participant2.name ?? "TBD"}</span>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label={`Score for ${participant2.name ?? "participant 2"}`}
          value={participant2Score}
          onChange={(event) => setParticipant2Score(event.target.value)}
          disabled={busy}
          className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
        />
      </div>

      <fieldset className="space-y-1" disabled={busy}>
        <legend className="text-xs text-muted-foreground">
          Winner (required)
        </legend>
        {sides.map((side) => (
          <label key={side.participantId} className="flex items-center gap-2">
            <input
              type="radio"
              name={`winner-${matchRef}`}
              value={side.participantId}
              checked={winnerParticipantId === side.participantId}
              onChange={() => setWinnerParticipantId(side.participantId)}
            />
            <span className="truncate">{side.name ?? "TBD"}</span>
          </label>
        ))}
      </fieldset>

      <Button size="sm" onClick={() => void submit()} disabled={busy}>
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Report Result
      </Button>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}


function MatchSide({
  side,
  winner,
}: {
  side: TournamentViewMatchSide;
  winner: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={side.name ? undefined : "text-muted-foreground"}>
        {side.name ?? "TBD"}
      </span>
      {winner && (
        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          winner
        </span>
      )}
    </div>
  );
}

